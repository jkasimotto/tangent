// What one conversation cost, read from the transcript the harness wrote.
//
// Three rules hold across all three harnesses.
//
// Subagents are part of the conversation. They spend against the same Job, so
// leaving them out understates a Job by however much its subagents did. Over
// 249 measured Claude sessions, every session with no subagents matched its
// own ledger to four decimal places and every session with subagents
// under-reported by 4 to 26 percent.
//
// A harness's own ledger beats anything computed here, but only while it is
// the last word. Token counts are recomputed otherwise, and a cost the
// harness wrote down at the time is never trusted on its own: pi writes a
// cost object on every message and every one of them is zero, because the
// price table it read was zero. A cost that was wrong when it was written
// stays wrong forever. Token counts do not.
//
// What a number leaves out travels with the number. A conversation whose
// transcript is missing, or whose model has no rate, comes back saying so in
// `notes` and `unpriced` rather than quietly reading zero.

import { readFile, stat } from "node:fs/promises";

import { addUsage, emptyUsage, tokenCount } from "./token-usage.mjs";
import { priceUsage, totalCost } from "./token-pricing.mjs";
import { resolveConversationFiles } from "./harness-transcripts.mjs";

const LEDGER_SOURCE = "Claude Code's own cost ledger, recorded in the transcript.";
const LEDGER_NOTE = "priced from Claude Code's own ledger, which already includes subagents and its background calls";
const PI_SUBAGENT_NOTE = "pi records subagent work inside the conversation, so it is already counted";

/**
 * The gap a Claude conversation carries when its own ledger cannot be used.
 *
 * A running or interrupted conversation has no ledger that is still the last
 * word, so its tokens are priced instead. Those tokens are not the whole
 * bill: measured over 137 model rows whose transcript totals match the ledger
 * exactly, the rate is right to 0.1 percent, but two kinds of billed row
 * reach the ledger and never the transcript, `claude-haiku-4-5` background
 * calls and the `claude-opus-5[1m]` long-context SKU. A figure built this way
 * is a floor, and it says so rather than reading as the whole number.
 */
const TOKEN_PRICED_GAP = {
  reason: "priced from tokens, not from Claude Code's own ledger",
  detail: "These conversations are still running or were interrupted. Background calls and the long-context billing SKU never reach a transcript, so this part of the figure is a floor.",
};

/** The gap a conversation carries when one of its files could not be read. */
const UNREADABLE_GAP = { reason: "a transcript file could not be read", detail: "The work in it is missing from the figure." };

/**
 * Reads and prices one recorded conversation, including its subagents.
 *
 * `rates` is the catalog to price against, so a caller that loaded the vault
 * pricing Document passes the merged table straight through.
 */
export async function conversationCost({ harness, conversation, cwd, startedAt, rates, cache } = {}) {
  const usage = await conversationUsage({ harness, conversation, cwd, startedAt, cache });
  if (!usage) return null;
  const parts = usage.byModel.map((part) => part.reported == null
    ? priceUsage(part, rates)
    : { provider: part.provider, model: part.model, usage: part.usage, modifiers: part.modifiers, amount: part.reported, priced: true, source: LEDGER_SOURCE });
  return { ...usage, ...totalCost(parts) };
}

/**
 * Reads one recorded conversation's token usage, grouped by the model that
 * spent it, without pricing it.
 */
export async function conversationUsage({ harness, conversation, cwd, startedAt, cache } = {}) {
  const resolved = await resolveConversationFiles({ harness, conversation, cwd, startedAt });
  if (!resolved) return null;
  if (!resolved.path) {
    return { family: resolved.family, path: null, files: [], byModel: [], subagentFiles: 0, notes: ["the transcript for this conversation was not found"], gaps: [] };
  }
  const stamp = cache ? await filesStamp([resolved.path, ...resolved.subagents]) : null;
  const cached = stamp ? cache.get(resolved.path) : null;
  if (cached?.stamp === stamp) return cached.usage;
  const notes = resolved.subagentsSupported ? [] : [PI_SUBAGENT_NOTE];
  const gaps = [];
  const ledger = resolved.family === "claude" ? claudeLedger(await readRows(resolved.path)) : null;
  if (ledger) {
    return remember(cache, resolved.path, stamp, { family: resolved.family, path: resolved.path, files: [resolved.path], byModel: ledger, subagentFiles: resolved.subagents.length, notes: [...notes, LEDGER_NOTE], gaps });
  }
  if (resolved.family === "claude") gaps.push(TOKEN_PRICED_GAP);
  const files = [resolved.path, ...resolved.subagents];
  const seen = new Set();
  const groups = new Map();
  for (const file of files) {
    const rows = await readRows(file);
    if (!rows) {
      notes.push(`a transcript could not be read: ${file}`);
      gaps.push(UNREADABLE_GAP);
      continue;
    }
    for (const part of readUsage(resolved.family, rows, seen)) collect(groups, part);
  }
  return remember(cache, resolved.path, stamp, { family: resolved.family, path: resolved.path, files, byModel: [...groups.values()], subagentFiles: resolved.subagents.length, notes, gaps });
}

/**
 * Claude Code's own ledger for a finished conversation, or null.
 *
 * Claude Code keeps a running cost total in process and writes it to the
 * transcript as a `cost-state` record. That ledger is better than anything
 * this module can compute: it already includes subagents, and it includes the
 * background calls that never become transcript rows at all. Two model rows
 * were measured appearing in ledgers and never in the transcript beside them,
 * `claude-haiku-4-5` background work and the `claude-opus-5[1m]` billing SKU,
 * which held 38,809 output tokens on one session.
 *
 * It is only usable while it is the last word. The record is a snapshot, not
 * a footer, and an interrupted session has one written before its final
 * billed response: one measured session's ledger read $0.002 for work that
 * cost $0.23. A ledger with billed work after it falls through to pricing the
 * tokens instead.
 */
export function claudeLedger(rows) {
  if (!rows) return null;
  let ledger = null;
  let billedAfter = false;
  for (const row of rows) {
    if (row?.type === "cost-state" && row.modelUsage && typeof row.totalCostUSD === "number") {
      ledger = row;
      billedAfter = false;
      continue;
    }
    if (row?.message?.role === "assistant" && row.message.usage) billedAfter = true;
  }
  if (!ledger || billedAfter || ledger.hasUnknownModelCost) return null;
  return Object.entries(ledger.modelUsage).map(([model, recorded]) => ({
    provider: "anthropic",
    model,
    usage: {
      input: tokenCount(recorded.inputTokens),
      output: tokenCount(recorded.outputTokens),
      cacheRead: tokenCount(recorded.cacheReadInputTokens),
      // The ledger sums both cache-write buckets into one field, so the split
      // cannot be recovered here. It does not need to be: the ledger's own
      // `costUSD` is what is used, and the tokens are carried for display.
      cacheWrite: tokenCount(recorded.cacheCreationInputTokens),
      cacheWrite1h: 0,
      reasoning: tokenCount(recorded.thinkingTokens),
    },
    modifiers: { webSearchRequests: tokenCount(recorded.webSearchRequests) },
    reported: tokenCount(recorded.costUSD),
  }));
}

/**
 * The identity of one conversation's files as they are right now.
 *
 * A live conversation grows on every response, so size and modification time
 * together tell a finished reading from a stale one, and a finished
 * conversation is then never read twice.
 */
async function filesStamp(files) {
  const parts = [];
  for (const file of files) {
    const info = await stat(file).catch(() => null);
    parts.push(info ? `${file}:${info.size}:${info.mtimeMs}` : `${file}:gone`);
  }
  return parts.join("|");
}

/** Stores one reading against the state of the files it was read from. */
function remember(cache, key, stamp, usage) {
  if (cache && stamp) cache.set(key, { stamp, usage });
  return usage;
}

/** Dispatches to the reader for one harness family. */
function readUsage(family, rows, seen) {
  if (family === "claude") return readClaudeUsage(rows, seen);
  if (family === "codex") return readCodexUsage(rows);
  if (family === "pi") return readPiUsage(rows);
  return [];
}

/**
 * Reads Claude usage, one entry per assistant message.
 *
 * A message id repeats across the lines of a streamed response and the last
 * line is the complete one, so an earlier line truncates the usage. Measured
 * on one session's subagent files: keeping the first line gives 862 output
 * tokens where keeping the last gives 2,423. The same id also appears in both
 * a parent transcript and the subagent that forked from it, which is why the
 * seen set spans every file of one conversation rather than one file.
 */
export function readClaudeUsage(rows, seen = new Set()) {
  const byId = new Map();
  for (const row of rows) {
    const message = row?.message;
    if (message?.role !== "assistant" || !message.usage || !message.id) continue;
    if (typeof message.model !== "string" || !message.model || message.model === "<synthetic>") continue;
    byId.set(message.id, message);
  }
  const parts = [];
  for (const [id, message] of byId) {
    if (seen.has(id)) continue;
    seen.add(id);
    const usage = message.usage;
    const creation = usage.cache_creation ?? {};
    const split = tokenCount(creation.ephemeral_5m_input_tokens) + tokenCount(creation.ephemeral_1h_input_tokens);
    parts.push({
      provider: "anthropic",
      model: message.model,
      usage: {
        input: tokenCount(usage.input_tokens),
        output: tokenCount(usage.output_tokens),
        cacheRead: tokenCount(usage.cache_read_input_tokens),
        // A record written before the buckets were split reports one total.
        // It bills at the five-minute rate, which is what Claude Code asks for.
        cacheWrite: split ? tokenCount(creation.ephemeral_5m_input_tokens) : tokenCount(usage.cache_creation_input_tokens),
        cacheWrite1h: tokenCount(creation.ephemeral_1h_input_tokens),
        reasoning: tokenCount(usage.output_tokens_details?.thinking_tokens),
      },
      modifiers: {
        usGeo: usage.inference_geo === "us",
        fastMode: usage.speed === "fast",
        webSearchRequests: tokenCount(usage.server_tool_use?.web_search_requests),
      },
    });
  }
  return parts;
}

/**
 * Reads Codex usage from the running totals it emits.
 *
 * Codex reports one cumulative total per request rather than a per-request
 * figure, and re-emits the same figure often enough that summing the
 * per-request field overstates a thread. So the totals are differenced, and
 * each difference is charged to whichever model was in force when it
 * appeared: a thread that switched models would otherwise bill all of its
 * work at the last model's rate.
 *
 * Codex counts cached tokens inside `input_tokens`, unlike Anthropic, so the
 * cached part is taken back out to leave the tokens charged at the full rate.
 */
export function readCodexUsage(rows) {
  const parts = [];
  let model = "";
  let provider = "openai";
  let previous = null;
  for (const row of rows) {
    const payload = row?.payload ?? {};
    if (row?.type === "session_meta") {
      provider = String(payload.model_provider || provider);
      model = String(payload.model || model);
      continue;
    }
    if (payload.model) model = String(payload.model);
    if (payload.type !== "token_count") continue;
    const total = payload.info?.total_token_usage;
    if (!total) continue;
    const step = codexDifference(total, previous);
    previous = total;
    if (!model || !step) continue;
    parts.push({ provider, model, usage: step, modifiers: {} });
  }
  return parts;
}

/** The cumulative fields Codex reports, which only ever rise inside one run. */
const CODEX_TOTAL_FIELDS = ["input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens"];

/**
 * The tokens one cumulative Codex total added over the one before it.
 *
 * Codex restarts its counter inside a thread when the context is compacted,
 * so the running total falls instead of rising. Measured over 400 rollouts,
 * three did this. The tokens before the fall were still spent, so a fall is
 * read as the start of a second run and the new total is charged whole: a
 * plain difference would clamp that step to zero and lose it, and following
 * the last total alone would lose everything before the fall.
 */
function codexDifference(total, previous) {
  const base = codexReset(total, previous) ? null : previous;
  const input = tokenCount(total.input_tokens) - tokenCount(base?.input_tokens);
  const cached = tokenCount(total.cached_input_tokens) - tokenCount(base?.cached_input_tokens);
  const usage = {
    input: Math.max(0, input - cached),
    output: Math.max(0, tokenCount(total.output_tokens) - tokenCount(base?.output_tokens)),
    cacheRead: Math.max(0, cached),
    cacheWrite: Math.max(0, tokenCount(total.cache_write_input_tokens) - tokenCount(base?.cache_write_input_tokens)),
    cacheWrite1h: 0,
    reasoning: Math.max(0, tokenCount(total.reasoning_output_tokens) - tokenCount(base?.reasoning_output_tokens)),
  };
  return usage.input || usage.output || usage.cacheRead || usage.cacheWrite ? usage : null;
}

/** True when a running Codex total fell, which only a restarted counter does. */
function codexReset(total, previous) {
  if (!previous) return false;
  return CODEX_TOTAL_FIELDS.some((field) => tokenCount(total[field]) < tokenCount(previous[field]));
}


/**
 * Reads pi usage, which is already in this shape.
 *
 * pi names the provider and the model on every message, so a conversation
 * that changed provider mid-run is attributed correctly without inference.
 * Compaction and branch-summary rows carry usage too, and pi's own footer
 * counts them, so they are counted here.
 */
export function readPiUsage(rows) {
  const parts = [];
  for (const row of rows) {
    const usage = row?.message?.usage ?? (row?.type === "branch_summary" || row?.type === "compaction" ? row.usage : null);
    if (!usage) continue;
    const message = row.message ?? {};
    const model = String(message.model ?? row.modelId ?? "");
    const provider = String(message.provider ?? row.provider ?? "");
    if (!model || !provider) continue;
    parts.push({
      provider,
      model,
      usage: {
        input: tokenCount(usage.input),
        output: tokenCount(usage.output),
        cacheRead: tokenCount(usage.cacheRead),
        cacheWrite: tokenCount(usage.cacheWrite),
        cacheWrite1h: 0,
        reasoning: tokenCount(usage.reasoning),
      },
      modifiers: {},
    });
  }
  return parts;
}

/** Adds one part into the running group for its provider, model, and modifiers. */
function collect(groups, part) {
  const key = `${part.provider} ${part.model} ${part.modifiers.fastMode ? "fast" : ""} ${part.modifiers.usGeo ? "us" : ""}`;
  const existing = groups.get(key);
  if (!existing) {
    groups.set(key, { ...part, usage: addUsage(emptyUsage(), part.usage), modifiers: { ...part.modifiers } });
    return;
  }
  existing.usage = addUsage(existing.usage, part.usage);
  existing.modifiers.webSearchRequests = tokenCount(existing.modifiers.webSearchRequests) + tokenCount(part.modifiers.webSearchRequests);
}

/** Reads and parses one JSONL transcript, or null when it cannot be read. */
async function readRows(file) {
  const text = await readFile(file, "utf8").catch(() => null);
  if (text === null) return null;
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try { rows.push(JSON.parse(line)); } catch { continue; }
  }
  return rows;
}
