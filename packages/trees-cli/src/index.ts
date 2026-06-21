#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { booleanArg, numberArg, parseArgs, renderCommandHelp, requiredString, stringArg, type Args } from "@tangent/core";
import { createBuiltInAgentAdapters, buildTreesAgentEnv, findAgentAdapter } from "@tangent/trees-runtime/agents";
import { generateAttentionItems } from "@tangent/trees-runtime/attention";
import type { TreesClient } from "@tangent/trees-core";
import { ensureEntityWorktree, worktreeStatus } from "@tangent/trees-runtime/git";
import { runTreesMcpStdio } from "@tangent/trees-mcp";
import type { AgentRun, TerminalSession } from "@tangent/trees-schema";
import { defaultTreesHome, openFsTrees } from "@tangent/trees-runtime/fs";
import { createProcessRuntimeAdapter, createTmuxRuntimeAdapter, type TerminalRuntimeAdapter } from "@tangent/trees-runtime/terminal";
import { watchAgentRunNotifications, loadNotifyConfig } from "@tangent/trees-runtime/notify";

import { importPa } from "./import-pa.js";
import { captureIds, estimateArg, humanEntity, humanRows, outcomeArg, output, promptArg, providerFromAdapter, requiredPos, spawnDetached, spawnInherited, stdinText } from "./helpers.js";
import { treesCommandSpec } from "./spec.js";

export { treesCommandSpec } from "./spec.js";

/** Documents the runTreesCli helper. */
export async function runTreesCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv, { repeatable: ["capture-id"] });
  const [command, subcommand] = args._;
  if (!command || args.help) return console.log(renderCommandHelp(treesCommandSpec));
  const client = await openFsTrees();

  if (command === "init") return output(args, { home: defaultTreesHome(), ok: true }, `Trees store: ${defaultTreesHome()}`);
  if (command === "add") return addEntity(client, args);
  if (command === "show") return showEntity(client, args);
  if (command === "list") return listEntities(client, args);
  if (command === "set") return setEntity(client, args);
  if (command === "mv") return moveEntity(client, args);
  if (command === "rm") return removeEntity(client, args);
  if (command === "project") return projectCommand(client, subcommand, args);
  if (command === "worktree") return worktreeCommand(client, subcommand, args);
  if (command === "session") return sessionCommand(client, subcommand, args);
  if (command === "capture") return captureCommand(client, subcommand, args);
  if (command === "attention") return attentionCommand(client, subcommand, args);
  if (command === "agent") return agentCommand(client, subcommand, args);
  if (command === "terminal") return terminalCommand(client, subcommand, args);
  if (command === "events") return eventsCommand(client, args);
  if (command === "import-pa") return output(args, await importPa(client, { from: stringArg(args.from), dryRun: booleanArg(args["dry-run"]) }));
  if (command === "center") return centerCommand(client, args);
  if (command === "mcp") {
    /** Documents the ensureWorktree helper. */
    const ensureWorktree = (input: Record<string, unknown>) => ensureEntityWorktree(client, requiredString(input.ref, "ref"));
    return runTreesMcpStdio(client, { allowDangerous: true, ensureWorktree });
  }
  throw new Error(`Unknown trees command: ${command}`);
}

/** Documents the addEntity helper. */
async function addEntity(client: TreesClient, args: Args): Promise<void> {
  const entity = await client.entities.create({
    path: requiredPos(args, 1, "trees add requires a path."),
    kind: stringArg(args.kind),
    projectId: stringArg(args.project),
    branch: stringArg(args.branch),
    worktreePath: stringArg(args.worktree)
  });
  output(args, entity, `added ${entity.path}`);
}

/** Documents the showEntity helper. */
async function showEntity(client: TreesClient, args: Args): Promise<void> {
  const entity = await requireEntity(client, requiredPos(args, 1, "trees show requires a ref."));
  output(args, entity, humanEntity(entity));
}

/** Documents the listEntities helper. */
async function listEntities(client: TreesClient, args: Args): Promise<void> {
  await refreshAttention(client);
  const entities = await client.entities.list(args._[1]);
  if (booleanArg(args.json)) return output(args, entities);
  for (const entity of entities) console.log(`${entity.path}${entity.branch ? `  ${entity.branch}` : ""}${entity.worktreePath ? `  ${entity.worktreePath}` : ""}`);
}

/** Documents the setEntity helper. */
async function setEntity(client: TreesClient, args: Args): Promise<void> {
  const ref = requiredPos(args, 1, "trees set requires a ref.");
  const field = requiredPos(args, 2, "trees set requires a field.");
  const value = requiredPos(args, 3, "trees set requires a value.");
  const patch: Record<string, unknown> = {};
  const map: Record<string, string> = { project: "projectId", repo: "repoRoot", worktree: "worktreePath" };
  patch[map[field] || field] = field === "tags" ? value.split(",").map((item) => item.trim()).filter(Boolean) : value;
  const entity = await client.entities.update(ref, patch);
  output(args, entity, `updated ${entity.path}`);
}

/** Documents the moveEntity helper. */
async function moveEntity(client: TreesClient, args: Args): Promise<void> {
  const entity = await client.entities.move(requiredPos(args, 1, "trees mv requires a source."), requiredPos(args, 2, "trees mv requires a destination."));
  output(args, entity, `moved to ${entity.path}`);
}

/** Documents the removeEntity helper. */
async function removeEntity(client: TreesClient, args: Args): Promise<void> {
  if (!booleanArg(args.force)) throw new Error("trees rm requires --force for destructive deletes.");
  const ref = requiredPos(args, 1, "trees rm requires a ref.");
  await client.entities.delete(ref);
  output(args, { ok: true, ref }, `removed ${ref}`);
}

/** Documents the projectCommand helper. */
async function projectCommand(client: TreesClient, subcommand: string | undefined, args: Args): Promise<void> {
  if (subcommand === "list") return output(args, await client.projects.list(), humanRows((await client.projects.list()).map((project) => `${project.name}  ${project.path}`)));
  if (subcommand === "add") {
    const projectPath = args._[3] || requiredPos(args, 2, "trees project add requires a path.");
    const name = args._[3] ? args._[2]! : path.basename(projectPath);
    const project = await client.projects.add(name, projectPath);
    return output(args, project, `project ${project.name}: ${project.path}`);
  }
  if (subcommand === "rm") {
    const name = requiredPos(args, 2, "trees project rm requires a name.");
    await client.projects.remove(name);
    return output(args, { ok: true, name }, `removed project ${name}`);
  }
  throw new Error(`Unknown trees project command: ${subcommand || ""}`.trim());
}

/** Documents the worktreeCommand helper. */
async function worktreeCommand(client: TreesClient, subcommand: string | undefined, args: Args): Promise<void> {
  const ref = requiredPos(args, 2, `trees worktree ${subcommand || ""} requires a ref.`);
  if (subcommand === "ensure") return output(args, await ensureEntityWorktree(client, ref));
  if (subcommand === "path") {
    const entity = await requireEntity(client, ref);
    if (!entity.worktreePath) throw new Error(`No worktree attached to ${entity.path}`);
    console.log(entity.worktreePath);
    return;
  }
  if (subcommand === "status") return output(args, await worktreeStatus(client, ref));
  throw new Error(`Unknown trees worktree command: ${subcommand || ""}`.trim());
}

/** Documents the sessionCommand helper. */
async function sessionCommand(client: TreesClient, subcommand: string | undefined, args: Args): Promise<void> {
  if (subcommand === "start") {
    const session = await client.sessions.start({ entity: requiredPos(args, 2, "trees session start requires an entity."), intent: stringArg(args.intent), doneWhen: stringArg(args["done-when"]), estimate: estimateArg(args.estimate) });
    return output(args, session, `session ${session.id} active for ${session.entityPath}`);
  }
  if (subcommand === "checkpoint") {
    const checkpoint = await client.sessions.checkpoint(requiredPos(args, 2, "trees session checkpoint requires a ref."), {
      outcome: outcomeArg(args.outcome),
      did: stringArg(args.did),
      learned: stringArg(args.learned),
      evidenceText: stringArg(args.evidence),
      next: stringArg(args.next),
      blocker: stringArg(args.blocker),
      linkedCaptureIds: captureIds(args)
    });
    return output(args, checkpoint, `checkpoint ${checkpoint.outcome}`);
  }
  if (subcommand === "list") return output(args, await client.sessions.list(args._[2]));
  throw new Error(`Unknown trees session command: ${subcommand || ""}`.trim());
}

/** Documents the captureCommand helper. */
async function captureCommand(client: TreesClient, subcommand: string | undefined, args: Args): Promise<void> {
  if (subcommand === "add") {
    const text = booleanArg(args.stdin) ? await stdinText() : requiredString(args.text, "trees capture add requires --text or --stdin.");
    const capture = await client.captures.add({ entity: stringArg(args.entity), kind: stringArg(args.kind) as never, text });
    return output(args, capture, `capture ${capture.id}`);
  }
  if (subcommand === "list") return output(args, await client.captures.list({ entity: stringArg(args.entity), all: booleanArg(args.all) }));
  if (subcommand === "resolve") {
    const id = requiredPos(args, 2, "trees capture resolve requires an id.");
    const capture = booleanArg(args.dismiss) ? await client.captures.dismiss(id, stringArg(args.note)) : await client.captures.resolve(id, { checkpointId: stringArg(args.checkpoint), note: stringArg(args.note) });
    return output(args, capture, `capture ${capture.status}`);
  }
  throw new Error(`Unknown trees capture command: ${subcommand || ""}`.trim());
}

/** Documents the attentionCommand helper. */
async function attentionCommand(client: TreesClient, subcommand: string | undefined, args: Args): Promise<void> {
  await refreshAttention(client);
  if (subcommand === "list") return output(args, await client.attention.list({ kind: stringArg(args.kind), severity: stringArg(args.severity) }));
  const id = requiredPos(args, 2, `trees attention ${subcommand || ""} requires an id.`);
  if (subcommand === "ack") return output(args, await client.attention.ack(id));
  if (subcommand === "resolve") return output(args, await client.attention.resolve(id, stringArg(args.note)));
  if (subcommand === "dismiss") return output(args, await client.attention.dismiss(id, stringArg(args.reason)));
  throw new Error(`Unknown trees attention command: ${subcommand || ""}`.trim());
}

/** Documents the agentCommand helper. */
async function agentCommand(client: TreesClient, subcommand: string | undefined, args: Args): Promise<void> {
  if (subcommand === "start") return startAgent(client, args);
  if (subcommand === "watch") return watchAgent(client, requiredPos(args, 2, "trees agent watch requires a run id."));
  if (subcommand === "status") return output(args, await agentRows(client, args._[2]));
  if (subcommand === "send") return sendToTerminalLike(client, args, "agent");
  if (subcommand === "stop") {
    const terminal = await resolveTerminal(client, requiredPos(args, 2, "trees agent stop requires a run or path."));
    const runtime = runtimeFor(terminal.runtimeId, [terminal]);
    await runtime.kill(terminal.id);
    if (terminal.agentRunId) await client.agents.patch(terminal.agentRunId, { status: "cancelled", endedAt: new Date().toISOString() }, "agent.cancelled");
    return output(args, { ok: true, terminalSessionId: terminal.id }, `stopped ${terminal.id}`);
  }
  throw new Error(`Unknown trees agent command: ${subcommand || ""}`.trim());
}

/** Documents the startAgent helper. */
async function startAgent(client: TreesClient, args: Args): Promise<void> {
  const entity = await requireEntity(client, requiredPos(args, 2, "trees agent start requires an entity."));
  const workSession = await client.sessions.start({ entity: entity.id, intent: stringArg(args.intent), doneWhen: stringArg(args["done-when"]), estimate: estimateArg(args.estimate) });
  const adapterId = stringArg(args.agent) || entity.agentDefaults?.adapterId || "codex-cli";
  const adapter = findAgentAdapter(createBuiltInAgentAdapters(), adapterId);
  const runtimeId = stringArg(args.runtime) || entity.agentDefaults?.runtimeId || "tmux";
  const agentRunId = `run_${randomUUID()}`;
  const terminalId = `term_${randomUUID()}`;
  const terminal = await runtimeFor(runtimeId).create({ id: terminalId, entityId: entity.id, entityPath: entity.path, agentRunId, workSessionId: workSession.id, cwd: entity.worktreePath || entity.repoRoot || process.cwd() });
  const prompt = await promptArg(args);
  const env = buildTreesAgentEnv({ entityId: entity.id, entityPath: entity.path, workSessionId: workSession.id, agentRunId, terminalSessionId: terminal.id, worktreePath: entity.worktreePath, repoRoot: entity.repoRoot, adapterId, provider: providerFromAdapter(adapterId) });
  const command = await adapter.buildCommand({ entity, workSession, prompt, cwd: terminal.cwd || process.cwd(), model: stringArg(args.model) || entity.agentDefaults?.model, sandbox: entity.agentDefaults?.sandboxId, env });
  const runtime = runtimeFor(runtimeId, [terminal]);
  const startedTerminal = await runtime.start(terminal.id, command);
  await client.terminals.recordCreated(startedTerminal);
  const now = new Date().toISOString();
  const agentRun: AgentRun = {
    schema: "tangent.trees.agentRun.v1",
    id: agentRunId,
    entityId: entity.id,
    workSessionId: workSession.id,
    terminalSessionId: terminal.id,
    adapterId,
    provider: providerFromAdapter(adapterId),
    model: stringArg(args.model) || entity.agentDefaults?.model,
    status: "running",
    statusReason: "started by trees cli",
    statusUpdatedAt: now,
    statusConfidence: "exact",
    prompt: prompt ? { text: prompt, source: "user" } : undefined,
    startedAt: now,
    usageSessionIds: [],
    permissionRequestIds: [],
    attentionItemIds: [],
    metrics: {},
    createdAt: now,
    updatedAt: now,
    evidence: []
  };
  await client.agents.recordStarted(agentRun);
  // Spawn a detached watcher that notifies when this run finishes or needs input, then exits.
  // Trees has no live supervisor, so without this nothing notices the agent come to rest.
  if (loadNotifyConfig().driver !== "none") spawnDetached(process.execPath, [process.argv[1], "agent", "watch", agentRunId]);
  output(args, { agentRun, terminalSession: startedTerminal }, `agent ${agentRun.id} started in ${startedTerminal.runtimeRef.tmuxSessionName || startedTerminal.id}`);
}

/** Runs the foreground notify watcher for one agent run (invoked detached by `trees agent start`). */
async function watchAgent(client: TreesClient, agentRunId: string): Promise<void> {
  const projection = await client.projection();
  const agentRun = projection.agentRuns.find((run) => run.id === agentRunId);
  if (!agentRun) throw new Error(`Unknown agent run: ${agentRunId}`);
  const terminalSession = projection.terminalSessions.find((terminal) => terminal.id === agentRun.terminalSessionId || terminal.agentRunId === agentRunId);
  if (!terminalSession) throw new Error(`No terminal session for agent run: ${agentRunId}`);
  const runtime = runtimeFor(terminalSession.runtimeId, [terminalSession]);
  await watchAgentRunNotifications({ client, agentRun, runtime, terminalSession, config: loadNotifyConfig() });
}

/** Documents the terminalCommand helper. */
async function terminalCommand(client: TreesClient, subcommand: string | undefined, args: Args): Promise<void> {
  if (subcommand === "capture") {
    const terminal = await resolveTerminal(client, requiredPos(args, 2, "trees terminal capture requires a ref."));
    const capture = await runtimeFor(terminal.runtimeId, [terminal]).capture(terminal.id, { lines: numberArg(args.lines) });
    return output(args, capture, capture.text);
  }
  if (subcommand === "send") return sendToTerminalLike(client, args, "terminal");
  if (subcommand === "attach" || subcommand === "open") {
    const terminal = await resolveTerminal(client, requiredPos(args, 2, `trees terminal ${subcommand} requires a ref.`));
    const handle = await runtimeFor(terminal.runtimeId, [terminal]).attach(terminal.id);
    if (booleanArg(args.json)) return output(args, handle);
    await spawnInherited(handle.command, handle.args);
    return;
  }
  throw new Error(`Unknown trees terminal command: ${subcommand || ""}`.trim());
}

/** Documents the sendToTerminalLike helper. */
async function sendToTerminalLike(client: TreesClient, args: Args, label: string): Promise<void> {
  const terminal = await resolveTerminal(client, requiredPos(args, 2, `trees ${label} send requires a ref.`));
  const text = args._[3] === "-" ? await stdinText() : requiredPos(args, 3, `trees ${label} send requires text.`);
  await runtimeFor(terminal.runtimeId, [terminal]).send(terminal.id, { text });
  output(args, { ok: true, terminalSessionId: terminal.id }, `sent to ${terminal.id}`);
}

/** Documents the eventsCommand helper. */
async function eventsCommand(client: TreesClient, args: Args): Promise<void> {
  /** Documents the print helper. */
  const print = async () => {
    const events = await client.events.query();
    if (booleanArg(args.json)) console.log(JSON.stringify({ schema: "tangent.trees.events.v1", data: events }, null, 2));
    else for (const event of events) console.log(`${event.at} ${event.type} ${event.entityId || ""}`);
  };
  await print();
  if (booleanArg(args.watch)) setInterval(print, 5000);
}

/** Documents the centerCommand helper. */
async function centerCommand(client: TreesClient, args: Args): Promise<void> {
  await refreshAttention(client);
  const projection = await client.projection();
  const open = await client.attention.list();
  const active = projection.agentRuns.filter((run) => run.status === "running" || run.status === "quiet" || run.status === "waiting_permission");
  console.log("Tangent Center");
  console.log(`Entities: ${projection.entities.length}  Attention: ${open.length}  Active agents: ${active.length}`);
  for (const item of open.slice(0, 10)) console.log(`! ${item.severity} ${item.title}`);
}

/** Documents the refreshAttention helper. */
async function refreshAttention(client: TreesClient): Promise<void> {
  const projection = await client.projection();
  await client.attention.upsert(generateAttentionItems(projection));
}

/** Documents the resolveTerminal helper. */
async function resolveTerminal(client: TreesClient, ref: string): Promise<TerminalSession> {
  const projection = await client.projection();
  const direct = projection.terminalSessions.find((terminal) => terminal.id === ref || terminal.agentRunId === ref);
  if (direct) return direct;
  const entity = projection.entities.find((candidate) => candidate.id === ref || candidate.path === ref || candidate.path.endsWith(`/${ref}`));
  const terminal = entity ? [...projection.terminalSessions].reverse().find((candidate) => candidate.entityId === entity.id) : undefined;
  if (!terminal) throw new Error(`No terminal session found for ${ref}`);
  return terminal;
}

/** Documents the runtimeFor helper. */
function runtimeFor(runtimeId: string, sessions: TerminalSession[] = []): TerminalRuntimeAdapter {
  if (runtimeId === "process") return createProcessRuntimeAdapter(sessions);
  if (runtimeId === "tmux") return createTmuxRuntimeAdapter(sessions);
  throw new Error(`Unsupported terminal runtime: ${runtimeId}`);
}

/** Documents the agentRows helper. */
async function agentRows(client: TreesClient, ref?: string): Promise<AgentRun[]> {
  const projection = await client.projection();
  const entity = ref ? projection.entities.find((candidate) => candidate.id === ref || candidate.path === ref || candidate.path.endsWith(`/${ref}`)) : undefined;
  return projection.agentRuns.filter((run) => !ref || run.entityId === entity?.id || run.id === ref);
}

/** Documents the requireEntity helper. */
async function requireEntity(client: TreesClient, ref: string) {
  const entity = await client.entities.get(ref);
  if (!entity) throw new Error(`Unknown tree entity: ${ref}`);
  return entity;
}

if (isDirectRun()) {
  runTreesCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

/** Documents the isDirectRun helper. */
function isDirectRun(): boolean {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
}
