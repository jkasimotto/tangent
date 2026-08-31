import { randomUUID } from "node:crypto";
import { renderCommandHelp } from "@tangent/core";
import { booleanArg, parseArgs, requiredString, stringArg, stringsArg, type Args } from "@tangent/core/cli";
import { currentTmuxSession, postJson, requireGoal, resolveServerUrl, vaultFetch } from "../client.js";
import { jobCommandSpec } from "../spec.js";

/** Dispatches canonical `tangent job` commands. */
export async function runJobCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv, { repeatable: ["step", "launch", "path", "kind", "continue-from"], boolean: ["confirm"] });
  const command = String(args._[0] ?? "");
  if (!command || args.help) return help(command);
  if (command === "show") return show(args);
  if (["create", "start", "append", "advance", "stop", "replace"].includes(command)) return mutate(command, args);
  throw new Error(`Unknown job command: ${command}. Try "tangent job --help".`);
}

/** Shows one selected Job run and its durable history. */
async function show(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const goal = await requireGoal(server, requiredString(args._[1], "tangent job show requires <goal>."));
  const run = stringArg(args.run);
  const result = await vaultFetch(server, `/api/jobs/show?goal=${encodeURIComponent(goal.file)}${run ? `&run=${encodeURIComponent(run)}` : ""}`);
  if (booleanArg(args.json)) return printJson(result);
  const job = result.job as any;
  console.log(`${goal.slug}  Job ${job.run}  [${job.status}]  revision ${job.revision}`);
  for (const assignment of job.assignments ?? []) {
    console.log(`${assignment.index}. ${assignment.instruction}  [${assignment.status}]`);
    for (const attempt of assignment.attempts ?? []) console.log(`   Attempt ${attempt.id}: ${attempt.session ?? "(no Agent)"}${attempt.endedAt ? " (ended)" : ""}`);
    for (const report of assignment.reports ?? []) console.log(`   Report: ${report.summary ?? report.type ?? "recorded"}`);
  }
}

/** Sends one revision-fenced Job mutation. */
async function mutate(command: string, args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const goal = await requireGoal(server, requiredString(args._[1], `tangent job ${command} requires <goal>.`));
  const caller = stringArg(args.session) || (await currentTmuxSession()) || "";
  let current: any = null;
  if (command !== "create") current = (await vaultFetch(server, `/api/jobs/show?goal=${encodeURIComponent(goal.file)}`)).job;
  const operationId = stringArg(args["operation-id"]) || randomUUID();
  const common = { goal: goal.file, caller, operationId, ...(current ? { expectedRun: current.run, expectedRevision: current.revision } : {}) };
  let body: Record<string, unknown> = common;
  if (["create", "append"].includes(command)) body = { ...common, steps: assignments(args) };
  if (command === "advance") {
    const assignment = Number(args._[2]);
    if (!Number.isInteger(assignment) || assignment < 1) throw new Error("tangent job advance requires a positive Assignment number.");
    body = { ...common, assignment };
  }
  if (command === "replace") body = {
    ...common,
    assignmentId: requiredString(args.assignment, "tangent job replace requires --assignment <id>."),
    expectedAttemptId: stringArg(args["expected-attempt"]) || "",
    launch: parseLaunch(requiredString(args.launch, "tangent job replace requires --launch <harness[/model[/effort]]>.")),
    confirmed: booleanArg(args.confirm),
  };
  const result = await postJson(server, `/api/jobs/${command}`, body);
  if (booleanArg(args.json)) return printJson(result);
  const job = result.job as any;
  if (command === "create") console.log(`created ${goal.slug} Job ${job?.run ?? 1}`);
  else if (command === "start" || command === "advance") console.log(`started ${goal.slug} Assignment ${result.assignment?.index ?? ""} in ${result.next?.session ?? result.session ?? "(no Agent)"}`);
  else console.log(`${command === "append" ? "appended to" : command === "stop" ? "stopped" : "replaced Attempt in"} ${goal.slug} Job ${job?.run ?? current?.run ?? ""}`);
}

/** Converts repeated CLI options into Assignment inputs. */
function assignments(args: Args): Array<Record<string, unknown>> {
  const instructions = stringsArg(args.step);
  if (!instructions.length) return [];
  const launches = stringsArg(args.launch), paths = stringsArg(args.path), kinds = stringsArg(args.kind), continuations = stringsArg(args["continue-from"]);
  return instructions.map((instruction, index) => ({
    instruction,
    ...(launches[index] ? { launch: parseLaunch(launches[index]) } : {}),
    ...(paths[index] ? { path: paths[index] } : {}),
    ...(kinds[index] ? { kind: kinds[index] } : {}),
    ...(continuations[index] && continuations[index] !== "-" ? { continueFrom: Number(continuations[index]) } : {}),
  }));
}

/** Parses one compact harness, model, and effort launch reference. */
function parseLaunch(value: string): { harness: string; model?: string; effort?: string } {
  const [harness, model, effort, extra] = value.split("/");
  if (!harness || extra) throw new Error("launch must be <harness[/model[/effort]]>.");
  return { harness, ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}

/** Prints one JSON response. */
function printJson(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }
/** Prints root or subcommand help. */
function help(command = ""): void {
  const spec = command ? jobCommandSpec.subcommands?.find((item) => item.name === command) : null;
  console.log(renderCommandHelp(spec ?? jobCommandSpec));
}
