import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  conversationReport,
  loadUsageDatasetFromIndex,
  type NormalizedConversation,
  type NormalizedToolCall
} from "@tangent/usage-index-sqlite";

import type { EvalMetrics } from "../types/metrics.js";
import type { EvalRunManifest, EvalRunVariantState } from "../types/run.js";
import { variantDir } from "../core/run-store.js";

/** A single tool invocation, projected to the compact, scannable shape the compare UI renders. */
export type ConversationToolCallView = {
  id: string;
  name: string;
  category: string;
  targetPaths: string[];
  status?: "success" | "error" | "unknown";
  durationMs?: number;
  /** A short, single-line summary of the call's input (command, path, pattern, url) for quick scanning. */
  inputPreview?: string;
};

/** One user or assistant turn, with its tool calls. */
export type ConversationMessageView = {
  id: string;
  role: "user" | "assistant";
  at?: string;
  model?: string;
  text: string;
  thinking?: string;
  toolCalls: ConversationToolCallView[];
};

/** One reconstructed agent conversation for a variant. */
export type ConversationView = {
  id: string;
  provider: "claude" | "codex";
  startedAt?: string;
  endedAt?: string;
  messages: ConversationMessageView[];
  totals: { userMessages: number; assistantMessages: number; toolCalls: number };
};

/** The conversations a single eval variant's agent produced, reconstructed from the usage index. */
export type VariantConversationsView = {
  schema: "eval.conversations.v1";
  caseId: string;
  variantId: string;
  conversations: ConversationView[];
  /** Caveats and per-conversation reconstruction failures, surfaced to the user instead of swallowed. */
  notes: string[];
};

/**
 * Reconstructs every conversation a variant's agent ran, so the compare screen can show what each agent
 * actually did (which files it read, which commands it ran, whether it loaded a skill). Conversation ids
 * are captured in the variant's metrics.json at collection time; here we replay each one from the usage
 * index that still lives under the variant's worktree. Reconstruction never throws: a variant that was
 * never collected, or a conversation whose transcript is gone, becomes a note rather than a failed request.
 */
export async function variantConversationsView(manifest: EvalRunManifest, caseId: string, variant: EvalRunVariantState): Promise<VariantConversationsView> {
  const notes: string[] = [];
  const metrics = await readMetrics(manifest, variant);
  if (!metrics) {
    return { schema: "eval.conversations.v1", caseId, variantId: variant.variantId, conversations: [], notes: ["No metrics captured for this variant yet; run collection to index its conversation."] };
  }
  const conversations: ConversationView[] = [];
  for (const ref of metrics.conversations ?? []) {
    try {
      const dataset = await loadUsageDatasetFromIndex({
        repo: variant.worktree,
        providers: ["claude", "codex"],
        sources: ["native", "usage-jsonl"],
        conversationId: ref.id
      });
      const normalized = conversationReport(dataset, { conversationId: ref.id });
      conversations.push(projectConversation(normalized));
      for (const caveat of normalized.caveats) notes.push(caveat);
    } catch (error) {
      notes.push(`Could not reconstruct conversation ${ref.id}: ${(error as Error).message}`);
    }
  }
  return { schema: "eval.conversations.v1", caseId, variantId: variant.variantId, conversations, notes: [...new Set(notes)] };
}

/** Projects a normalized conversation to the compact view the compare UI consumes. */
export function projectConversation(conversation: NormalizedConversation): ConversationView {
  return {
    id: conversation.conversationId,
    provider: conversation.provider,
    startedAt: conversation.startedAt,
    endedAt: conversation.endedAt,
    totals: {
      userMessages: conversation.totals.userMessages,
      assistantMessages: conversation.totals.assistantMessages,
      toolCalls: conversation.totals.toolCalls
    },
    messages: conversation.messages.map((message) => ({
      id: message.id,
      role: message.role,
      at: message.at,
      model: message.role === "assistant" ? message.model : undefined,
      text: message.text,
      thinking: message.role === "assistant" ? message.thinking : undefined,
      toolCalls: message.role === "assistant" ? message.toolCalls.map(projectToolCall) : []
    }))
  };
}

/** Projects a normalized tool call, deriving a one-line input preview for quick scanning. */
function projectToolCall(call: NormalizedToolCall): ConversationToolCallView {
  return {
    id: call.id,
    name: call.name,
    category: call.category,
    targetPaths: call.targetPaths,
    status: call.result?.status,
    durationMs: call.result?.durationMs,
    inputPreview: inputPreview(call.input)
  };
}

/** Pulls the most identifying field out of a tool call's input as a short, single-line string. */
export function inputPreview(input: unknown): string | undefined {
  if (typeof input === "string") return clip(input);
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  for (const key of ["command", "file_path", "path", "pattern", "query", "url", "prompt"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return clip(value);
  }
  return undefined;
}

/** Trims a value to a single line capped at 160 characters. */
function clip(value: string): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}

/** Reads a variant's persisted metrics.json, returning undefined when it is absent or malformed. */
async function readMetrics(manifest: EvalRunManifest, variant: EvalRunVariantState): Promise<EvalMetrics | undefined> {
  const file = path.join(variantDir(manifest, variant.caseId, variant.variantId), "metrics.json");
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as EvalMetrics;
    return parsed.schema === "eval.metrics.v1" ? parsed : undefined;
  } catch {
    return undefined;
  }
}
