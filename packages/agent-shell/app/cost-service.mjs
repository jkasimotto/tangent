// What each worker cost, kept fresh behind the request.
//
// Every attempt on the machine is read and priced once and indexed by the two
// names a surface knows a worker by. A figure covers a worker's whole life,
// so there is no window to choose: the same conversation reads the same
// whenever it is asked for, and no figure changes when the day rolls over.
//
// The first reading costs seconds, 8.3 measured over 1,493 attempts, and each
// one after it costs 0.2, because a finished transcript is never read twice.
// Nothing in the shell may wait seconds for a number, so the service always
// answers with the index it holds and starts the next reading behind the
// answer. The index says when it was taken, and the figures move without
// anyone pressing anything.

import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { formatTokens, formatUsd, totalTokens } from "./token-usage.mjs";
import { mergeRates, parsePricingDocument } from "./pricing-catalog.mjs";
import { priceAttempts, recordedAttempts, workKey } from "./job-cost.mjs";

const REFRESH_AFTER_MS = 20_000;

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
  let workers = null;
  let reading = null;

  /**
   * What each worker has cost, keyed the way each surface already names one.
   *
   * The Work table knows a row by its Goal file and a live session is known
   * by its tmux name, so both indexes are built from the same reading rather
   * than from two walks of the same transcripts.
   *
   * The next reading starts when the one in hand is old. The very first call
   * has nothing to answer with, so it waits; every call after that reads
   * memory.
   */
  async function readWorkers({ wait = false } = {}) {
    const fresh = workers && now() - Date.parse(workers.computedAt) < REFRESH_AFTER_MS;
    if (!fresh && !reading) reading = refresh().finally(() => { reading = null; });
    if (wait || !workers) await reading?.catch(() => {});
    return workers ?? { status: "reading", computedAt: null, work: {}, sessions: {} };
  }

  /**
   * Reads and prices every recorded attempt, and replaces the index.
   *
   * A broken harness registry leaves nothing to price against. Every attempt
   * still enters the index, unattributed and carrying the registry as its
   * reason, because a worker that shows a dash and says why is honest and an
   * empty index reads as free work.
   */
  async function refresh() {
    const registryNow = await registry();
    const computedAt = new Date(now()).toISOString();
    const attempts = await recordedAttempts({ pipelinesRoot, brainsRoot, repairsRoot });
    if (registryNow?.error) {
      const reason = `the harness registry could not be read: ${registryNow.error}`;
      const unattributed = attempts.map((attempt) => ({ ...attempt, reason }));
      workers = { status: "ready", computedAt, ...summarizeWorkers({ conversations: [], unattributed }) };
      return;
    }
    /** Finds one registry harness by id. */
    const harnessFor = (id) => (registryNow.harnesses ?? []).find((entry) => entry.id === id) ?? null;
    const table = await pricingTable(pricingFile);
    const priced = await priceAttempts(attempts, { harnessFor, rates: table.rates, cache: conversationCache });
    // A rate the vault Document meant to correct is not in force when the
    // block cannot be read, so every figure says so rather than passing off
    // the seeded rate as the one that was asked for.
    const notes = table.error ? [`the pricing Document could not be read, so any rate it meant to correct is not in this figure: ${table.error}`] : [];
    workers = { status: "ready", computedAt, ...summarizeWorkers(priced, { notes }) };
  }

  return { readWorkers };
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
 * What each worker cost, keyed the two ways the shell names one.
 *
 * `work` is keyed by `workKey`: the Work table already knows a row by its
 * Goal file, and an Area brain or repair crew by its Area. `sessions` is
 * keyed by the tmux session name, which is what a person is looking at once
 * they have entered a worker, and is what a brain's figure reads, because a
 * brain shows what its live session has spent (ADR-0059).
 *
 * A conversation is charged whole to every key it ran under and never split.
 * Two keys are never added together for that reason: a Goal's figure is read
 * off the Goal's own key rather than by summing its workers.
 *
 * `notes` are the reasons that hold for every figure on the machine at once,
 * such as a pricing Document that could not be read. They ride on each figure
 * because there is no surface above the figures to carry them.
 */
export function summarizeWorkers(priced, { notes = [] } = {}) {
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
  return { work: presentGroups(work, notes), sessions: presentGroups(sessions, notes) };
}

/** One index of groups as the plain object a response carries. */
function presentGroups(groups, notes) {
  return Object.fromEntries([...groups].map(([key, group]) => [key, presentWorker(group, notes)]));
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
function presentWorker(group, notes = []) {
  const reasons = [];
  if (group.live) reasons.push("this worker is still running, so this is what it has cost so far");
  for (const [id, tokens] of ranked(group.unpricedTokens)) {
    reasons.push(`no rate for ${id}: ${formatTokens(tokens)} tokens are not in this figure. Add a rate to pricing.md.`);
  }
  for (const [reason, count] of ranked(group.reasons)) reasons.push(count > 1 ? `${reason} (${count})` : reason);
  reasons.push(...notes);
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
