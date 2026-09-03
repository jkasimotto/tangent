// What work cost, for the top bar and for each worker, kept fresh behind the
// request.
//
// One reading serves both. Every attempt on the machine is read and priced
// once; the top bar's window is taken out of that result and each worker's
// own figure is indexed from it. Reading it separately would cost the same
// transcripts twice and let the two answers disagree about what one
// conversation cost.
//
// The first reading costs seconds, 8.3 measured over 1,493 attempts, and each
// one after it costs 0.2, because a finished transcript is never read twice.
// Nothing in the shell may wait seconds for a number, so the service always
// answers with the snapshot it holds and starts the next reading behind the
// answer. The snapshot says when it was taken, and the figures move without
// anyone pressing anything.

import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { formatTokens, formatUsd, totalTokens } from "./token-usage.mjs";
import { mergeRates, parsePricingDocument } from "./pricing-catalog.mjs";
import { totalCost } from "./token-pricing.mjs";
import { attemptsInWindow, priceAttempts, workKey } from "./job-cost.mjs";

const DEFAULT_WINDOW_DAYS = 1;
const REFRESH_AFTER_MS = 20_000;
// An Area path and a Goal name both hold spaces and slashes, so the grouping
// key is joined on a character neither of them can hold.
const WORK_KEY_SEPARATOR = "\u001f";

/**
 * Creates the cost service.
 *
 * `registry` is the harness registry reader the shell already has.
 * `pricingFile` is the vault Document whose `tangent.pricing.v1` block
 * overrides the seeded rates, so a rate can be corrected without a rebuild.
 */
export function createCostService({
  pipelinesRoot,
  brainsRoot,
  repairsRoot = null,
  registry,
  pricingFile = path.join(os.homedir(), ".tangent", "trees", "pricing.md"),
  now = () => Date.now(),
} = {}) {
  const conversationCache = new Map();
  let snapshot = null;
  let workers = null;
  let reading = null;

  /**
   * The current snapshot, with the next reading started when the one in hand
   * is old. The very first call has nothing to answer with, so it waits;
   * every call after that reads memory.
   */
  async function read({ days = DEFAULT_WINDOW_DAYS, wait = false } = {}) {
    const wanted = Number(days) > 0 ? Number(days) : DEFAULT_WINDOW_DAYS;
    await current({ days: wanted, wait });
    return snapshot ?? { status: "reading", days: wanted, amount: null, display: "…", computedAt: null };
  }

  /**
   * What each worker has cost, keyed the way each surface already names one.
   *
   * The Work table knows a row by its Goal file and the session layer knows a
   * worker by its tmux session name, so both indexes are built from the same
   * reading rather than from a second walk of the same transcripts.
   *
   * A worker's figure covers its whole life, so this asks for no window of
   * its own. It rides whichever window the bar last asked for, and so cannot
   * change the bar's answer by reading beside it.
   */
  async function readWorkers({ wait = false } = {}) {
    await current({ days: snapshot?.days ?? DEFAULT_WINDOW_DAYS, wait });
    return workers ?? { status: "reading", computedAt: null, work: {}, sessions: {} };
  }

  /** Starts the next reading when the one in hand is old, and waits when asked. */
  async function current({ days, wait }) {
    const fresh = snapshot?.days === days && now() - Date.parse(snapshot.computedAt) < REFRESH_AFTER_MS;
    if (!fresh && !reading) reading = refresh(days).finally(() => { reading = null; });
    if (wait || !snapshot || !workers) await reading?.catch(() => {});
  }

  /**
   * Reads and prices the window, and replaces the snapshot with the result.
   *
   * A broken harness registry leaves nothing to price against. That publishes
   * a snapshot saying so rather than none at all: with no snapshot the bar
   * would show a patient ellipsis forever and never say why.
   */
  async function refresh(days) {
    const registryNow = await registry();
    const since = new Date(now() - days * 86_400_000).toISOString();
    const computedAt = new Date(now()).toISOString();
    if (registryNow?.error) {
      snapshot = summarizeCost({ amount: 0, complete: false, unpriced: [], parts: [], conversations: [], unattributed: [] },
        { days, since, computedAt, registryError: registryNow.error });
      workers = { status: "ready", computedAt, work: {}, sessions: {} };
      return;
    }
    /** Finds one registry harness by id. */
    const harnessFor = (id) => (registryNow.harnesses ?? []).find((entry) => entry.id === id) ?? null;
    const table = await pricingTable(pricingFile);
    const attempts = await attemptsInWindow({ pipelinesRoot, brainsRoot, repairsRoot });
    const priced = await priceAttempts(attempts, { harnessFor, rates: table.rates, cache: conversationCache });
    snapshot = summarizeCost(inWindow(priced, since), { days, since, computedAt, pricingError: table.error });
    workers = { status: "ready", computedAt, ...summarizeWorkers(priced) };
  }

  return { read, readWorkers };
}

/**
 * The rate table: the seeded rates with the vault Document's in front.
 *
 * The Document is read on every reading rather than cached, so a rate typed
 * into it applies on the next refresh. A malformed block never prices at
 * zero: the seed stands and the error travels to the surface, which is how
 * `parseHarnessRegistry` already behaves.
 */
export async function pricingTable(pricingFile) {
  const text = await readFile(pricingFile, "utf8").catch(() => null);
  const parsed = text === null ? null : parsePricingDocument(text);
  if (parsed?.error) return { rates: mergeRates([]), error: parsed.error };
  return { rates: mergeRates(parsed?.rates ?? []), error: null };
}

/**
 * Reduces a priced window to what a person reads at a glance and on hover.
 *
 * Everything that could not be priced or reached folds into `excluded` with a
 * count, so the breakdown states what the number leaves out in one line per
 * reason rather than listing hundreds of attempts nobody will read.
 */
export function summarizeCost(priced, { days, since, computedAt, pricingError = null, registryError = null }) {
  const byHarness = new Map();
  const byModel = new Map();
  const byWork = new Map();
  const unpricedTokens = new Map();
  const gaps = new Map();
  for (const entry of priced.conversations) {
    for (const gap of entry.cost.gaps ?? []) {
      const known = gaps.get(gap.reason);
      gaps.set(gap.reason, { ...gap, count: (known?.count ?? 0) + 1 });
    }
    addAmount(byHarness, entry.harness, entry.cost.amount);
    for (const part of entry.cost.parts) {
      const id = `${part.provider}/${part.model}`;
      if (part.priced) addAmount(byModel, id, part.amount ?? 0);
      else addAmount(unpricedTokens, id, totalTokens(part.usage));
    }
    const attempt = entry.attempts[0];
    addAmount(byWork, [attempt.scope, attempt.area ?? "", attempt.name ?? ""].join(WORK_KEY_SEPARATOR), entry.cost.amount);
  }
  const excluded = [];
  if (registryError) excluded.push({ reason: "the harness registry could not be read, so nothing was priced", detail: registryError, count: 1 });
  for (const [id, tokens] of ranked(unpricedTokens)) {
    excluded.push({ reason: `no rate for ${id}`, detail: `${formatTokens(tokens)} tokens. Add a rate to pricing.md.`, count: 1 });
  }
  const reasons = new Map();
  for (const entry of priced.unattributed) addAmount(reasons, entry.reason, 1);
  for (const [reason, count] of ranked(reasons)) excluded.push({ reason, detail: null, count });
  for (const gap of [...gaps.values()].sort((left, right) => right.count - left.count)) excluded.push(gap);
  if (pricingError) excluded.push({ reason: "the pricing Document could not be read", detail: pricingError, count: 1 });
  return {
    status: "ready",
    days,
    since,
    computedAt,
    amount: priced.amount,
    display: formatUsd(priced.amount),
    currency: "USD",
    complete: priced.complete && priced.unattributed.length === 0 && !pricingError && !registryError && gaps.size === 0,
    conversations: priced.conversations.length,
    byHarness: ranked(byHarness).map(([harness, amount]) => ({ harness, amount, display: formatUsd(amount) })),
    byModel: ranked(byModel).map(([id, amount]) => ({ id, amount, display: formatUsd(amount) })),
    work: ranked(byWork).slice(0, 6).map(([key, amount]) => {
      const [scope, area, name] = key.split(WORK_KEY_SEPARATOR);
      return { scope, area, name, amount, display: formatUsd(amount) };
    }),
    excluded,
  };
}

/**
 * The slice of one priced reading that started inside a window.
 *
 * Every attempt on the machine is priced once and the window is taken out of
 * the result, rather than the window being read separately, so the Work
 * table's whole-life figures and the top bar's figure for today never
 * disagree about what one conversation cost. A conversation is kept whole
 * when any of its attempts started inside the window, which is the rule the
 * per-day total already used.
 */
export function inWindow(priced, since) {
  const started = Date.parse(since ?? "");
  if (Number.isNaN(started)) return priced;
  /** True when one attempt started at or after the window opened. */
  const inside = (attempt) => Date.parse(attempt.startedAt ?? "") >= started;
  const conversations = priced.conversations.filter((entry) => entry.attempts.some(inside));
  const unattributed = priced.unattributed.filter(inside);
  return { ...totalCost(conversations.flatMap((entry) => entry.cost.parts)), conversations, unattributed };
}

/**
 * What each worker cost, keyed the two ways the shell names one.
 *
 * `work` is keyed by `workKey`: the Work table already knows a row by its
 * Goal file, and an Area brain or repair crew by its Area. `sessions` is
 * keyed by the tmux session name, which is what a person is looking at once
 * they have entered a worker.
 *
 * A conversation is charged whole to every key it ran under and never split.
 * Two keys are never added together for that reason: a Goal's figure is read
 * off the Goal's own key rather than by summing its workers.
 */
export function summarizeWorkers(priced) {
  const work = new Map();
  const sessions = new Map();
  for (const entry of priced.conversations) {
    for (const key of new Set(entry.attempts.map((attempt) => workKey(attempt)))) addConversation(work, key, entry);
    for (const name of sessionNames(entry.attempts)) addConversation(sessions, name, entry);
  }
  for (const attempt of priced.unattributed) {
    addGap(work, workKey(attempt), attempt.reason);
    if (attempt.session) addGap(sessions, attempt.session, attempt.reason);
  }
  return { work: presentGroups(work), sessions: presentGroups(sessions) };
}

/** One index of groups as the plain object a response carries. */
function presentGroups(groups) {
  return Object.fromEntries([...groups].map(([key, group]) => [key, presentWorker(group)]));
}

/** The distinct tmux session names a set of attempts ran under. */
function sessionNames(attempts) {
  return new Set(attempts.map((attempt) => attempt.session).filter(Boolean));
}

/** The running group for one key, created on first use. */
function workerGroup(groups, key) {
  const known = groups.get(key);
  if (known) return known;
  const group = { amount: 0, conversations: new Set(), workers: new Set(), harnesses: new Set(), families: new Set(), unpricedTokens: new Map(), reasons: new Map(), live: false };
  groups.set(key, group);
  return group;
}

/** Adds one priced conversation, and everything it leaves out, into a group. */
function addConversation(groups, key, entry) {
  const group = workerGroup(groups, key);
  group.amount += Number.isFinite(entry.cost.amount) ? entry.cost.amount : 0;
  group.conversations.add(entry.key);
  group.harnesses.add(entry.harness);
  if (entry.cost.family) group.families.add(entry.cost.family);
  for (const name of sessionNames(entry.attempts)) group.workers.add(name);
  if (entry.attempts.some((attempt) => !attempt.endedAt)) group.live = true;
  for (const gap of entry.cost.gaps ?? []) addAmount(group.reasons, gap.reason, 1);
  for (const part of entry.cost.parts) {
    if (part.priced) continue;
    const tokens = totalTokens(part.usage);
    if (tokens > 0) addAmount(group.unpricedTokens, `${part.provider}/${part.model}`, tokens);
  }
}

/** Records one attempt that could not be reached at all, with its reason. */
function addGap(groups, key, reason) {
  addAmount(workerGroup(groups, key).reasons, reason, 1);
}

// Whether a worker's subagents are inside its figure, stated per harness
// family, because a bare promise that subagents are counted is not something
// a reader can check. Each sentence is a measurement.
//
// Claude: over 31 recorded conversations that ran subagents, the ledger the
// figure uses stands above what the parent transcript alone would price in 31
// of 31, by $150 on the largest. Codex: adding the descendant rollouts raised
// the token count in 194 of 194. pi: across 692 recorded pi transcripts the
// only tools are read, write, edit and bash, so pi has no subagent to
// attribute; an agent a pi worker started through bash is a worker of its own
// with a figure of its own.
const SUBAGENT_NOTES = {
  claude: "Subagents are inside this figure: Claude's own ledger already counts them, and the subagent transcripts beside it are read when the ledger cannot be used.",
  codex: "Subagents are inside this figure: every rollout descended from the thread is read with it.",
  pi: "pi has no subagent tool, so there is no subagent spend to add. An agent a pi worker started through bash is its own worker with its own figure.",
};

/**
 * One group as the two surfaces read it.
 *
 * `floor` is the whole of the honesty rule in one boolean: a live worker, a
 * conversation priced from tokens rather than from a ledger, a model with no
 * rate, and an attempt that could not be reached all mean the same thing to a
 * reader, that the real figure is at least this one. `reasons` says which.
 */
function presentWorker(group) {
  const reasons = [];
  if (group.live) reasons.push("this worker is still running, so this is what it has cost so far");
  for (const [id, tokens] of ranked(group.unpricedTokens)) {
    reasons.push(`no rate for ${id}: ${formatTokens(tokens)} tokens are not in this figure. Add a rate to pricing.md.`);
  }
  for (const [reason, count] of ranked(group.reasons)) reasons.push(count > 1 ? `${reason} (${count})` : reason);
  const unpricedTokens = [...group.unpricedTokens.values()].reduce((total, tokens) => total + tokens, 0);
  return {
    amount: group.amount,
    display: formatUsd(group.amount),
    floor: reasons.length > 0,
    conversations: group.conversations.size,
    workers: group.workers.size,
    harnesses: [...group.harnesses].sort(),
    unpricedTokens,
    unpricedDisplay: unpricedTokens > 0 ? `${formatTokens(unpricedTokens)} tok` : null,
    subagents: [...group.families].sort().map((family) => SUBAGENT_NOTES[family]).filter(Boolean).join(" "),
    reasons,
  };
}

/** Adds one amount into a running group. */
function addAmount(groups, key, amount) {
  groups.set(key, (groups.get(key) ?? 0) + (Number.isFinite(amount) ? amount : 0));
}

/** One group's entries, largest first, with the empty ones dropped. */
function ranked(groups) {
  return [...groups.entries()].filter(([, amount]) => amount > 0).sort((left, right) => right[1] - left[1]);
}
