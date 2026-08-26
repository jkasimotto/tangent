import { randomUUID } from "node:crypto";
import { renderCommandHelp } from "@tangent/core";
import { booleanArg, parseArgs, stringArg, stringsArg, type Args } from "@tangent/core/cli";

import { currentTmuxSession, goalQueueRevision, postJson, postJsonResult, requireGoal, resolveServerUrl, vaultFetch } from "../client.js";
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

/**
 * Handles `tangent brain handover <facts...>`. Run by the brain when its context fills: the server
 * records the facts, starts the next generation from the plan and these facts, and ends this session.
 */
async function handoverCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const session = await requireSession(args, "tangent brain handover");
  const text = args._.slice(1).map(String).join(" ").trim();
  if (!text) throw new Error("tangent brain handover needs the facts as text.");
  const { status, body } = await postJsonResult(server, "/api/brains/handover", { session, text });
  // A paced refusal is Tangent's answer, not a failure: print it and stop.
  if (status === 429) {
    console.log(String(body.error ?? "Tangent paced this handover. Wait."));
    return;
  }
  if (status < 200 || status >= 300) throw new Error(String(body.error || `Agent Shell returned ${status}.`));
  console.log(`handed over; generation ${body.generation} started (${body.session}); this session ends now`);
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
  console.log(`plan: ${brain.planFile}`);
  console.log(`founding instruction: ${firstLine(brain.foundingInstruction?.text ?? "")}`);
  if (brain.checkpoint?.text) console.log(`current checkpoint: ${firstLine(brain.checkpoint.text)}`);
  console.log(`questions: ${(brain.requests ?? []).length} open`);
}

type BrainSummary = {
  area: string;
  status: string;
  live: boolean;
  generation: number;
  session: string | null;
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
