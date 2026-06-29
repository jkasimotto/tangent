import {
  conversationReport,
  loadUsageDatasetFromIndex,
  type NormalizedConversation
} from "@tangent/usage-index-sqlite";

import type { EvalRunVariantState } from "../types/run.js";

/**
 * Rewrites an absolute path inside the worktree to a relative one.
 * Paths outside the worktree are returned unchanged.
 * Exported so `conversation-view.ts` and the judge formatter share one implementation.
 */
export function relativeToWorktree(target: string, worktree?: string): string {
  if (!worktree) return target;
  const prefix = worktree.endsWith("/") ? worktree : `${worktree}/`;
  return target.startsWith(prefix) ? target.slice(prefix.length) : target;
}

/**
 * Rewrites worktree-absolute paths in a preview string to short relative ones:
 * `<worktree>/x` becomes `x`, and a bare `<worktree>` standing as its own token
 * (e.g. `cd <worktree> && git status`) becomes `.`. Sibling paths such as
 * `<worktree>-backup` are left untouched.
 * Exported so `conversation-view.ts` and the judge formatter share one implementation.
 */
export function stripWorktree(preview: string, worktree?: string): string {
  if (!worktree) return preview;
  const bare = worktree.replace(/\/+$/, "");
  const collapsed = preview.split(`${bare}/`).join("");
  const bareToken = new RegExp(`${escapeRegExp(bare)}(?=$|[\\s&;|"'])`, "g");
  return collapsed.replace(bareToken, ".");
}

/** Escapes a string for safe use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Loads and reconstructs every conversation for a variant from its usage index.
 * Mirrors the loop previously inlined in `variantConversationsView`: each conversation
 * id is fetched individually; failures become notes rather than thrown errors.
 */
export async function reconstructVariantConversations(
  variant: EvalRunVariantState,
  conversationIds: Array<{ id: string }>
): Promise<{ conversations: NormalizedConversation[]; notes: string[] }> {
  const conversations: NormalizedConversation[] = [];
  const notes: string[] = [];
  for (const ref of conversationIds) {
    try {
      const dataset = await loadUsageDatasetFromIndex({
        repo: variant.worktree,
        providers: ["claude", "codex"],
        sources: ["native", "usage-jsonl"],
        conversationId: ref.id
      });
      const normalized = conversationReport(dataset, { conversationId: ref.id });
      conversations.push(normalized);
      for (const caveat of normalized.caveats) notes.push(caveat);
    } catch (error) {
      notes.push(`Could not reconstruct conversation ${ref.id}: ${(error as Error).message}`);
    }
  }
  return { conversations, notes };
}

/**
 * Formats a list of normalized conversations as a compact plain-text transcript for the LLM judge.
 * Each user turn is rendered as `user: <text>`. Each assistant turn renders its text, optional
 * thinking, and each tool call as `name + worktree-relativized input preview`. The output is capped
 * at `maxChars` (default 12000) and a truncation marker is appended when the cap is hit.
 */
export function formatTranscriptForJudge(
  conversations: NormalizedConversation[],
  worktree: string,
  maxChars = 12000
): string {
  const lines: string[] = [];

  for (const conv of conversations) {
    for (const message of conv.messages) {
      if (message.role === "user") {
        lines.push(`user: ${message.text}`);
      } else {
        const model = message.model ?? "unknown";
        lines.push(`assistant (${model}): ${message.text}`);
        if (message.thinking) {
          lines.push(`  · thinking: ${message.thinking}`);
        }
        for (const call of message.toolCalls) {
          const inputStr = inputPreviewForJudge(call.input, worktree);
          const preview = inputStr !== undefined ? ` ${inputStr}` : "";
          lines.push(`  · ${call.name}${preview}`);
        }
      }
    }
  }

  const full = lines.join("\n");
  if (full.length <= maxChars) return full;
  return `${full.slice(0, maxChars)}\n… [transcript truncated]`;
}

/** Extracts and worktree-relativizes the most identifying field from a tool call's input. */
function inputPreviewForJudge(input: unknown, worktree: string): string | undefined {
  if (typeof input === "string") return stripWorktree(input, worktree);
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  for (const key of ["skill", "command", "file_path", "path", "pattern", "query", "url", "prompt"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return stripWorktree(relativeToWorktree(value, worktree), worktree);
    }
  }
  return undefined;
}
