import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { readConversationsUserMessages, type ConversationUserMessages, type ReadConversationsUserMessagesOptions } from "@tangent/usage-index-sqlite";

import { loadConfig } from "../core/config.js";
import { hashObject } from "../core/hash.js";
import { ClaudeCliCorrectionRunner } from "../metrics/runner.js";
import type { ConversationMetrics, CorrectionRunner, CorrectionRunnerResult, MetricsAggregate, MetricsRollupResult } from "../metrics/types.js";

export type ProcessMetricsOptions = {
  conversationIds: string[];
  repo?: string;
  scope?: "repo" | "all";
  providers?: Array<"claude" | "codex">;
  /** Model for the correction judge. Defaults to haiku: the input is user messages only, so it is cheap and fast. */
  model?: string;
  /** Injectable runner for tests; defaults to the Claude CLI correction runner. */
  runner?: CorrectionRunner;
  /** Injectable user-message reader for tests; defaults to reading the usage index. */
  readMessages?: (options: ReadConversationsUserMessagesOptions) => Promise<ConversationUserMessages[]>;
  /** Max conversations judged concurrently. */
  concurrency?: number;
};

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MODEL = "haiku";
// A conversation needs at least two user messages for a correction to exist: the first is the
// initial task, so there is nothing to correct until the second.
const MIN_MESSAGES_FOR_CORRECTION = 2;

type MetricsCacheEntry = {
  schema: "metrics.cache.v1";
  fingerprint: string;
  analyzedAt: string;
  result: CorrectionRunnerResult;
};

/**
 * Rolls up correction metrics for a set of conversations: reads each conversation's user messages
 * from the usage index, judges corrections with the runner (cheap haiku by default), and returns
 * per-conversation results plus the headline aggregate. Unchanged conversations are served from a
 * per-conversation cache keyed by a fingerprint of their user messages, so re-running a selection
 * only pays for conversations that changed. A conversation that fails to judge is reported as failed
 * and excluded from the aggregate rather than crashing the batch.
 */
export async function processMetrics(options: ProcessMetricsOptions): Promise<MetricsRollupResult> {
  const loaded = await loadConfig({ repo: options.repo || "." });
  const cacheDir = path.join(loaded.paths.artifactsDir, "metrics");
  await mkdir(cacheDir, { recursive: true });
  const runner = options.runner || new ClaudeCliCorrectionRunner({
    command: claudeCommand(loaded.config),
    model: options.model || DEFAULT_MODEL,
    timeoutMs: loaded.config.summary.provider.timeoutMs
  });

  const readMessages = options.readMessages || readConversationsUserMessages;
  const conversations = await readMessages({
    conversationIds: options.conversationIds,
    repo: options.repo || ".",
    scope: options.scope,
    providers: options.providers
  });

  const perConversation = await mapWithConcurrency(
    conversations,
    options.concurrency || DEFAULT_CONCURRENCY,
    (conversation) => analyzeConversation(conversation, runner, cacheDir)
  );

  return { schema: "metrics.rollup.v1", perConversation, aggregate: aggregate(perConversation) };
}

/** Judges one conversation, short-circuiting trivial cases and reusing an unchanged cached result. */
async function analyzeConversation(conversation: ConversationUserMessages, runner: CorrectionRunner, cacheDir: string): Promise<ConversationMetrics> {
  const base = { conversationId: conversation.conversationId, title: conversation.title };
  if (conversation.userMessages.length < MIN_MESSAGES_FOR_CORRECTION) {
    return { ...base, status: "analyzed", correctionCount: 0, corrections: [], firstPass: true };
  }

  const fingerprint = hashObject(conversation.userMessages);
  const cachePath = path.join(cacheDir, `${safeFileId(conversation.conversationId)}.json`);
  const cached = await readCache(cachePath);
  if (cached && cached.fingerprint === fingerprint) {
    return toMetrics(base, cached.result, "cached");
  }

  try {
    const result = await runner.analyze({ conversationId: conversation.conversationId, title: conversation.title, userMessages: conversation.userMessages });
    await writeCache(cachePath, { schema: "metrics.cache.v1", fingerprint, analyzedAt: new Date().toISOString(), result });
    return toMetrics(base, result, "analyzed");
  } catch (error) {
    return { ...base, status: "failed", correctionCount: 0, corrections: [], firstPass: false, error: (error as Error).message };
  }
}

/** Shapes a runner result into the per-conversation metrics record. */
function toMetrics(base: { conversationId: string; title?: string }, result: CorrectionRunnerResult, status: "analyzed" | "cached"): ConversationMetrics {
  return { ...base, status, correctionCount: result.correctionCount, corrections: result.corrections, firstPass: result.correctionCount === 0 };
}

/** Computes the headline aggregate over the conversations that were judged successfully. */
function aggregate(perConversation: ConversationMetrics[]): MetricsAggregate {
  const successful = perConversation.filter((conversation) => conversation.status !== "failed");
  const totalCorrections = successful.reduce((sum, conversation) => sum + conversation.correctionCount, 0);
  const firstPass = successful.filter((conversation) => conversation.firstPass).length;
  return {
    conversationsAnalyzed: successful.length,
    totalCorrections,
    firstPassRate: successful.length ? firstPass / successful.length : 0
  };
}

/** Makes a conversation id safe to use as a cache file name. */
function safeFileId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

/** Reads a cached judgment, ignoring an absent or unreadable cache file. */
async function readCache(cachePath: string): Promise<MetricsCacheEntry | undefined> {
  try {
    return JSON.parse(await readFile(cachePath, "utf8")) as MetricsCacheEntry;
  } catch {
    return undefined;
  }
}

/** Writes a cached judgment for reuse on the next unchanged run. */
async function writeCache(cachePath: string, entry: MetricsCacheEntry): Promise<void> {
  await writeFile(cachePath, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
}

/** Resolves the Claude CLI command from config when the summary provider is claude-cli. */
function claudeCommand(config: Awaited<ReturnType<typeof loadConfig>>["config"]): string | undefined {
  return config.summary.provider.kind === "claude-cli" ? config.summary.provider.command : undefined;
}

/** Runs an async mapper over items with a bounded number of concurrent tasks, preserving input order. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}
