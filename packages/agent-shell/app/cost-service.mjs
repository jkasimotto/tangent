// The estimated cost the top bar shows, kept fresh behind the request.
//
// Reading it costs seconds the first time: every conversation of every Job,
// brain and repair in the window has to be read off disk. Nothing in the
// shell may wait seconds for a number in a corner of the bar, so the service
// always answers with the snapshot it holds and starts the next reading
// behind the answer. The snapshot says when it was taken, and the bar shows
// the number without anyone pressing anything.

import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { formatTokens, formatUsd, totalTokens } from "./token-usage.mjs";
import { mergeRates, parsePricingDocument } from "./pricing-catalog.mjs";
import { attemptsInWindow, priceAttempts } from "./job-cost.mjs";

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
  registry,
  pricingFile = path.join(os.homedir(), ".tangent", "trees", "pricing.md"),
  now = () => Date.now(),
} = {}) {
  const conversationCache = new Map();
  let snapshot = null;
  let reading = null;

  /**
   * The current snapshot, with the next reading started when the one in hand
   * is old. The very first call has nothing to answer with, so it waits;
   * every call after that reads memory.
   */
  async function read({ days = DEFAULT_WINDOW_DAYS, wait = false } = {}) {
    const wanted = Number(days) > 0 ? Number(days) : DEFAULT_WINDOW_DAYS;
    const fresh = snapshot?.days === wanted && now() - Date.parse(snapshot.computedAt) < REFRESH_AFTER_MS;
    if (!fresh && !reading) reading = refresh(wanted).finally(() => { reading = null; });
    if (wait || !snapshot) await reading?.catch(() => {});
    return snapshot ?? { status: "reading", days: wanted, amount: null, display: "…", computedAt: null };
  }

  /** Reads and prices the window, and replaces the snapshot with the result. */
  async function refresh(days) {
    const current = await registry();
    if (current?.error) return;
    /** Finds one registry harness by id. */
    const harnessFor = (id) => (current.harnesses ?? []).find((entry) => entry.id === id) ?? null;
    const table = await pricingTable(pricingFile);
    const since = new Date(now() - days * 86_400_000).toISOString();
    const attempts = await attemptsInWindow({ pipelinesRoot, brainsRoot, since });
    const priced = await priceAttempts(attempts, { harnessFor, rates: table.rates, cache: conversationCache });
    snapshot = summarizeCost(priced, { days, since, computedAt: new Date(now()).toISOString(), pricingError: table.error });
  }

  return { read };
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
export function summarizeCost(priced, { days, since, computedAt, pricingError = null }) {
  const byHarness = new Map();
  const byModel = new Map();
  const byWork = new Map();
  const unpricedTokens = new Map();
  for (const entry of priced.conversations) {
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
  for (const [id, tokens] of ranked(unpricedTokens)) {
    excluded.push({ reason: `no rate for ${id}`, detail: `${formatTokens(tokens)} tokens. Add a rate to pricing.md.`, count: 1 });
  }
  const reasons = new Map();
  for (const entry of priced.unattributed) addAmount(reasons, entry.reason, 1);
  for (const [reason, count] of ranked(reasons)) excluded.push({ reason, detail: null, count });
  if (pricingError) excluded.push({ reason: "the pricing Document could not be read", detail: pricingError, count: 1 });
  return {
    status: "ready",
    days,
    since,
    computedAt,
    amount: priced.amount,
    display: formatUsd(priced.amount),
    currency: "USD",
    complete: priced.complete && priced.unattributed.length === 0 && !pricingError,
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

/** Adds one amount into a running group. */
function addAmount(groups, key, amount) {
  groups.set(key, (groups.get(key) ?? 0) + (Number.isFinite(amount) ? amount : 0));
}

/** One group's entries, largest first, with the empty ones dropped. */
function ranked(groups) {
  return [...groups.entries()].filter(([, amount]) => amount > 0).sort((left, right) => right[1] - left[1]);
}
