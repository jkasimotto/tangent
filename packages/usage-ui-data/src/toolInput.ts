import { truncateText } from "./format.js";
import type { UsageConversationToolCall } from "./conversationView.js";

/**
 * Extracts a concise human-readable preview of what a tool call did: the command it ran, the query
 * or path it targeted, or a truncated JSON fallback. Shared by the conversation thread (tool event
 * rows) and the bottleneck ranking (so the slowest steps name the actual command).
 */
export function toolInputPreview(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return truncateText(String(value || ""), 260) || undefined;
  const input = value as Record<string, unknown>;
  const command = stringValue(input.command) || stringValue(input.cmd);
  if (command) return command;
  const text = stringValue(input.query) || stringValue(input.pattern) || stringValue(input.path) || stringValue(input.file_path);
  if (text) return text;
  return truncateText(JSON.stringify(input), 260) || undefined;
}

/** Extracts the working directory from common command tool payloads. */
export function toolWorkdir(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  return stringValue(input.workdir) || stringValue(input.cwd);
}

/** Returns a non-empty string value from unknown structured data. */
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * Indexes tool input previews (the command/query/path that ran) by step id. Shared by the flame
 * segment builder (to label and tooltip command bars) and the bottleneck ranker (to name the
 * slowest steps), so both name what happened rather than the step kind.
 */
export function stepInputPreviews(toolCalls: UsageConversationToolCall[]): Map<string, string> {
  const previews = new Map<string, string>();
  for (const tool of toolCalls) {
    const preview = toolInputPreview(tool.input);
    if (!preview) continue;
    if (tool.stepId) previews.set(tool.stepId, preview);
    if (tool.resultStepId) previews.set(tool.resultStepId, preview);
  }
  return previews;
}
