// Renders the per-variant conversation transcripts: the last, deepest drill-down section of report.html.
// Every turn is collapsed inside its variant and conversation, and tool-call previews are already capped
// upstream (conversation-view.ts clips input previews to 160 characters); this module additionally caps
// assistant prose, since a long final answer or a long thinking block is otherwise the single biggest
// contributor to report.html's file size.

import type { ConversationMessageView, ConversationToolCallView, ConversationView } from "../server/conversation-view.js";
import type { ReportModel, ReportTranscript } from "./model.js";
import { clipText, escapeHtml } from "./html-escape.js";

const MAX_MESSAGE_CHARS = 2000;

/**
 * Renders the transcripts section: one collapsible block per variant containing its reconstructed
 * conversations. Skipped entirely when transcripts were never loaded (the markdown report, or an HTML
 * report requested without `includeTranscripts`) or when every variant has none to show.
 */
export function renderTranscriptsSection(model: ReportModel): string {
  const rows = model.transcripts ?? [];
  const nonEmpty = rows.filter((row) => row.conversations.length > 0 || row.notes.length > 0);
  if (nonEmpty.length === 0) return "";
  const blocks = nonEmpty.map((row) => renderVariantTranscript(row, model)).join("\n");
  return `<section>
  <h2>Conversation transcripts</h2>
  ${blocks}
</section>`;
}

/** Renders one variant's transcript block: its notes (if any) plus one collapsible per conversation. */
function renderVariantTranscript(row: ReportTranscript, model: ReportModel): string {
  const label = model.variants.find((variant) => variant.key === row.variantKey)?.label ?? row.variantKey;
  const notes = row.notes.length > 0 ? `<div class="warnings">${row.notes.map((note) => escapeHtml(note)).join("<br>")}</div>` : "";
  const conversations = row.conversations.map((conversation) => renderConversation(conversation)).join("\n");
  return `<details class="report-collapsible">
    <summary>${escapeHtml(label)}: ${row.conversations.length} conversation${row.conversations.length === 1 ? "" : "s"}</summary>
    <div class="body">${notes}${conversations}</div>
  </details>`;
}

/** Renders one conversation as a collapsible list of turns. */
function renderConversation(conversation: ConversationView): string {
  const turns = conversation.messages.map((message) => renderTurn(message)).join("\n");
  return `<details class="report-collapsible">
    <summary>${escapeHtml(conversation.id)} (${conversation.totals.userMessages} user, ${conversation.totals.assistantMessages} assistant, ${conversation.totals.toolCalls} tool calls)</summary>
    <div class="body">${turns}</div>
  </details>`;
}

/** Renders one user or assistant turn, with its tool calls when it is an assistant turn. */
function renderTurn(message: ConversationMessageView): string {
  const roleLabel = message.role === "user" ? "user" : `assistant${message.model ? ` (${message.model})` : ""}`;
  const text = escapeHtml(clipText(message.text, MAX_MESSAGE_CHARS));
  const toolCalls = message.toolCalls.map((call) => renderToolCall(call)).join("\n");
  return `<div class="transcript-turn">
    <div class="role">${escapeHtml(roleLabel)}</div>
    <div class="text">${text}</div>
    ${toolCalls}
  </div>`;
}

/** Renders a one-line summary of a single tool call: its name, category, and clipped input preview. */
function renderToolCall(call: ConversationToolCallView): string {
  const preview = call.inputPreview ? ` ${escapeHtml(call.inputPreview)}` : "";
  const status = call.status && call.status !== "success" ? ` [${escapeHtml(call.status)}]` : "";
  return `<div class="tool-call">${escapeHtml(call.name)} (${escapeHtml(call.category)})${preview}${status}</div>`;
}
