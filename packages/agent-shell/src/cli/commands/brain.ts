import { renderCommandHelp } from "@tangent/core";
import { booleanArg, parseArgs, stringArg, type Args } from "@tangent/core/cli";

import { currentTmuxSession, postJson, resolveServerUrl, vaultFetch } from "../client.js";
import { brainCommandSpec } from "../spec.js";

/** Dispatches `tangent brain` subcommands. */
export async function runBrainCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const subcommand = args._[0];
  if (!subcommand || args.help) return help();
  if (subcommand === "handover") return handoverCommand(args);
  if (subcommand === "status") return statusCommand(args);
  throw new Error(`Unknown brain command: ${subcommand}. Try "tangent brain handover <facts>" or "tangent brain status [area]".`);
}

/**
 * Handles `tangent brain handover <facts...>`. Run by the brain when its context fills: the server
 * records the facts, starts the next generation from the plan and these facts, and ends this session.
 */
async function handoverCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const session = await requireSession(args, "tangent brain handover");
  const text = args._.slice(1).map(String).join(" ").trim();
  if (!text) throw new Error("tangent brain handover needs the facts as text.");
  const result = await postJson(server, "/api/brains/handover", { session, text });
  console.log(`handed over; generation ${result.generation} started (${result.session}); this session ends now`);
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
  console.log(`plan: ${brain.planFile}`);
  console.log(`instruction: ${firstLine(brain.instruction)}`);
  if (brain.latestHandover) console.log(`latest handover: ${firstLine(brain.latestHandover)}`);
  printForJulian(brain.forJulian ?? []);
}

/**
 * Prints what Tangent shows Julian for this brain: the rows it parsed from the
 * plan's `## For Julian` section, numbered as they appear on his desk. A line
 * the brain wrote in another shape is not a row, so a count that is short of
 * what the plan says is the brain's signal to fix its lines.
 */
function printForJulian(rows: ForJulianRow[]): void {
  console.log(`for Julian: Tangent shows ${rows.length} ${rows.length === 1 ? "item" : "items"}`);
  rows.forEach((row, at) => {
    const number = `  ${at + 1}.`;
    if (row.kind === "decision") {
      const unblocks = row.unblocks ? ` · unblocks ${row.unblocks}` : "";
      const missing = row.missing ? " · DOCUMENT MISSING" : "";
      console.log(`${number} Decision ${row.file ?? row.title}: ${row.text}${unblocks} · ${row.commentCount} open comments${missing}`);
      return;
    }
    if (row.kind === "tryit") {
      console.log(`${number} Try it ${row.title}: ${row.text}`);
      return;
    }
    console.log(`${number} Brain: ${row.text}`);
  });
}

type ForJulianRow = {
  kind: "decision" | "tryit" | "brain";
  text: string;
  unblocks: string | null;
  file: string | null;
  title: string | null;
  commentCount: number;
  missing: boolean;
  line: string;
};

type BrainSummary = {
  area: string;
  status: string;
  live: boolean;
  generation: number;
  session: string | null;
  planFile: string;
  instruction: string;
  latestHandover: string | null;
  forJulian: ForJulianRow[];
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
A brain is started from the brain icon on an Area card in Agent Shell. It hands
over to a fresh copy of itself when its context fills; the plan Document in the
Area folder and the handover facts are the memory that crosses generations.

Examples:
  tangent brain handover "Wave 1 dispatched: area-map runs step 2 (tangent-area-map-s2). Waiting: nothing. Next: review area-map when it completes."
  tangent brain status otto/tangent

The status ends with what Tangent shows Julian: the rows it parsed from the
plan's "## For Julian" section. A line in another shape is not a row.
`);
}
