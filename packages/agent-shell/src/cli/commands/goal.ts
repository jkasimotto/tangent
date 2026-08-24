import { renderCommandHelp } from "@tangent/core";
import { booleanArg, parseArgs, requiredString, stringArg, stringsArg, type Args } from "@tangent/core/cli";

import { currentTmuxSession, listGoals, postJson, requireArea, requireGoal, resolveServerUrl } from "../client.js";
import { goalCommandSpec } from "../spec.js";

/** Dispatches `tangent goal` subcommands. */
export async function runGoalCli(argv = process.argv.slice(2)): Promise<void> {
  // "continue" is boolean so the reminder's printed command works verbatim:
  // `handover --continue "<facts>"` must keep the facts positional, never
  // swallow them as the flag's value (ADR-0028).
  const args = parseArgs(argv, { repeatable: ["source", "subgoal-title", "subgoal-done-when", "step", "launch", "continue-from", "on"], boolean: ["continue"] });
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
  const result = await postJson(server, `/api/goals/${removing ? "undepend" : "depend"}`, { slug, on });
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
  const own = booleanArg(args.own) ? await requireSession(args, "tangent goal create --own") : "";
  const caller = await currentTmuxSession();
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
 * Handles `tangent goal start <slug> [--step <instruction> --launch <harness[/model[/effort]]> --continue-from <n|->]...`.
 * Without --step it starts one agent on the Goal, the same as the desk's Start agent. With steps it
 * posts a pipeline to the same endpoint; the server records it and starts step 1.
 */
async function startCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const slug = requiredString(args._[1], "tangent goal start requires <slug>.");
  const goal = await requireGoal(server, slug);
  const caller = await currentTmuxSession();
  const steps = pipelineSteps(args);
  const result = steps.length
    ? await postJson(server, "/api/goals/start", { file: goal.file, steps, ...(caller ? { caller } : {}) })
    : await postJson(server, "/api/goals/start", { file: goal.file, approved: true, launch: true, ...(caller ? { caller } : {}) });
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printLaunchWarnings(result);
  const session = result.session ? String(result.session) : "(no session)";
  if (steps.length) console.log(`started ${slug}: ${steps.length} step${steps.length === 1 ? "" : "s"}, step 1 in ${session}`);
  else console.log(`started ${slug} in ${session}`);
}

/** Prints one line per step whose --launch harness differs from the Area's default; the server computes them. */
function printLaunchWarnings(result: { warnings?: unknown }): void {
  const warnings = Array.isArray(result.warnings) ? (result.warnings as string[]) : [];
  for (const warning of warnings) console.error(`warning: ${warning}`);
}

/**
 * Handles `tangent goal append <slug> --step <instruction> [--launch ...] [--continue-from ...]...`.
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
  const result = await postJson(server, "/api/pipelines/append", { goal: goal.file, steps });
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
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
  continueFrom: number | null;
};

/**
 * Pairs each --step with the --launch and --continue-from at the same position. When appending,
 * a step may continue any step of the existing pipeline, so only the server (which knows the final
 * numbering) checks the upper bound.
 */
function pipelineSteps(args: Args, { appending = false } = {}): PipelineStepInput[] {
  const instructions = stringsArg(args.step).map((step) => step.trim());
  const launches = stringsArg(args.launch);
  const continues = stringsArg(args["continue-from"]);
  if (instructions.some((instruction) => !instruction)) throw new Error("Each --step needs an instruction.");
  if (launches.length > instructions.length) throw new Error("More --launch values than --step values; each --launch pairs with the --step at the same position.");
  if (continues.length > instructions.length) throw new Error("More --continue-from values than --step values; each pairs with the --step at the same position.");
  return instructions.map((instruction, index) => {
    const step: PipelineStepInput = { instruction, continueFrom: parseContinueFrom(continues[index], appending ? Number.POSITIVE_INFINITY : index + 1) };
    const launch = parseLaunch(launches[index]);
    if (launch) step.launch = launch;
    return step;
  });
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
 * Handles `tangent goal handover [--continue] <facts...>`. Run by a worker at the end of its step or Goal.
 * Plain: the server records the facts. A controlling brain chooses the next
 * transition; legacy work without a brain still advances automatically.
 * `--continue`: this step or Goal is not done; the server hands it to a fresh copy of the same session
 * instead of advancing (design-worker-context-handover D4).
 */
async function handoverCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const session = await requireSession(args, "tangent goal handover");
  const text = args._.slice(1).map(String).join(" ").trim();
  if (!text) throw new Error("tangent goal handover needs the facts as text.");
  const body: Record<string, unknown> = { session, text };
  if (booleanArg(args.continue)) body.continue = true;
  const result = await postJson(server, "/api/goals/handover", body);
  if (result.status === "continued") { console.log(`handed over; a fresh copy continues this step: ${result.session}`); return; }
  const next = result.next as { index?: number; session?: string } | null | undefined;
  if (result.status === "reported") console.log("handed over to the brain; the brain chooses what happens next");
  else if (result.status === "started" && next) console.log(`handed over; next: step ${next.index} (${next.session})`);
  else console.log("pipeline complete");
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
  const goals = await listGoals(server, area);
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(goals, null, 2));
    return;
  }
  if (!goals.length) {
    console.log("No Goals.");
    return;
  }
  for (const goal of goals) console.log(`${goal.slug}  [${goal.status}]  ${goal.area}  ${goal.title}`);
}

/** Handles `tangent goal show <slug>`. */
async function showCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const slug = requiredString(args._[1], "tangent goal show requires <slug>.");
  const goal = await requireGoal(server, slug);
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(goal, null, 2));
    return;
  }
  console.log(`${goal.title}  [${goal.status}]`);
  console.log(`area: ${goal.area}`);
  console.log(`file: ${goal.file}`);
  if (goal.doneWhen) console.log(`done when: ${goal.doneWhen}`);
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
  tangent goal start connect-chosen-ramp-faces
  tangent goal start pipelines-demo --step "/design this" --launch claude/fable-5 --step "review the design and update it" --launch codex/sol/high --step "implement" --launch claude/opus-5
  tangent goal start pipelines-demo --step "/design this" --step "implement the design" --continue-from - --continue-from 1
  tangent goal append pipelines-demo --step "prove the implementation" --launch codex/sol/high
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
