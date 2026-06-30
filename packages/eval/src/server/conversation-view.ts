import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  type NormalizedConversation,
  type NormalizedToolCall
} from "@tangent/usage-index-sqlite";

import type { EvalMetrics } from "../types/metrics.js";
import type { EvalRunManifest, EvalRunVariantState } from "../types/run.js";
import { variantDir } from "../core/run-store.js";
import { reconstructVariantConversations, relativeToWorktree, stripWorktree } from "../core/transcript.js";

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
  provider: "claude" | "codex" | "gemini";
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
  const { conversations: normalized, notes: reconstructNotes } = await reconstructVariantConversations(variant, metrics.conversations ?? []);
  for (const note of reconstructNotes) notes.push(note);
  const conversations = normalized.map((conv) => projectConversation(conv, variant.worktree));
  return { schema: "eval.conversations.v1", caseId, variantId: variant.variantId, conversations, notes: [...new Set(notes)] };
}

/**
 * Projects a normalized conversation to the compact view the compare UI consumes. Tool-call paths and
 * command previews are relativized against the variant's worktree so a Read shows `acme/lib/x.dart`,
 * not the full `/Users/.../runs/.../work/acme/lib/x.dart`, and a `find <worktree>/...` command reads as
 * `find acme/...`. Pass the worktree to relativize; omit it (e.g. unit tests) to leave paths absolute.
 */
export function projectConversation(conversation: NormalizedConversation, worktree?: string): ConversationView {
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
      toolCalls: message.role === "assistant" ? message.toolCalls.map((call) => projectToolCall(call, worktree)) : []
    }))
  };
}

/** Projects a normalized tool call, deriving a one-line input preview for quick scanning. */
function projectToolCall(call: NormalizedToolCall, worktree?: string): ConversationToolCallView {
  const raw = rawPreviewValue(call.input);
  return {
    id: call.id,
    name: call.name,
    category: call.category,
    targetPaths: call.targetPaths.map((target) => relativeToWorktree(target, worktree)),
    status: call.result?.status,
    durationMs: call.result?.durationMs,
    // Strip the worktree before clipping: a long grep pattern can push the path past the 160-char clip,
    // so stripping after clip would leave a truncated, unmatchable prefix behind.
    inputPreview: raw === undefined ? undefined : clip(stripWorktree(raw, worktree))
  };
}

/**
 * Pulls the most identifying field out of a tool call's input as a short, single-line string. `skill`
 * is checked first so a Skill call reads as the skill it loaded (the use case "did the agent load the
 * expression-functions skill"); the rest cover commands, file paths, searches, and prompts.
 */
export function inputPreview(input: unknown): string | undefined {
  const raw = rawPreviewValue(input);
  return raw === undefined ? undefined : clip(raw);
}

/** The raw, unclipped identifying value of a tool call's input, or undefined when none applies. */
function rawPreviewValue(input: unknown): string | undefined {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  for (const key of ["skill", "command", "file_path", "path", "pattern", "query", "url", "prompt"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
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
