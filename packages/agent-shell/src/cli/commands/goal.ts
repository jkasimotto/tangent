import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { renderCommandHelp } from "@tangent/core";
import { booleanArg, parseArgs, requiredString, stringArg, stringsArg, type Args } from "@tangent/core/cli";

import { currentTmuxSession, goalQueueRevision, listGoalScope, postJson, requireArea, requireGoal, resolveServerUrl, vaultFetch } from "../client.js";
import { goalCommandSpec } from "../spec.js";
import { parseWorkerReportOption, workerHandoverResultLine } from "../worker-report.js";

/** Dispatches `tangent goal` subcommands. */
export async function runGoalCli(argv = process.argv.slice(2)): Promise<void> {
  // Boolean flags never consume the token after them.
  const args = parseArgs(argv, { repeatable: ["source", "subgoal-title", "subgoal-done-when", "step", "launch", "path", "continue-from", "kind", "on", "status"], boolean: ["continue", "own"] });
  const subcommand = args._[0];
  if (!subcommand) return help();
  // "done" and "wont-do" handle --help themselves, to restate that status is written on
  // Julian's word only; the other subcommands fall back to the noun-level help.
  if (subcommand === "create") return args.help ? help() : createCommand(args);
  if (subcommand === "list") return args.help ? help() : listCommand(args);
  if (subcommand === "show") return args.help ? help() : showCommand(args);
  if (subcommand === "own") return args.help ? help() : ownershipCommand(args, "own");
  if (subcommand === "release") return args.help ? help() : ownershipCommand(args, "release");
  if (subcommand === "depend") return args.help ? help() : dependencyCommand(args, false);
  if (subcommand === "undepend") return args.help ? help() : dependencyCommand(args, true);
  if (subcommand === "start") return args.help ? help() : startCommand(args);
  if (subcommand === "append") return args.help ? help() : appendCommand(args);
  if (subcommand === "handover") return args.help ? help() : handoverCommand(args);
  if (subcommand === "done") return doneCommand(args);
  if (subcommand === "wont-do") return wontDoCommand(args);
  if (subcommand === "park") return args.help ? help() : parkCommand(args);
  if (subcommand === "reopen") return args.help ? help() : reopenCommand(args);
  if (subcommand === "replace-agent") return args.help ? help() : replaceAgentCommand(args);
  throw new Error(`Unknown goal command: ${subcommand}. Try "tangent goal --help".`);
}

/** Adds or removes advisory prerequisite links for one Goal. */
async function dependencyCommand(args: Args, removing: boolean): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const slug = requiredString(args._[1], `tangent goal ${removing ? "undepend" : "depend"} requires <slug>.`);
  await requireGoal(server, slug);
  const on = stringsArg(args.on).map((item) => item.trim()).filter(Boolean);
  if (!on.length) throw new Error(`tangent goal ${removing ? "undepend" : "depend"} requires --on <prerequisite>.`);
  for (const prerequisite of on) await requireGoal(server, prerequisite);
  const caller = stringArg(args.session) || (await currentTmuxSession());
  const result = await postJson(server, `/api/goals/${removing ? "undepend" : "depend"}`, { slug, on, ...(caller ? { caller } : {}) });
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const dependencies = Array.isArray(result.dependsOn) ? result.dependsOn.join(", ") : "";
  console.log(`${slug} depends on: ${dependencies || "nothing"}${result.changed === false ? " (unchanged)" : ""}`);
}

/** Handles `tangent goal create`. */
async function createCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const area = await requireArea(server, requiredString(args.area, "tangent goal create requires --area <path>."));
  const title = requiredString(args.title, "tangent goal create requires --title <text>.");
  const doneWhen = requiredString(args["done-when"], "tangent goal create requires --done-when <condition>.");
  const subgoalTitles = stringsArg(args["subgoal-title"]);
  const subgoalDoneConditions = stringsArg(args["subgoal-done-when"]);
  if (subgoalTitles.length !== subgoalDoneConditions.length) {
    throw new Error("Each --subgoal-title needs one --subgoal-done-when in the same position.");
  }
  const explicitSession = stringArg(args.session);
  const own = booleanArg(args.own) ? await requireSession(args, "tangent goal create --own") : "";
  const caller = explicitSession || (await currentTmuxSession());
  const result = await postJson(server, "/api/goals/create", {
    area,
    description: stringArg(args.description)?.trim() || "",
    goal: { title, doneWhen, state: "Not started." },
    subgoals: subgoalTitles.map((subgoalTitle, index) => ({
      title: subgoalTitle.trim(),
      doneWhen: subgoalDoneConditions[index]!.trim()
    })),
    sources: stringsArg(args.source).map((source) => source.trim()).filter(Boolean),
    ...(caller ? { caller } : {}),
    ...(own ? { own } : {})
  });
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`goal: ${result.file}`);
  for (const file of (result.files || []) as string[]) {
    if (file !== result.file) console.log(`  subgoal: ${file}`);
  }
  if (own) console.log(`owned by ${own}`);
}

/** Handles `tangent goal own <slug...>` and `tangent goal release <slug...>`. */
async function ownershipCommand(args: Args, verb: "own" | "release"): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const slugs = args._.slice(1).map(String).filter(Boolean);
  if (!slugs.length) throw new Error(`tangent goal ${verb} requires at least one <slug>.`);
  const session = await requireSession(args, `tangent goal ${verb}`);
  const result = await postJson(server, `/api/goals/${verb}`, { session, slugs });
  const listed = (result.slugs as string[] | undefined)?.join(", ") || slugs.join(", ");
  console.log(verb === "own" ? `${session} now owns ${listed}` : `released ${listed}`);
}

/**
 * Handles `tangent goal start <slug> [--step <instruction> --launch <harness[/model[/effort]]> --path <directory> --continue-from <n|->]...`.
 * Without --step it starts one agent on the Goal, the same as the desk's Start agent, and its one
 * --launch names that agent's harness. With steps it posts a pipeline to the same endpoint; the
 * server records it and starts step 1.
 */
async function startCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const slug = requiredString(args._[1], "tangent goal start requires <slug>.");
  const goal = await requireGoal(server, slug);
  const caller = stringArg(args.session) || (await currentTmuxSession());
  const recovery = booleanArg(args.recovery);
  const steps = pipelineSteps(args);
  const solo = steps.length ? undefined : soloLaunch(args);
  const result = recovery
    ? await postJson(server, "/api/goals/start", { file: goal.file, recovery: true, ...(caller ? { caller } : {}) })
    : steps.length
    ? await postJson(server, "/api/goals/start", { file: goal.file, steps, recovery, ...(caller ? { caller } : {}) })
    : await postJson(server, "/api/goals/start", { file: goal.file, approved: true, launch: true, ...(solo ? { choice: solo } : {}), recovery, ...(caller ? { caller } : {}) });
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printLaunches(result);
  printLaunchWarnings(result);
  const session = result.session ? String(result.session) : "(no session)";
  if (result.status === "queued") console.log(`queued ${slug} for its exact Area brain`);
  else if (steps.length) console.log(`started ${slug}: ${steps.length} step${steps.length === 1 ? "" : "s"}, step 1 in ${session}${recovery ? " (recovery)" : ""}`);
  else console.log(`started ${slug} in ${session}${recovery ? " (recovery)" : ""}`);
}

/**
 * The one --launch of a start with no --step, or undefined when the caller
 * named none. An omitted launch reaches the server, which lends the calling
 * brain's own harness or refuses. The client never picks a harness itself.
 */
function soloLaunch(args: Args): { harness: string; model?: string; effort?: string } | undefined {
  const launches = stringsArg(args.launch);
  if (launches.length > 1) throw new Error("Starting a Goal without --step takes exactly one --launch.");
  return parseLaunch(launches[0]);
}

/**
 * Prints the harness each assignment will run, before the line that says one
 * started. The server materializes these rows and discloses the same choice
 * in the queue record before it creates any session.
 */
function printLaunches(result: { launches?: unknown }): void {
  const launches = Array.isArray(result.launches) ? (result.launches as { index?: number; launch?: string; source?: string; command?: string }[]) : [];
  for (const row of launches) {
    const source = row.source === "brain-default" ? " (your brain's harness)" : "";
    console.log(`launch: step ${row.index} runs ${row.launch ?? row.command ?? "(edited command)"}${source}`);
  }
}

/** Prints one line per step whose --launch harness differs from the applied default; the server computes them. */
function printLaunchWarnings(result: { warnings?: unknown }): void {
  const warnings = Array.isArray(result.warnings) ? (result.warnings as string[]) : [];
  for (const warning of warnings) console.error(`warning: ${warning}`);
}

/**
 * Handles `tangent goal append <slug> --step <instruction> [--launch ...] [--path ...] [--continue-from ...]...`.
 * Adds steps after the ones that already ran. The server says what happened: the steps wait
 * behind the running step, the finished last agent was asked to hand over again, or the first
 * new step started.
 */
async function appendCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const slug = requiredString(args._[1], "tangent goal append requires <slug>.");
  const goal = await requireGoal(server, slug);
  const steps = pipelineSteps(args, { appending: true });
  if (!steps.length) throw new Error("tangent goal append needs at least one --step.");
  const caller = stringArg(args.session) || (await currentTmuxSession());
  const expectedRevision = await goalQueueRevision(server, goal.file);
  const result = await postJson(server, "/api/pipelines/append", { goal: goal.file, steps, expectedRevision, idempotencyKey: randomUUID(), ...(caller ? { caller } : {}) });
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printLaunches(result);
  printLaunchWarnings(result);
  const added = Array.isArray(result.added) ? (result.added as number[]) : [];
  const which = added.length > 1 ? `steps ${added[0]} to ${added[added.length - 1]}` : `step ${added[0] ?? "?"}`;
  const next = result.next as { index?: number; session?: string } | null | undefined;
  if (result.status === "asked") console.log(`added ${which} to ${slug}; step ${String(result.after)}'s agent (${String(result.session)}) was asked to hand over again`);
  else if (result.status === "started") console.log(`added ${which} to ${slug}; step ${String(next?.index ?? added[0])} started in ${String(next?.session ?? "(no session)")}`);
  else console.log(`added ${which} to ${slug}; it starts when step ${String(result.after)} hands over`);
}

type PipelineStepInput = {
  instruction: string;
  launch?: { harness: string; model?: string; effort?: string };
  path?: string;
  kind?: "implementation" | "review";
  continueFrom: number | null;
};

type QueueAssignmentView = {
  id?: string;
  status?: string;
  session?: string | null;
  attempts?: Array<{ id?: string; session?: string; endedAt?: string | null }>;
};

/** Reads the canonical or compatibility assignment array from one Goal detail queue. */
function queueAssignments(queue: Record<string, any>): QueueAssignmentView[] {
  if (Array.isArray(queue.assignments)) return queue.assignments as QueueAssignmentView[];
  if (Array.isArray(queue.steps)) return queue.steps as QueueAssignmentView[];
  return [];
}

/**
 * Pairs each --step with the --launch, --path, and --continue-from at the same position. When appending,
 * a step may continue any step of the existing pipeline, so only the server (which knows the final
 * numbering) checks the upper bound.
 */
function pipelineSteps(args: Args, { appending = false } = {}): PipelineStepInput[] {
  const instructions = stringsArg(args.step).map((step) => step.trim());
  const launches = stringsArg(args.launch);
  const paths = stringsArg(args.path);
  const continues = stringsArg(args["continue-from"]);
  const kinds = stringsArg(args.kind);
  if (instructions.some((instruction) => !instruction)) throw new Error("Each --step needs an instruction.");
  // Without a --step there is nothing for a directory to belong to, and a
  // silently dropped --path would start the worker in the wrong repository.
  if (!instructions.length && paths.length) throw new Error("--path belongs to a --step; add --step \"<instruction>\" or start the Goal without --path.");
  // No --step is the solo form; its single --launch belongs to the Goal, not to a step.
  if (!instructions.length) return [];
  if (launches.length > instructions.length) throw new Error("More --launch values than --step values; each --launch pairs with the --step at the same position.");
  if (paths.length > instructions.length) throw new Error("More --path values than --step values; each --path pairs with the --step at the same position.");
  if (continues.length > instructions.length) throw new Error("More --continue-from values than --step values; each pairs with the --step at the same position.");
  if (kinds.length > instructions.length) throw new Error("More --kind values than --step values; each pairs with the --step at the same position.");
  return instructions.map((instruction, index) => {
    const step: PipelineStepInput = { instruction, continueFrom: parseContinueFrom(continues[index], appending ? Number.POSITIVE_INFINITY : index + 1) };
    const launch = parseLaunch(launches[index]);
    if (launch) step.launch = launch;
    const workingDirectory = parseStepPath(paths[index]);
    if (workingDirectory) step.path = workingDirectory;
    const kind = kinds[index]?.trim() || "implementation";
    if (!(["implementation", "review"] as string[]).includes(kind)) throw new Error(`--kind for step ${index + 1} must be implementation or review.`);
    step.kind = kind as PipelineStepInput["kind"];
    return step;
  });
}

/**
 * One step's working directory as an absolute path. `~` and a relative
 * directory resolve against the shell that runs the command, because the
 * Agent Shell server cannot see the caller's directory. Undefined, and the
 * empty `--path=` that skips a position, both mean the Area repository.
 */
function parseStepPath(value: string | undefined): string | undefined {
  const requested = value?.trim();
  if (!requested) return undefined;
  return path.resolve(requested.replace(/^~(?=\/|$)/, os.homedir()));
}

/** Parses `harness[/model[/effort]]` into a launch reference; undefined when no --launch was given for the position. */
function parseLaunch(value: string | undefined): PipelineStepInput["launch"] | undefined {
  if (value === undefined) return undefined;
  const [harness, model, effort, ...rest] = value.split("/").map((part) => part.trim());
  if (!harness || rest.length) throw new Error(`--launch must be <harness[/model[/effort]]>, got "${value}".`);
  return { harness, ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}

/** Parses one --continue-from value: a 1-based step number before this step, or `-` for a fresh session. */
function parseContinueFrom(value: string | undefined, stepIndex: number): number | null {
  if (value === undefined || value.trim() === "" || value.trim() === "-") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n >= stepIndex) {
    const range = Number.isFinite(stepIndex) ? ` (1 to ${stepIndex - 1})` : "";
    throw new Error(`--continue-from${Number.isFinite(stepIndex) ? ` for step ${stepIndex}` : ""} must be an earlier step number${range} or -, got "${value}".`);
  }
  return n;
}

/**
 * Handles `tangent goal handover <facts...>`. A worker submits evidence or a
 * typed report; the exact Area brain controls every later attempt.
 */
async function handoverCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const session = await requireSession(args, "tangent goal handover");
  const text = args._.slice(1).map(String).join(" ").trim();
  if (!text) throw new Error("tangent goal handover needs the facts as text.");
  if (booleanArg(args.continue)) throw new Error("--continue is retired. Submit a typed context-risk report; the exact Area brain starts any fresh attempt.");
  const body: Record<string, unknown> = { session, text };
  const report = parseWorkerReportOption(args);
  if (report) body.report = report;
  const result = await postJson(server, "/api/goals/handover", body);
  console.log(workerHandoverResultLine(result));
}

/** The session that owns the action: --session, or the tmux session this command runs in. */
async function requireSession(args: Args, command: string): Promise<string> {
  const session = stringArg(args.session) || (await currentTmuxSession());
  if (!session) throw new Error(`${command} needs a session: run it inside the agent's tmux session or pass --session <name>.`);
  return session;
}

/** Handles `tangent goal list [area]`. */
async function listCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const areaArg = stringArg(args._[1]);
  const area = areaArg ? await requireArea(server, areaArg) : undefined;
  const scope = await listGoalScope(server, area, booleanArg(args.subtree), {
    status: stringsArg(args.status),
    changedSince: stringArg(args["changed-since"]) ?? "",
    query: stringArg(args.query) ?? "",
  });
  const goals = scope.goals;
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(scope, null, 2));
    return;
  }
  if (!goals.length) console.log(scope.filters && (scope.filters.status.length || scope.filters.changedSince || scope.filters.query) ? "No Goals match these filters." : "No Goals.");
  for (const goal of goals) console.log(`${goal.slug}  [${goal.status}]  ${goal.area}  ${goal.title}`);
  // The scent that the Portland brain did not have: an exact Area that looks
  // empty still says how much work its child Areas hold, and the command
  // that reads it.
  if (scope.subtreeCommand) {
    console.log(`\n${scope.descendantGoals} more in ${scope.childAreas} child ${scope.childAreas === 1 ? "Area" : "Areas"}. Run: ${scope.subtreeCommand}`);
  }
}

/** Handles `tangent goal show <slug>`. */
async function showCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const slug = requiredString(args._[1], "tangent goal show requires <slug>.");
  const goal = await requireGoal(server, slug);
  const detail = await vaultFetch(server, `/api/goals/detail?goal=${encodeURIComponent(goal.file)}`);
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(detail, null, 2));
    return;
  }
  const projectedGoal = detail.goal ?? goal;
  console.log(`${projectedGoal.title ?? goal.title}  [${projectedGoal.status ?? goal.status}]`);
  console.log(`area: ${projectedGoal.area ?? goal.area}`);
  console.log(`file: ${projectedGoal.file ?? goal.file}`);
  if (projectedGoal.doneWhen ?? goal.doneWhen) console.log(`done when: ${projectedGoal.doneWhen ?? goal.doneWhen}`);
  const state = String(detail.goal?.stateText ?? detail.goal?.state ?? "").trim();
  if (state) console.log(`state: ${state}`);
  const notes = String(detail.goal?.storyText ?? detail.goal?.currentBrief ?? "").trim();
  if (notes) console.log(`notes: ${notes}`);
  const dependencies = (Array.isArray(detail.dependencies?.prerequisites) ? detail.dependencies.prerequisites : []) as Array<{ title?: string; slug?: string; file?: string }>;
  if (dependencies.length) console.log(`depends on: ${dependencies.map((item) => item.title ?? item.slug ?? item.file).join(", ")}`);
  const unresolved = Array.isArray(detail.dependencies?.unresolvedReferences) ? detail.dependencies.unresolvedReferences : [];
  if (unresolved.length) console.log(`missing dependencies: ${unresolved.join(", ")}`);
  const queue = detail.queue;
  if (queue) {
    const assignments = queueAssignments(queue);
    console.log(`queue: ${queue.status ?? "open"}, revision ${queue.revision ?? "?"}, ${assignments.length} assignment${assignments.length === 1 ? "" : "s"}`);
    const current = assignments.find((item) => item.id === queue.currentAssignmentId) ?? assignments.find((item) => ["running", "waiting", "stopped"].includes(String(item.status ?? "")));
    if (current) console.log(`current agent: ${current.session ?? "none"} (${current.status ?? "unknown"})`);
  }
}

/** Handles `tangent goal done <slug>`. Status is written on Julian's explicit word, or a brain closing a Goal under its own plan on a passing review; see helpDoneWontDo(). */
async function doneCommand(args: Args): Promise<void> {
  if (args.help) return helpDoneWontDo("done");
  const server = resolveServerUrl(stringArg(args.server));
  const slug = requiredString(args._[1], "tangent goal done requires <slug>.");
  const goal = await requireGoal(server, slug);
  if (goal.status === "done") {
    console.log(`${slug} is already done.`);
    return;
  }
  await postJson(server, "/api/goals/edit", { file: goal.file, status: "done", session: await currentTmuxSession() });
  console.log(`${slug} marked done.`);
}

/** Handles `tangent goal wont-do <slug> --reason <text>`. Status is written on Julian's explicit word, or a brain closing a Goal under its own plan on a passing review; see helpDoneWontDo(). */
async function wontDoCommand(args: Args): Promise<void> {
  if (args.help) return helpDoneWontDo("wont-do");
  const server = resolveServerUrl(stringArg(args.server));
  const slug = requiredString(args._[1], "tangent goal wont-do requires <slug>.");
  const reason = requiredString(args.reason, 'tangent goal wont-do requires --reason "<text>".');
  const goal = await requireGoal(server, slug);
  if (goal.status === "dropped") {
    console.log(`${slug} is already marked won't do.`);
    return;
  }
  await postJson(server, "/api/goals/edit", { file: goal.file, status: "dropped", reason, session: await currentTmuxSession() });
  console.log(`${slug} marked won't do: ${reason}`);
}

/** Handles `tangent goal park <slug> [--reason <text>]`. */
async function parkCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const slug = requiredString(args._[1], "tangent goal park requires <slug>.");
  const goal = await requireGoal(server, slug);
  if (["parked", "deferred"].includes(goal.status)) {
    console.log(`${slug} is already parked.`);
    return;
  }
  const reason = stringArg(args.reason)?.trim() || "";
  await postJson(server, "/api/goals/edit", { file: goal.file, status: "parked", ...(reason ? { reason } : {}), session: await currentTmuxSession() });
  console.log(`${slug} parked${reason ? `: ${reason}` : "."}`);
}

/** Handles `tangent goal reopen <slug>`. */
async function reopenCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const slug = requiredString(args._[1], "tangent goal reopen requires <slug>.");
  const goal = await requireGoal(server, slug);
  if (goal.status === "open") {
    console.log(`${slug} is already open.`);
    return;
  }
  await postJson(server, "/api/goals/edit", { file: goal.file, status: "open", session: await currentTmuxSession() });
  console.log(`${slug} reopened. It was not started.`);
}

/** Handles an exact current-attempt replacement with one registered launch choice. */
async function replaceAgentCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const slug = requiredString(args._[1], "tangent goal replace-agent requires <slug>.");
  const launch = parseLaunch(requiredString(stringsArg(args.launch)[0], "tangent goal replace-agent requires --launch <harness[/model[/effort]]>."));
  if (stringsArg(args.launch).length !== 1 || !launch) throw new Error("tangent goal replace-agent takes exactly one --launch.");
  const goal = await requireGoal(server, slug);
  const detail = await vaultFetch(server, `/api/goals/detail?goal=${encodeURIComponent(goal.file)}`);
  const queue = detail.queue;
  if (!queue || !Number.isInteger(queue.revision)) throw new Error("This Goal has no authoritative queue to replace.");
  const assignments = queueAssignments(queue);
  const assignmentId = detail.current?.assignmentId ?? queue.currentAssignmentId;
  const assignment = assignments.find((item) => item.id === assignmentId)
    ?? assignments.find((item) => ["running", "waiting", "stopped"].includes(String(item.status ?? "")));
  if (!assignment) throw new Error("This Goal has no current assignment to replace.");
  const attempt = Array.isArray(assignment.attempts) ? assignment.attempts.slice().reverse().find((item) => !item.endedAt) ?? assignment.attempts.at(-1) : null;
  const expectedAttemptId = detail.current?.attemptId ?? attempt?.id;
  if (!expectedAttemptId) throw new Error("This Goal has no current attempt identity to replace safely.");
  const result = await postJson(server, "/api/goals/attempts/replace", {
    goal: goal.file,
    assignmentId: assignment.id,
    expectedRevision: queue.revision,
    expectedAttemptId,
    launch,
    operationId: randomUUID(),
    caller: stringArg(args.session) || (await currentTmuxSession()) || "",
  });
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const replacement = result.session ?? result.operation?.replacementSession ?? "(replacement pending)";
  console.log(`replacement for ${slug}: ${replacement} [${result.status ?? result.operation?.status ?? "requested"}]`);
  if (result.requiresConfirmation) console.log("The source agent is still alive. Inspect the replacement before you finish the swap.");
}

/** Prints `tangent goal` help with real examples. */
function help(): void {
  console.log(renderCommandHelp(goalCommandSpec));
  console.log(`
Examples:
  tangent goal create --area otto/dnd --title "Connect chosen ramp faces" --done-when "The chosen faces connect at the dragged width."
  tangent goal create --area otto/dnd --title "Fix the flicker" --done-when "The strip repaints without flicker." --own
  tangent goal list otto/dnd
  tangent goal show connect-chosen-ramp-faces
  tangent goal own connect-chosen-ramp-faces render-cursor-presence
  tangent goal release connect-chosen-ramp-faces
  tangent goal start connect-chosen-ramp-faces --launch codex/sol/low
  tangent goal start pipelines-demo --step "/design this" --launch claude-otto/fable-5 --step "review the design and update it" --launch codex/sol/high --step "implement" --launch claude-otto/opus-5
  tangent goal start pipelines-demo --step "/design this" --launch claude-otto/fable-5 --step "implement the design" --launch claude-otto/opus-5 --continue-from - --continue-from 1
  tangent goal start pipelines-demo --step "design the change" --launch claude-otto/fable-5 --path= --step "implement it in the plugin" --launch claude-otto/opus-5 --path ~/Projects/plugin
  tangent goal append pipelines-demo --step "review the implementation" --kind review --launch codex/sol/high
  tangent goal replace-agent pipelines-demo --launch codex/sol/high
  tangent goal park pipelines-demo --reason "Revisit after the current release."
  tangent goal reopen pipelines-demo
  tangent goal handover "Design written: ~/.tangent/trees/otto/tangent/design-x.md. Unresolved: none."
`);
}

/** Prints the done/won't-do subcommand's help, restating that status is written on Julian's word only. */
function helpDoneWontDo(subcommand: "done" | "wont-do"): void {
  console.log(`tangent goal ${subcommand} <slug>${subcommand === "wont-do" ? ' --reason "<text>"' : ""}`);
  console.log("");
  console.log("Run only on Julian's explicit word, except a brain started by Julian: it closes Goals under its own plan on a passing review. Status is written on the user's say-so.");
  console.log("");
  console.log("Examples:");
  if (subcommand === "done") console.log("  tangent goal done connect-chosen-ramp-faces");
  else console.log('  tangent goal wont-do connect-chosen-ramp-faces --reason "The simpler flow already solves this need."');
}
