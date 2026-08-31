import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { renderCommandHelp } from "@tangent/core";
import { booleanArg, parseArgs, requiredString, stringArg, stringsArg, type Args } from "@tangent/core/cli";

import { currentTmuxSession, goalQueueRevision, listGoalScope, postJson, requireArea, requireGoal, resolveServerUrl, vaultFetch } from "../client.js";
import { goalCommandSpec } from "../spec.js";

/** Dispatches `tangent goal` subcommands. */
export async function runGoalCli(argv = process.argv.slice(2)): Promise<void> {
  // Boolean flags never consume the token after them.
  const args = parseArgs(argv, { repeatable: ["source", "subgoal-title", "subgoal-done-when", "step", "launch", "path", "continue-from", "kind", "on", "status", "url", "label", "item", "commit", "review"], boolean: ["continue", "own", "confirm", "start", "verify", "withdraw"] });
  const subcommand = args._[0];
  if (!subcommand) return help();
  // `tangent goal <subcommand> --help` prints that subcommand's own flags:
  // the brain's reference for syntax (ADR-0041). "done" and "wont-do" handle
  // --help themselves, to restate whose word writes status.
  if (args.help && !["done", "wont-do"].includes(subcommand)) return subcommandHelp(subcommand);
  if (subcommand === "create") return createCommand(args);
  if (subcommand === "list") return listCommand(args);
  if (subcommand === "show") return showCommand(args);
  if (subcommand === "own") return ownershipCommand(args, "own");
  if (subcommand === "release") return ownershipCommand(args, "release");
  if (subcommand === "depend") return dependencyCommand(args, false);
  if (subcommand === "undepend") return dependencyCommand(args, true);
  if (subcommand === "start") { console.error("tangent goal start is now tangent job create, then tangent job start"); return startCommand(args); }
  if (subcommand === "append") { console.error("tangent goal append is now tangent job append"); return appendCommand(args); }
  if (subcommand === "done") return doneCommand(args);
  if (subcommand === "wont-do") return wontDoCommand(args);
  if (subcommand === "park") return parkCommand(args);
  if (subcommand === "reopen") return reopenCommand(args);
  if (subcommand === "replace-agent") { console.error("tangent goal replace-agent is now tangent job replace"); return replaceAgentCommand(args); }
  if (subcommand === "present") return presentCommand(args);
  throw new Error(`Unknown goal command: ${subcommand}. Try "tangent goal --help".`);
}

/** Presents or withdraws one Goal document for Julian. */
async function presentCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const slug = requiredString(args._[1], "tangent goal present requires <slug>.");
  const goal = await requireGoal(server, slug);
  const files = args._.slice(2).map(String).filter(Boolean);
  const session = stringArg(args.session) || (await currentTmuxSession()) || "";
  const withdrawCard = stringArg(args["withdraw-card"]);
  const kind = stringArg(args.card);
  if (withdrawCard) {
    if (files.length || kind) throw new Error("--withdraw-card takes no file or --card.");
    await postJson(server, "/api/goals/withdraw-card", { goal: goal.file, title: withdrawCard, session });
    console.log(`withdrew card "${withdrawCard}" from ${slug}`);
    return;
  }
  if (kind) {
    if (files.length) throw new Error("--card takes no file.");
    const title = requiredString(args.title, "--card requires --title.");
    const fields = cardFields(kind, title, args);
    const result = await postJson(server, "/api/goals/present-card", { goal: goal.file, session, card: { kind, title, fields } });
    console.log(`${result.changed === false ? "unchanged" : "presented"} ${kind} card "${title}" on ${slug}`);
    return;
  }
  if (!files.length) throw new Error("tangent goal present requires at least one <file>, --card, or --withdraw-card.");
  if (booleanArg(args.withdraw)) {
    if (files.length !== 1) throw new Error("tangent goal present --withdraw takes one <file>.");
    await postJson(server, "/api/goals/withdraw-presentation", { goal: goal.file, file: files[0], session });
    console.log(`withdrew ${files[0]} from ${slug}`);
    return;
  }
  const result = await postJson(server, "/api/goals/present", { goal: goal.file, files, note: stringArg(args.note) ?? "", session });
  console.log(`presented ${result.items.length} document${result.items.length === 1 ? "" : "s"} on ${slug}`);
}

/** Splits one repeatable card field at its last colon. */
function splitLast(value: string, label: string): [string, string] {
  const at = value.lastIndexOf(":");
  if (at < 1) throw new Error(`${label} must contain a colon.`);
  return [value.slice(0, at), value.slice(at + 1)];
}

/** Converts repeatable CLI fields to raw card data; the server owns validation. */
function cardFields(kind: string, title: string, args: Args): Record<string, unknown> {
  if (kind === "copy") return { text: stringArg(args.text) };
  const urls = stringsArg(args.url); const labels = stringsArg(args.label);
  if (kind === "link") {
    if (urls.length !== 1 || labels.length > 1) throw new Error("link needs one --url and at most one --label.");
    return { url: urls[0], label: labels[0] || title };
  }
  if (kind === "links") {
    if (!urls.length || urls.length !== labels.length) throw new Error("links needs matching --label and --url flags.");
    return { items: urls.map((url, index) => ({ label: labels[index], url })) };
  }
  if (kind === "progress") return { steps: stringsArg(args.step).map((value) => { const [label, status] = splitLast(value, "--step"); return { label, status }; }), current: stringArg(args.current) };
  if (kind === "checklist") return { items: stringsArg(args.item).map((value) => {
    const [label, raw] = splitLast(value, "--item"); const normalized = raw.toLowerCase();
    if (!["yes", "no", "true", "false", "done", "open", "1", "0"].includes(normalized)) throw new Error("--item done must be yes, no, true, false, done, open, 1, or 0.");
    return { label, done: ["yes", "true", "done", "1"].includes(normalized) };
  }) };
  if (kind === "commits") return { repo: stringArg(args.repo), commits: stringsArg(args.commit).map((value) => {
    const at = value.indexOf(":"); if (at < 1) throw new Error("--commit must be <hash>:<subject>[:<url>].");
    const hash = value.slice(0, at); const rest = value.slice(at + 1); const match = rest.match(/:(https?:\/\/\S+)$/);
    return { hash, subject: match ? rest.slice(0, match.index) : rest, ...(match ? { url: match[1] } : {}) };
  }) };
  if (kind === "reviews") return { items: stringsArg(args.review).map((value) => {
    const first = value.indexOf(":"); const last = value.lastIndexOf(":"); const middle = value.slice(first + 1, last); const match = middle.match(/https?:\/\/\S+/);
    if (first < 1 || last <= first || !match) throw new Error("--review must be <id>:<title>:<url>:<state>.");
    return { id: value.slice(0, first), title: middle.slice(0, match.index).replace(/:$/, ""), url: match[0], state: value.slice(last + 1) };
  }) };
  return {};
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

/**
 * Handles `tangent goal create`. With `--start` (brains only) the server
 * creates the Goal and starts its worker in one call: `--path` names the
 * worker's folder, `--launch` its harness (else the brain's own is lent),
 * `--verify` flags the Goal for Julian's own check, and `--instruction` or
 * `--instruction-file` is the worker's first message in the brain's words.
 */
async function createCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const area = await requireArea(server, requiredString(args.area, "tangent goal create requires --area <path>."));
  const title = requiredString(args.title, "tangent goal create requires --title <text>.");
  const doneWhen = stringArg(args["done-when"])?.trim() || title;
  const start = booleanArg(args.start);
  const verify = booleanArg(args.verify);
  const instructionFile = stringArg(args["instruction-file"]);
  if (instructionFile && stringArg(args.instruction)) throw new Error("Pass --instruction or --instruction-file, not both.");
  const instruction = instructionFile ? (await readFile(parseStepPath(instructionFile)!, "utf8")).trim() : stringArg(args.instruction)?.trim() || "";
  const launches = stringsArg(args.launch);
  if (launches.length > 1) throw new Error("tangent goal create takes at most one --launch.");
  const launch = parseLaunch(launches[0]);
  const workerPath = parseStepPath(stringsArg(args.path)[0]);
  if (!start && (launch || workerPath || instruction)) throw new Error("--launch, --path, and --instruction belong to --start. Add --start, or create the Goal without them.");
  const subgoalTitles = stringsArg(args["subgoal-title"]);
  const subgoalDoneConditions = stringsArg(args["subgoal-done-when"]);
  if (subgoalTitles.length !== subgoalDoneConditions.length) {
    throw new Error("Each --subgoal-title needs one --subgoal-done-when in the same position.");
  }
  const explicitSession = stringArg(args.session);
  const own = booleanArg(args.own) ? await requireSession(args, "tangent goal create --own") : "";
  const caller = explicitSession || (await currentTmuxSession());
  const result = await postJson(server, "/api/goals/create", {
    operationId: randomUUID(),
    area,
    description: stringArg(args.description)?.trim() || "",
    goal: { title, doneWhen, state: "Not started." },
    subgoals: subgoalTitles.map((subgoalTitle, index) => ({
      title: subgoalTitle.trim(),
      doneWhen: subgoalDoneConditions[index]!.trim()
    })),
    sources: stringsArg(args.source).map((source) => source.trim()).filter(Boolean),
    ...(caller ? { caller } : {}),
    ...(own ? { own } : {}),
    ...(verify ? { verify: true } : {}),
    ...(start ? { start: true } : {}),
    ...(start && instruction ? { instruction } : {}),
    // A process note as the instruction file links the Goal to its process
    // (`process:` in the Goal frontmatter), so the scheduler skips the
    // process while this Goal is open (ADR-0043).
    ...(start && instructionFile ? { instructionFile: parseStepPath(instructionFile) } : {}),
    ...(start && workerPath ? { path: workerPath } : {}),
    ...(start && launch ? { launch } : {}),
  });
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`goal: ${result.file}`);
  for (const file of (result.files || []) as string[]) {
    if (file !== result.file) console.log(`  subgoal: ${file}`);
  }
  if (verify) console.log("Julian checks this Goal himself: done becomes Check it.");
  if (own) console.log(`owned by ${own}`);
  if (start) {
    printLaunches(result);
    printLaunchWarnings(result);
    if (result.started) console.log(`started in ${String(result.session)}`);
    else console.error(`The Goal exists, but its worker did not start: ${String(result.startError ?? "unknown error")}`);
  }
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
 * Brains only: the server refuses every other caller (D8). Without --step it starts one worker on
 * the Goal, and its one --launch names that worker's harness. With steps it posts a pipeline to the
 * same endpoint; the server records it and starts step 1.
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
    : await (async () => {
      const assignments = steps.length ? steps : [{ instruction: `Complete ${goal.title}. Done when: ${goal.doneWhen}`, ...(solo ? { launch: solo } : {}) }];
      const created = await postJson(server, "/api/jobs/create", { goal: goal.file, steps: assignments, operationId: randomUUID(), compatAlias: "goal start", ...(caller ? { caller } : {}) });
      return postJson(server, "/api/jobs/start", { goal: goal.file, expectedRun: created.job.run, expectedRevision: created.job.revision, operationId: randomUUID(), compatAlias: "goal start", ...(caller ? { caller } : {}) });
    })();
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printLaunches(result);
  printLaunchWarnings(result);
  const session = result.session ? String(result.session) : "(no session)";
  if (result.status === "queued") console.log(`created ${slug} Job`);
  else if (steps.length) console.log(`started ${slug}: ${steps.length} Assignment${steps.length === 1 ? "" : "s"}, Assignment 1 in ${session}${recovery ? " (recovery)" : ""}`);
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
 * Prints the harness each assignment will run and the folder it runs in,
 * before the line that says one started. The server materializes these rows
 * and discloses the same choices in the queue record before it creates any
 * session.
 */
function printLaunches(result: { launches?: unknown }): void {
  const launches = Array.isArray(result.launches) ? (result.launches as { index?: number; launch?: string; source?: string; command?: string; cwd?: string | null }[]) : [];
  for (const row of launches) {
    const source = row.source === "brain-default" ? " (your brain's harness)" : "";
    const folder = row.cwd ? ` in ${row.cwd}` : "";
    console.log(`launch: Assignment ${row.index} uses ${row.launch ?? row.command ?? "(edited command)"}${source}${folder}`);
  }
}

/** Prints one line per step whose --launch harness differs from the applied default; the server computes them. */
function printLaunchWarnings(result: { warnings?: unknown }): void {
  const warnings = Array.isArray(result.warnings) ? (result.warnings as string[]) : [];
  for (const warning of warnings) console.error(`warning: ${warning}`);
}

/**
 * Handles `tangent goal append <slug> --step <instruction> [--launch ...] [--path ...] [--continue-from ...]...`.
 * Brains only (D8). Adds steps after the ones that already ran. The server says what happened: the steps wait
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
  const shown = await vaultFetch(server, `/api/jobs/show?goal=${encodeURIComponent(goal.file)}`);
  const result = await postJson(server, "/api/jobs/append", { goal: goal.file, steps, expectedRun: shown.job.run, expectedRevision: shown.job.revision, operationId: randomUUID(), compatAlias: "goal append", ...(caller ? { caller } : {}) });
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printLaunches(result);
  printLaunchWarnings(result);
  const added = Array.isArray(result.added) ? (result.added as number[]) : [];
  const which = added.length > 1 ? `Assignments ${added[0]} to ${added[added.length - 1]}` : `Assignment ${added[0] ?? "?"}`;
  const next = result.next as { index?: number; session?: string } | null | undefined;
  if (result.status === "asked") console.log(`added ${which} to ${slug}; Assignment ${String(result.after)}'s Agent (${String(result.session)}) received another report request`);
  else if (result.status === "started") console.log(`added ${which} to ${slug}; Assignment ${String(next?.index ?? added[0])} started in ${String(next?.session ?? "(no session)")}`);
  else console.log(`added ${which} to ${slug}; it starts after Assignment ${String(result.after)} reports`);
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
    throw new Error(`--continue-from${Number.isFinite(stepIndex) ? ` for Assignment ${stepIndex}` : ""} must be an earlier Assignment number${range} or -, got "${value}".`);
  }
  return n;
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
  const requestedStatuses = stringsArg(args.status);
  if (booleanArg(args.done) && booleanArg(args.all)) throw new Error("tangent goal list accepts either --done or --all, not both.");
  if (requestedStatuses.length && (booleanArg(args.done) || booleanArg(args.all))) throw new Error("tangent goal list accepts --status or --done/--all, not both.");
  const statuses = requestedStatuses.length
    ? requestedStatuses
    : booleanArg(args.all)
      ? []
      : booleanArg(args.done)
        ? ["done"]
        : ["open", "active", "verify"];
  const scope = await listGoalScope(server, area, booleanArg(args.subtree), {
    status: statuses,
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
  const cards = (Array.isArray(detail.cards) ? detail.cards : []) as Array<{ kind?: string; title?: string; summary?: string }>;
  if (cards.length) {
    console.log("Presented:");
    for (const card of cards) console.log(`  ${card.kind} · ${card.title} · ${card.summary ?? ""}`.trimEnd());
  }
}

/**
 * Handles `tangent goal done <slug> [--note "<text>"]`. Julian's word, or
 * the brain after it read a worker's done note. On a Goal Julian flagged
 * `verify: yes` the server turns a brain's done into Check it and keeps the
 * note in the Goal's State; see helpDoneWontDo().
 */
async function doneCommand(args: Args): Promise<void> {
  if (args.help) return helpDoneWontDo("done");
  const server = resolveServerUrl(stringArg(args.server));
  const slug = requiredString(args._[1], "tangent goal done requires <slug>.");
  const goal = await requireGoal(server, slug);
  if (goal.status === "done") {
    console.log(`${slug} is already done.`);
    return;
  }
  const note = stringArg(args.note)?.trim() || "";
  const result = await postJson(server, "/api/goals/edit", { file: goal.file, status: "done", session: await currentTmuxSession(), ...(note ? { note } : {}) });
  if (result.status === "verify") console.log(`${slug} waits for Julian to check it (Check it). He marks it done.`);
  else console.log(`${slug} marked done.`);
}

/** Handles `tangent goal wont-do <slug> --reason <text>`; see helpDoneWontDo(). */
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
  const detail = await vaultFetch(server, `/api/jobs/show?goal=${encodeURIComponent(goal.file)}`);
  const queue = detail.job;
  if (!queue || !Number.isInteger(queue.revision)) throw new Error("This Goal has no authoritative Job Attempt to replace.");
  const assignments = queueAssignments(queue);
  const assignmentId = queue.currentAssignmentId;
  const assignment = assignments.find((item) => item.id === assignmentId)
    ?? assignments.find((item) => ["running", "waiting", "stopped"].includes(String(item.status ?? "")));
  if (!assignment) throw new Error("This Goal has no current assignment to replace.");
  const attempt = Array.isArray(assignment.attempts) ? assignment.attempts.slice().reverse().find((item) => !item.endedAt) ?? assignment.attempts.at(-1) : null;
  const expectedAttemptId = attempt?.id;
  if (!expectedAttemptId) throw new Error("This Goal has no current attempt identity to replace safely.");
  const operationId = stringArg(args["operation-id"])?.trim() || randomUUID();
  const confirmed = booleanArg(args.confirm);
  const result = await postJson(server, "/api/jobs/replace", {
    goal: goal.file,
    expectedRun: queue.run,
    assignmentId: assignment.id,
    expectedRevision: queue.revision,
    expectedAttemptId,
    launch,
    operationId,
    compatAlias: "goal replace-agent",
    caller: stringArg(args.session) || (await currentTmuxSession()) || "",
    ...(confirmed ? { confirmed: true } : {}),
  });
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const replacement = result.session ?? result.operation?.replacementSession ?? "(replacement pending)";
  console.log(`replacement for ${slug}: ${replacement} [${result.status ?? result.operation?.status ?? "requested"}]`);
  if (result.requiresConfirmation) {
    console.log("The source agent is still alive. Inspect the replacement before you finish the swap.");
    console.log(`Then run: tangent goal replace-agent ${slug} --launch ${launchRefForCli(launch)} --operation-id ${operationId} --confirm`);
  }
}

/** Renders one parsed launch reference back to the CLI's positional format. */
function launchRefForCli(launch: NonNullable<PipelineStepInput["launch"]>): string {
  return [launch.harness, launch.model, launch.effort].filter(Boolean).join("/");
}

/** Prints one subcommand's own syntax and flags, or the noun help for an unknown name. */
function subcommandHelp(name: string): void {
  const spec = goalCommandSpec.subcommands?.find((entry) => entry.name === name);
  if (!spec) return help();
  console.log(renderCommandHelp(spec, `tangent goal ${name}${spec.args ? ` ${spec.args}` : ""}`));
}

/** Prints `tangent goal` help with real examples. */
function help(): void {
  console.log(renderCommandHelp(goalCommandSpec));
  console.log(`
Examples:
  tangent goal create --area otto/dnd --title "Connect chosen ramp faces" --done-when "The chosen faces connect at the dragged width."
  tangent goal create --area otto/dnd --title "Connect chosen ramp faces" --start --path ~/Projects/dnd --instruction "Connect the chosen faces at the dragged width. Prove it with the ramp test."
  tangent goal create --area otto/dnd --title "Fix the flicker" --start --path ~/Projects/dnd --launch codex/sol/high --verify
  tangent goal create --area otto/dnd --title "Fix the flicker" --done-when "The strip repaints without flicker." --own
  tangent goal list otto/dnd
  tangent goal show connect-chosen-ramp-faces
  tangent goal own connect-chosen-ramp-faces render-cursor-presence
  tangent goal release connect-chosen-ramp-faces
  tangent goal start connect-chosen-ramp-faces --launch codex/sol/low
  tangent goal start pipelines-demo --step "/design this" --launch claude-otto/fable-5 --step "review the design and update it" --launch codex/sol/high --step "implement" --launch claude-otto/opus-5
  tangent goal start pipelines-demo --step "/design this" --launch claude-otto/fable-5 --step "implement the design" --launch claude-otto/opus-5 --continue-from - --continue-from 1
  tangent goal start pipelines-demo --step "design the change" --launch claude-otto/fable-5 --path= --step "implement it in the plugin" --launch claude-otto/opus-5 --path ~/Projects/plugin
  tangent goal append pipelines-demo --step "review the implementation" --launch codex/sol/high
  tangent goal done pipelines-demo --note "The review passed; the strip repaints without flicker."
  tangent goal replace-agent pipelines-demo --launch codex/sol/high
  tangent goal park pipelines-demo --reason "Revisit after the current release."
  tangent goal reopen pipelines-demo
  tangent send otto/tangent "Design written: ~/.tangent/trees/otto/tangent/design-x.md. Unresolved: none."
`);
}

/** Prints the done/won't-do subcommand's help, restating that status is written on Julian's word only. */
function helpDoneWontDo(subcommand: "done" | "wont-do"): void {
  console.log(`tangent goal ${subcommand} <slug>${subcommand === "wont-do" ? ' --reason "<text>"' : ' [--note "<text>"]'}`);
  console.log("");
  if (subcommand === "done") console.log("Julian's word, or the brain after it read a worker's done note. A Goal Julian flagged verify becomes Check it instead and waits for him; --note goes into the Goal's State.");
  else console.log("Julian's word, or the brain's plan. The reason goes into the Goal's State.");
  console.log("");
  console.log("Examples:");
  if (subcommand === "done") console.log("  tangent goal done connect-chosen-ramp-faces");
  else console.log('  tangent goal wont-do connect-chosen-ramp-faces --reason "The simpler flow already solves this need."');
}
