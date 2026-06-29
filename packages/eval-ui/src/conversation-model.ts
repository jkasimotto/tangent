import type { EvalConversation, EvalConversationMessage } from "./client.js";

/**
 * Whether a turn matches a free-text needle, searched case-insensitively across its prose, its hidden
 * thinking, and every tool call's name, input preview, and target paths. This is what powers the compare
 * screen's highlight box: typing "SKILL" lets the user see at a glance whether each agent ever touched a
 * skill file. An empty needle matches nothing (the box is inactive), so callers show every turn plainly.
 */
export function messageMatches(message: EvalConversationMessage, needle: string): boolean {
  const query = needle.trim().toLowerCase();
  if (!query) return false;
  if (message.text.toLowerCase().includes(query)) return true;
  if (message.thinking && message.thinking.toLowerCase().includes(query)) return true;
  return message.toolCalls.some((call) =>
    call.name.toLowerCase().includes(query) ||
    (call.inputPreview ?? "").toLowerCase().includes(query) ||
    call.targetPaths.some((path) => path.toLowerCase().includes(query))
  );
}

/** How many of a conversation's turns match the needle, for the per-side match count beside each column. */
export function conversationMatchCount(conversation: EvalConversation, needle: string): number {
  if (!needle.trim()) return 0;
  return conversation.messages.reduce((total, message) => total + (messageMatches(message, needle) ? 1 : 0), 0);
}
