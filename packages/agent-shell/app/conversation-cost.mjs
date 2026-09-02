// What one conversation cost, read from the transcript the harness wrote.
//
// Three rules hold across all three harnesses.
//
// The token counts are recomputed here and the harness's own cost number is
// never trusted. pi writes a cost object on every message, and every one of
// them is zero because the price table it read at the time was zero. A cost
// that was wrong when it was written stays wrong forever; token counts do not.
//
// Subagents are part of the conversation. They spend against the same Job, so
// leaving them out understates a Job by however much its subagents did.
//
// What a number leaves out travels with the number. A conversation whose
// transcript is missing, or whose model has no published rate, comes back
// with that said in `notes` and `unpriced` rather than quietly reading zero.

import { readFile, stat } from "node:fs/promises";

import { addUsage, emptyUsage, priceUsage, totalCost } from "@tangent/pricing";

import { resolveConversationFiles } from "./harness-transcripts.mjs";

/**
 * Reads and prices one recorded conversation, including its subagents.
 *
 * `rates` is the catalog to price against, so a caller that loaded local rate
 * overrides can pass them straight through.
 */
export async function conversationCost({ harness, conversation, cwd, startedAt, rates, cache } = {}) {
  const usage = await conversationUsage({ harness, conversation, cwd, startedAt, cache });
  if (!usage) return null;
  const parts = usage.byModel.map((part) => part.reported == null
    ? priceUsage(part, rates)
    : { provider: part.provider, model: part.model, usage: part.usage, amount: part.reported, priced: true, source: LEDGER_SOURCE });
  return { ...usage, ...totalCost(parts) };
}

/**
 * Reads one recorded conversation's token usage, grouped by the model that
 * spent it, without pricing it.
 */
export async function conversationUsage({ harness, conversation, cwd, startedAt, cache } = {}) {
  const resolved = await resolveConversationFiles({ harness, conversation, cwd, startedAt });
  if (!resolved) return null;
  const notes = [];
  if (!resolved.path) {
    return { family: resolved.family, path: null, files: [], byModel: [], subagentFiles: 0, notes: ["the transcript for this conversation was not found"] };
  }
  const stamp = cache ? await filesStamp([resolved.path, ...resolved.subagents]) : null;
  const cached = stamp ? cache.get(resolved.path) : null;
  if (cached?.stamp === stamp) return cached.usage;
  if (!resolved.subagentsSupported) notes.push("pi records subagent work inside the conversation, so it is already counted");
  const ledger = resolved.family === "claude" ? claudeLedger(await readRows(resolved.path)) : null;
  if (ledger) {
    return remember(cache, resolved.path, stamp, { family: resolved.family, path: resolved.path, files: [resolved.path], byModel: ledger, subagentFiles: 0, notes: [...notes, LEDGER_NOTE] });
  }
  const files = [resolved.path, ...resolved.subagents];
  const seen = new Set();
  const groups = new Map();
  for (const file of files) {
    const rows = await readRows(file);
    if (!rows) {
      notes.push(`a transcript could not be read: ${file}`);
      continue;
    }
    for (const part of readUsage(resolved.family, rows, seen)) collect(groups, part);
  }
  return remember(cache, resolved.path, stamp, { family: resolved.family, path: resolved.path, files, byModel: [...groups.values()], subagentFiles: resolved.subagents.length, notes });
}

const LEDGER_SOURCE = "Claude Code's own cost ledger, recorded in the transcript.";
const LEDGER_NOTE = "priced from Claude Code's own ledger, which already includes subagents and its background calls";

/**
 * Claude Code's own ledger for a finished conversation, or null.
 *
 * Claude Code keeps a running cost total in process and writes it to the
 * transcript as a `cost-state` record. That ledger is better than anything
 * this module can compute: it counts the background calls Claude Code makes
 * that never become transcript rows, which measured about 0.04% of a session
 * across twelve of Julian's transcripts, and it already includes subagents.
 *
 * It is only usable when it is the last word. The record is a snapshot, and a
 * session that was interrupted has one written before its final response, so
 * a ledger with billed work after it would understate the conversation badly.
 * Those fall through to token pricing.
 */
function claudeLedger(rows) {
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
      input: count(recorded.inputTokens),
      output: count(recorded.outputTokens),
      cacheRead: count(recorded.cacheReadInputTokens),
      cacheWrite: count(recorded.cacheCreationInputTokens),
      cacheWrite1h: 0,
      reasoning: count(recorded.thinkingTokens),
    },
    modifiers: { webSearchRequests: count(recorded.webSearchRequests) },
    reported: count(recorded.costUSD),
  }));
}

/**
 * The identity of one conversation's files as they are right now.
 *
 * A live conversation grows on every response, so size and modification time
 * together are enough to tell a finished reading from a stale one, and a
 * finished conversation is then never read twice.
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
 * A message id repeats across the lines of a streamed response, and the last
 * line is the complete one, so an earlier line would truncate the usage. The
 * same id also appears in both a parent transcript and the subagent that
 * forked from it, which is why the seen set spans every file of one
 * conversation rather than one file.
 */
function readClaudeUsage(rows, seen) {
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
    const fivePlusOneHour = count(creation.ephemeral_5m_input_tokens) + count(creation.ephemeral_1h_input_tokens);
    parts.push({
      provider: "anthropic",
      model: message.model,
      usage: {
        input: count(usage.input_tokens),
        output: count(usage.output_tokens),
        cacheRead: count(usage.cache_read_input_tokens),
        // A record written before the buckets were split reports one total.
        // It bills at the five-minute rate, which is the default Claude Code asks for.
        cacheWrite: fivePlusOneHour ? count(creation.ephemeral_5m_input_tokens) : count(usage.cache_creation_input_tokens),
        cacheWrite1h: count(creation.ephemeral_1h_input_tokens),
        reasoning: count(usage.output_tokens_details?.thinking_tokens),
      },
      modifiers: {
        usGeo: usage.inference_geo === "us",
        fastMode: usage.speed === "fast",
        webSearchRequests: count(usage.server_tool_use?.web_search_requests),
      },
    });
  }
  return parts;
}

/**
 * Reads Codex usage from the running totals it emits.
 *
 * Codex reports one cumulative total per request rather than a per-request
 * figure, and it re-emits the same figure often enough that summing the
 * per-request field overstates a thread by a few percent. So the totals are
 * differenced, and each difference is charged to whichever model was in force
 * when it appeared: a thread that switched models mid-run would otherwise
 * bill all of its work at the last model's rate.
 *
 * Codex counts cached tokens inside `input_tokens`, unlike Anthropic, so the
 * cached part is taken back out to leave the tokens charged at full rate.
 */
function readCodexUsage(rows) {
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
    const step = difference(total, previous);
    previous = total;
    if (!model || !step) continue;
    parts.push({ provider, model, usage: step, modifiers: {} });
  }
  return parts;
}

/** The tokens one cumulative Codex total added over the one before it. */
function difference(total, previous) {
  const input = count(total.input_tokens) - count(previous?.input_tokens);
  const cached = count(total.cached_input_tokens) - count(previous?.cached_input_tokens);
  const write = count(total.cache_write_input_tokens) - count(previous?.cache_write_input_tokens);
  const output = count(total.output_tokens) - count(previous?.output_tokens);
  const reasoning = count(total.reasoning_output_tokens) - count(previous?.reasoning_output_tokens);
  const usage = {
    input: Math.max(0, input - cached),
    output: Math.max(0, output),
    cacheRead: Math.max(0, cached),
    cacheWrite: Math.max(0, write),
    cacheWrite1h: 0,
    reasoning: Math.max(0, reasoning),
  };
  return usage.input || usage.output || usage.cacheRead || usage.cacheWrite ? usage : null;
}

/**
 * Reads pi usage, which is already in this shape.
 *
 * pi names the provider and the model on every message, so a conversation
 * that switched provider mid-run is attributed correctly without inference.
 * Tool results and compaction entries carry usage too, and pi's own footer
 * counts them, so they are counted here.
 */
function readPiUsage(rows) {
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
        input: count(usage.input),
        output: count(usage.output),
        cacheRead: count(usage.cacheRead),
        cacheWrite: count(usage.cacheWrite),
        cacheWrite1h: 0,
        reasoning: count(usage.reasoning),
      },
      modifiers: {},
    });
  }
  return parts;
}

/** Adds one part into the running group for its provider, model, and modifiers. */
function collect(groups, part) {
  const key = `${part.provider} ${part.model} ${part.modifiers.fastMode ? "fast" : ""} ${part.modifiers.usGeo ? "us" : ""}`;
  const existing = groups.get(key);
  if (!existing) {
    groups.set(key, { ...part, usage: addUsage(emptyUsage(), part.usage), modifiers: { ...part.modifiers } });
    return;
  }
  existing.usage = addUsage(existing.usage, part.usage);
  existing.modifiers.webSearchRequests = count(existing.modifiers.webSearchRequests) + count(part.modifiers.webSearchRequests);
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

/** Coerces one reported count to a usable number; anything else counts as zero. */
function count(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
