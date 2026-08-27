import { randomUUID } from "node:crypto";
import { renderCommandHelp } from "@tangent/core";
import { booleanArg, parseArgs, stringArg, stringsArg, type Args } from "@tangent/core/cli";

import { currentTmuxSession, goalQueueRevision, postJson, requireGoal, resolveServerUrl, vaultFetch } from "../client.js";
import { brainCommandSpec } from "../spec.js";

/** Dispatches `tangent brain` subcommands. */
export async function runBrainCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv, { repeatable: ["option"] });
  const subcommand = args._[0];
  if (!subcommand || args.help) return help();
  if (subcommand === "advance") return advanceCommand(args);
  if (subcommand === "request") return requestCommand(args);
  if (subcommand === "withdraw") return withdrawCommand(args);
  if (subcommand === "status") return statusCommand(args);
  if (subcommand === "stop") return stopCommand(args);
  if (subcommand === "handover") throw new Error("tangent brain handover is gone: a brain runs until Julian restarts it, and the Area note is its memory. Rewrite the note instead.");
  throw new Error(`Unknown brain command: ${subcommand}. Try "tangent brain status [area]" or "tangent brain stop [area]".`);
}

/** Stops one exact live brain attempt through Agent Shell ownership fencing. */
async function stopCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const requestedArea = stringArg(args._[1]);
  const session = requestedArea ? "" : (stringArg(args.session) || (await currentTmuxSession()) || "");
  if (!requestedArea && !session) throw new Error("tangent brain stop needs an Area, or run it inside the brain's tmux session.");
  const query = requestedArea ? `area=${encodeURIComponent(requestedArea)}` : `session=${encodeURIComponent(session)}`;
  const { brain } = (await vaultFetch(server, `/api/brains/show?${query}`)) as { brain: BrainSummary };
  if (brain.status !== "active") {
    console.log(`${brain.area} brain is already inactive.`);
    return;
  }
  const expectedAttemptId = brain.currentAttemptId || brain.session || "";
  if (!expectedAttemptId) throw new Error(`${brain.area} has no active brain attempt to stop.`);
  await postJson(server, "/api/brains/stop", { area: brain.area, expectedAttemptId, operationId: randomUUID() });
  console.log(`${brain.area} brain stopped. Its Goals remain unchanged.`);
}

/** Withdraws one obsolete Request owned by this live brain. */
async function withdrawCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const session = await requireSession(args, "tangent brain withdraw");
  const id = String(args._[1] ?? "").trim();
  if (!id) throw new Error("tangent brain withdraw needs <request-id>.");
  await postJson(server, "/api/brains/requests/withdraw", { session, id, note: stringArg(args.note)?.trim() || "" });
  console.log(`withdrew Request ${id}`);
}

/** Creates one structured request for Julian. */
async function requestCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const session = await requireSession(args, "tangent brain request");
  const kind = stringArg(args.kind)?.trim() || "";
  const subject = stringArg(args.subject)?.trim() || "";
  const question = stringArg(args.question)?.trim() || "";
  const detail = stringArg(args.detail)?.trim() || "";
  const proposal = stringArg(args.proposal)?.trim() || "";
  const goalSlug = stringArg(args.goal)?.trim() || "";
  const goal = goalSlug ? (await requireGoal(server, goalSlug)).file : "";
  let effect: object | undefined;
  const effectText = stringArg(args.effect)?.trim();
  if (effectText) {
    try { effect = JSON.parse(effectText); }
    catch { throw new Error("--effect must be one JSON object."); }
  }
  const result = await postJson(server, "/api/brains/requests", { session, kind, subject, question, proposal, detail, options: stringsArg(args.option), goal, ...(effect ? { effect } : {}) });
  console.log(`asked Julian: ${String(result.request?.id ?? "request recorded")}`);
}

/** Starts one pending assignment after the brain has read the prior handover. */
async function advanceCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const slug = String(args._[1] ?? "").trim();
  const step = Number(args._[2]);
  if (!slug) throw new Error("tangent brain advance needs <goal> <step>.");
  if (!Number.isInteger(step) || step < 1) throw new Error("tangent brain advance needs a positive step number.");
  const goal = await requireGoal(server, slug);
  const caller = await currentTmuxSession();
  const expectedRevision = await goalQueueRevision(server, goal.file);
  const result = await postJson(server, "/api/pipelines/control", { goal: goal.file, action: "advance", step, expectedRevision, idempotencyKey: randomUUID(), ...(caller ? { caller } : {}) });
  console.log(`started ${slug} step ${step} in ${String(result.next?.session ?? "(no session)")}`);
}

/** Handles `tangent brain status [area]`. */
async function statusCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const area = stringArg(args._[1]);
  const session = area ? "" : (stringArg(args.session) || (await currentTmuxSession()) || "");
  if (!area && !session) throw new Error("tangent brain status needs an Area, or run it inside the brain's tmux session.");
  const query = area ? `area=${encodeURIComponent(area)}` : `session=${encodeURIComponent(session)}`;
  const { brain } = (await vaultFetch(server, `/api/brains/show?${query}`)) as { brain: BrainSummary };
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(brain, null, 2));
    return;
  }
  console.log(`${brain.area}  [${brain.status}${brain.live ? ", live" : ""}]  generation ${brain.generation}  ${brain.session ?? "(no session)"}`);
  console.log(`health: ${brain.health?.status ?? (brain.live ? "healthy" : "unknown")}${brain.health?.problem ? ` · ${brain.health.problem}` : ""}`);
  console.log(`founding message: ${firstLine(brain.foundingInstruction?.text ?? "")}`);
  console.log(`questions: ${(brain.requests ?? []).length} open`);
}

type BrainSummary = {
  area: string;
  status: string;
  live: boolean;
  generation: number;
  session: string | null;
  currentAttemptId?: string | null;
  planFile: string;
  foundingInstruction: { text: string; createdAt: string };
  checkpoint: { text: string; createdAt: string; sourceAttemptId: string | null } | null;
  health?: { status: string; problem?: string | null };
  latestHandover: string | null;
  requests?: unknown[];
};

/** The first line of a text, trimmed. */
function firstLine(text: string): string {
  return String(text ?? "").split("\n")[0]?.trim() ?? "";
}

/** The session that owns the action: --session, or the tmux session this command runs in. */
async function requireSession(args: Args, command: string): Promise<string> {
  const session = stringArg(args.session) || (await currentTmuxSession());
  if (!session) throw new Error(`${command} needs a session: run it inside the brain's tmux session or pass --session <name>.`);
  return session;
}

/** Prints `tangent brain` help with real examples. */
function help(): void {
  console.log(renderCommandHelp(brainCommandSpec));
  console.log(`
Julian starts a brain with a message from the Area row in Agent Shell. The brain
opens in its Area folder, where the harness reads the Area note chain as its
instructions. It runs until Julian restarts it. The Area note is its memory:
rewrite it, do not append.

Examples:
  tangent brain status otto/tangent
  tangent brain stop otto/tangent
  tangent brain request --kind decision --subject "Which harness" --question "Use codex for reviews?" --option codex --option claude

Create plan, decision, and approval requests with \`tangent brain request\`.
Their answers reach this brain as messages. Julian flags what he checks, so a
brain never files a test request.
`);
}
