// The estimated cost the shell shows, kept fresh in the background.
//
// Reading it costs seconds the first time: every conversation of every Job,
// brain, and repair in the window has to be read off disk. Nothing in the
// shell may wait seconds for a number in the top bar, so the service always
// answers with the snapshot it has and starts the next reading behind it. The
// snapshot says when it was taken, and the bar shows the number without
// anyone pressing anything.

import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { formatUsd, mergeRates } from "@tangent/pricing";

import { attemptsInWindow, priceAttempts } from "./job-cost.mjs";

const DEFAULT_WINDOW_DAYS = 1;
const REFRESH_AFTER_MS = 20_000;
// Areas and Goal names both contain spaces and slashes, so the grouping key
// is joined on a character neither of them can hold.
const WORK_KEY_SEPARATOR = "\u001f";

/**
 * Creates the cost service.
 *
 * `registry` is the machine harness registry reader the shell already has.
 * `overridesFile` is where an account holder may put rates this repository
 * cannot verify, which is the only way Codex spend becomes a dollar figure.
 */
export function createCostService({ pipelinesRoot, brainsRoot, registry, overridesFile = path.join(os.homedir(), ".tangent", "pricing.json"), now = () => Date.now() }) {
  const conversationCache = new Map();
  let snapshot = null;
  let reading = null;

  /**
   * The current snapshot, with the next reading started if the one in hand is
   * old. The first call has nothing to answer with and says so rather than
   * blocking the request that asked.
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
    const since = new Date(now() - days * 86_400_000).toISOString();
    const attempts = await attemptsInWindow({ pipelinesRoot, brainsRoot, since });
    const priced = await priceAttempts(attempts, { harnessFor, rates: await rates(overridesFile), cache: conversationCache });
    snapshot = summarize(priced, { days, since, computedAt: new Date(now()).toISOString() });
  }

  return { read };
}

/**
 * Reduces a priced window to what a person reads at a glance and on hover.
 *
 * Everything that could not be priced or reached is folded into `excluded`
 * with a count, so the hover states what the number leaves out in one line
 * per reason instead of listing hundreds of attempts nobody will read.
 */
export function summarize(priced, { days, since, computedAt }) {
  const byHarness = new Map();
  const byModel = new Map();
  const byWork = new Map();
  for (const entry of priced.conversations) {
    add(byHarness, entry.harness, entry.cost.amount);
    for (const part of entry.cost.parts) add(byModel, `${part.provider}/${part.model}`, part.amount ?? 0);
    const attempt = entry.attempts[0];
    add(byWork, [attempt.scope, attempt.area ?? "", attempt.name ?? ""].join(WORK_KEY_SEPARATOR), entry.cost.amount);
  }
  const excluded = new Map();
  for (const entry of priced.unattributed) excluded.set(entry.reason, (excluded.get(entry.reason) ?? 0) + 1);
  for (const model of priced.unpriced) excluded.set(`no published rate for ${model}`, (excluded.get(`no published rate for ${model}`) ?? 0) + 1);
  return {
    status: "ready",
    days,
    since,
    computedAt,
    amount: priced.amount,
    display: formatUsd(priced.amount),
    currency: "USD",
    complete: priced.complete && priced.unattributed.length === 0,
    conversations: priced.conversations.length,
    byHarness: ranked(byHarness).map(([harness, amount]) => ({ harness, amount, display: formatUsd(amount) })),
    byModel: ranked(byModel).map(([id, amount]) => ({ id, amount, display: formatUsd(amount) })),
    work: ranked(byWork).slice(0, 6).map(([key, amount]) => {
      const [scope, area, name] = key.split(WORK_KEY_SEPARATOR);
      return { scope, area, name, amount, display: formatUsd(amount) };
    }),
    excluded: [...excluded.entries()].map(([reason, count]) => ({ reason, count })).sort((left, right) => right.count - left.count),
  };
}

/** Adds one amount into a running group. */
function add(groups, key, amount) {
  groups.set(key, (groups.get(key) ?? 0) + (Number.isFinite(amount) ? amount : 0));
}

/** One group's entries, most expensive first, with the empty ones dropped. */
function ranked(groups) {
  return [...groups.entries()].filter(([, amount]) => amount > 0).sort((left, right) => right[1] - left[1]);
}

/**
 * The rate catalog, with any local overrides merged in front of it.
 *
 * The file is read on each reading rather than cached, so a rate typed into
 * it shows up in the next refresh without restarting the shell.
 */
async function rates(overridesFile) {
  const text = await readFile(overridesFile, "utf8").catch(() => null);
  if (text === null) return undefined;
  try {
    const parsed = JSON.parse(text);
    return mergeRates(Array.isArray(parsed?.rates) ? parsed.rates : []);
  } catch {
    return undefined;
  }
}
