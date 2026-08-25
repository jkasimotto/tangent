import { renderCommandHelp } from "@tangent/core";
import { booleanArg, parseArgs, stringArg, stringsArg, type Args } from "@tangent/core/cli";

import { currentTmuxSession, postJson, requireGoal, resolveServerUrl, vaultFetch } from "../client.js";
import { brainCommandSpec } from "../spec.js";

/** Dispatches `tangent brain` subcommands. */
export async function runBrainCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv, { repeatable: ["option"] });
  const subcommand = args._[0];
  if (!subcommand || args.help) return help();
  if (subcommand === "handover") return handoverCommand(args);
  if (subcommand === "advance") return advanceCommand(args);
  if (subcommand === "request") return requestCommand(args);
  if (subcommand === "withdraw") return withdrawCommand(args);
  if (subcommand === "status") return statusCommand(args);
  throw new Error(`Unknown brain command: ${subcommand}. Try "tangent brain handover <facts>" or "tangent brain status [area]".`);
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
  const result = await postJson(server, "/api/brains/requests", { session, kind, subject, question, proposal, detail, options: stringsArg(args.option), goal });
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
  const result = await postJson(server, "/api/pipelines/control", { goal: goal.file, action: "advance", step });
  console.log(`started ${slug} step ${step} in ${String(result.next?.session ?? "(no session)")}`);
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
  printForJulian(brain.forJulian ?? [], brain.forJulianUnparsed ?? []);
}

/**
 * Prints what Tangent shows Julian for this brain, and what it does not: the
 * rows it parsed from the plan's `## For Julian` section, each marked when
 * Tangent hides it, then every line the section holds that became no row.
 * The brain reads this to see its own misses; hiding a line is never silent.
 */
function printForJulian(rows: ForJulianRow[], unparsed: string[]): void {
  console.log(`Tangent shows ${rows.length} ${rows.length === 1 ? "item" : "items"} for Julian`);
  rows.forEach((row, at) => {
    const number = `  ${at + 1}.`;
    if (row.kind === "test") {
      const stale = row.goalStatus !== "done" ? ` · goal is ${row.goalStatus ?? "unknown"} (not shown)` : "";
      const missing = row.missing ? " · TARGET MISSING (not shown)" : "";
      console.log(`${number} Test ${row.title}: ${row.text} · Accept it?${stale}${missing}`);
      return;
    }
    if (!row.target) {
      console.log(`${number} Decide: ${row.text}`);
      return;
    }
    const unblocks = row.unblocks ? ` · unblocks ${row.unblocks}` : "";
    const missing = row.missing ? " · TARGET MISSING (not shown)" : "";
    console.log(`${number} Decide ${row.file ?? row.title}: ${row.text}${unblocks} · ${row.commentCount} open comments${missing}`);
  });
  if (!unparsed.length) return;
  console.log("Not shown, in other shapes:");
  for (const line of unparsed) console.log(`  ${line.trim()}`);
}

type ForJulianRow = {
  kind: "decide" | "test";
  target: string | null;
  text: string;
  unblocks: string | null;
  file: string | null;
  title: string | null;
  commentCount: number;
  missing: boolean;
  goalStatus: string | null;
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
  forJulianUnparsed: string[];
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

Create plan, decision, test, and approval requests with \`tangent brain request\`.
Their answers return to this brain as durable notices. Existing For Julian
plan rows remain visible only for legacy runs during migration.
`);
}
