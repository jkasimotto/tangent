// `tangent process`: Julian's repeatable work as notes (ADR-0043, D16 to
// D19). A process is `<area>/process-<slug>.md`. This command reads what the
// server's scheduler sees, pauses or resumes a note through the server so
// the change is committed with provenance, and asks why a process is or is
// not due. Servers and watchers are `tangent service`.

import { renderCommandHelp } from "@tangent/core";
import { booleanArg, parseArgs, stringArg, type Args } from "@tangent/core/cli";

import { currentTmuxSession, postJson, resolveServerUrl, vaultFetch } from "../client.js";
import { processCommandSpec } from "../spec.js";

/** One process as `/api/processes` returns it. */
type ProcessView = {
  area: string; slug: string; file: string; title: string; status: string; when: string;
  nextRunAt: string | null; lastRunAt: string | null; lastNoticeAt: string | null; lastGoalFile: string | null;
  lastReason: string | null; state: string; error: string | null; launch: string | null; path: string | null; verify: boolean;
  loop?: boolean; body?: string; every?: string | null;
};

/** Dispatches `tangent process` subcommands. */
export async function runProcessCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const subcommand = args._[0];
  if (!subcommand || args.help) return help();
  if (subcommand === "create") return createCommand(args);
  if (subcommand === "list") return listCommand(args);
  if (subcommand === "show") return showCommand(args);
  if (subcommand === "start") return startCommand(args);
  if (subcommand === "pause") return controlCommand(args, "pause");
  if (subcommand === "resume") return controlCommand(args, "resume");
  if (subcommand === "check") return checkCommand(args);
  if (subcommand === "remove") return removeCommand(args);
  throw new Error(`Unknown process command: ${subcommand}. Run "tangent process --help" for available commands.`);
}

/** Accepts one fenced due event as the exact Area brain. */
async function startCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const slug = requireSlug(args, "start");
  const caller = await currentTmuxSession();
  const result = await postJson(server, "/api/processes/start", {
    slug, area: stringArg(args.area) ?? "", caller,
    eventId: stringArg(args.event), attemptId: stringArg(args.attempt), definitionRevision: stringArg(args.definition),
    operationId: stringArg(args["operation-id"]),
  });
  if (booleanArg(args.json)) return void console.log(JSON.stringify(result, null, 2));
  console.log(`${result.goalFile}: Process started${result.session ? ` in ${result.session}` : ""}`);
}

/** Creates one loop note through the server-owned vault boundary. */
async function createCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const area = requiredOption(args, "area");
  const slug = requiredOption(args, "slug");
  const every = requiredOption(args, "every");
  const message = requiredOption(args, "message");
  const caller = await currentTmuxSession();
  const result = await postJson(server, "/api/processes/create", { area, slug, every, message, ...(caller ? { caller } : {}) });
  if (booleanArg(args.json)) return void console.log(JSON.stringify(result, null, 2));
  console.log(`${result.file}: loop created`);
}

/** Removes one loop note through the server-owned vault boundary. */
async function removeCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const slug = requireSlug(args, "remove");
  const caller = await currentTmuxSession();
  const result = await postJson(server, "/api/processes/remove", { slug, area: stringArg(args.area) ?? "", ...(caller ? { caller } : {}) });
  if (booleanArg(args.json)) return void console.log(JSON.stringify(result, null, 2));
  console.log(`${result.file}: loop removed`);
}

/** Returns one required named value. */
function requiredOption(args: Args, name: string): string {
  const value = String(stringArg(args[name]) ?? "").trim();
  if (!value) throw new Error(`tangent process create requires --${name} <value>.`);
  return value;
}

/** Handles `tangent process list [area]`. */
async function listCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const area = String(args._[1] ?? stringArg(args.area) ?? "").trim();
  const result = await vaultFetch(server, `/api/processes${area ? `?area=${encodeURIComponent(area)}` : ""}`);
  const processes = result.processes as ProcessView[];
  if (booleanArg(args.json)) return void console.log(JSON.stringify(processes, null, 2));
  if (!processes.length) console.log(area ? `No processes in ${area}.` : "No processes. A process is <area>/process-<slug>.md with schedule: or when: and every: in its frontmatter.");
  for (const item of processes) console.log(processLine(item));
  console.log("Servers and watchers: tangent service list");
}

/** Handles `tangent process show <slug>`. */
async function showCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const item = await findProcess(server, args);
  if (booleanArg(args.json)) return void console.log(JSON.stringify(item, null, 2));
  console.log(`${item.area}/${item.slug}  ${item.title}`);
  console.log(`  file: ${item.file}`);
  console.log(`  when: ${item.when}`);
  console.log(`  status: ${item.status}`);
  console.log(`  state: ${item.error ? `broken note: ${item.error}` : item.state}`);
  console.log(`  next run: ${item.nextRunAt ?? "none"}`);
  console.log(`  last run: ${item.lastRunAt ?? "never"}`);
  if (item.lastNoticeAt) console.log(`  brain told: ${item.lastNoticeAt}`);
  if (item.lastGoalFile) console.log(`  last Goal: ${item.lastGoalFile}`);
  if (item.loop) console.log(`  message: ${item.body}`);
  if (item.launch) console.log(`  launch: ${item.launch}`);
  if (item.path) console.log(`  path: ${item.path}`);
  if (item.verify) console.log("  verify: yes");
  if (item.lastReason) console.log(`  last check: ${item.lastReason}`);
}

/** Handles `tangent process pause|resume <slug>`: the server rewrites `status:` and commits the note. */
async function controlCommand(args: Args, action: "pause" | "resume"): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const slug = requireSlug(args, action);
  const caller = await currentTmuxSession();
  const result = await postJson(server, "/api/processes/control", { slug, area: stringArg(args.area) ?? "", action, ...(caller ? { caller } : {}) });
  if (booleanArg(args.json)) return void console.log(JSON.stringify(result, null, 2));
  console.log(`${result.file}: status ${result.status}`);
}

/** Handles `tangent process check <slug>`: evaluates due-ness now and prints why. */
async function checkCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const slug = requireSlug(args, "check");
  const result = await postJson(server, "/api/processes/check", { slug, area: stringArg(args.area) ?? "" });
  if (booleanArg(args.json)) return void console.log(JSON.stringify(result, null, 2));
  const item = result.process as ProcessView;
  console.log(`${item.area}/${item.slug}: ${result.due ? "due" : "not due"} (${result.reason})`);
  console.log(`  when: ${item.when}`);
  console.log(`  next run: ${item.nextRunAt ?? "none"}`);
}

/** The slug argument, or a usage error. */
function requireSlug(args: Args, action: string): string {
  const slug = String(args._[1] ?? "").trim();
  if (!slug) throw new Error(`tangent process ${action} requires <slug> or <area>/<slug>.`);
  return slug;
}

/** Finds one process by slug, `<area>/<slug>`, or file, across the vault or one `--area`. */
async function findProcess(server: URL, args: Args): Promise<ProcessView> {
  const slug = requireSlug(args, "show");
  const area = stringArg(args.area) ?? "";
  const result = await vaultFetch(server, `/api/processes${area ? `?area=${encodeURIComponent(area)}` : ""}`);
  const matches = (result.processes as ProcessView[]).filter((item) => item.slug === slug || `${item.area}/${item.slug}` === slug || item.file === slug);
  if (matches.length === 1) return matches[0]!;
  if (!matches.length) throw new Error(`no process named ${JSON.stringify(slug)}${area ? ` in ${area}` : ""}.`);
  throw new Error(`${slug} names ${matches.length} processes; use <area>/<slug>: ${matches.map((item) => `${item.area}/${item.slug}`).join(", ")}`);
}

/** One list row: area/slug, when, next run, state. */
export function processLine(item: ProcessView): string {
  const next = item.status === "paused" ? "paused" : item.nextRunAt ? `next ${item.nextRunAt}` : "no next run";
  return `${item.area}/${item.slug}\t${item.when}\t${next}\t${item.error ? `broken note: ${item.error}` : item.state}`;
}

/** Prints `tangent process` help with real examples. */
function help(): void {
  console.log(renderCommandHelp(processCommandSpec));
  console.log(`
A process is a note: <area>/process-<slug>.md with type: process and either
schedule: (calendar words such as "daily 09:00", "weekdays 08:30 UTC") or
when: (a shell probe; exit 0 means due) with every: (30m, 2h). Optional
launch: (harness[/model[/effort]], such as claude/opus-5), path:, verify:.
The body is the instruction the brain gives the worker. When it is due, the server writes one note to the Area brain.

A loop is the same note with every: alone (1m or slower). Its body is the
message. The server sends the message while the Area brain runs.

Servers and watchers are "tangent service".

Examples:
  tangent process create --area neara/pgande --slug review-work --every 20m --message "Review open work."
  tangent process list
  tangent process list neara/pgande
  tangent process show rebase-pgande-staging
  tangent process start rebase-pgande-staging
  tangent process pause rebase-pgande-staging
  tangent process resume neara/pgande/rebase-pgande-staging
  tangent process check speedrun-pgande
  tangent process remove neara/pgande/review-work
`);
}
