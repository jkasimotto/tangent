import type { ConversationListItem, ToolCallWithResult, TurnListItem, VisibleMessage } from "@tangent/usage-core/core/dataset";
import type { NormalizedConversation, TokenUsage } from "@tangent/usage-core/core/conversation-report";

/** Prints visible transcript messages to stdout, coalescing consecutive messages by the same role. */
export function printTranscript(rows: VisibleMessage[], resolved?: { shortId: string }): void {
  if (resolved) console.log(`Transcript: ${resolved.shortId}\n`);
  if (!rows.length) {
    console.log("No visible transcript messages captured.");
    return;
  }
  const coalesced = coalesceMessages(rows);
  for (const row of coalesced) {
    console.log(`${formatTime(row.createdAt)} ${row.role}`);
    const text = row.text || row.textPreview || "";
    console.log(indent(text || "(no text captured)"));
    if (row.role === "assistant" && row.confidence === "partial") console.log("  Capture: partial assistant text from provider hook.");
    console.log("");
  }
}

/** Prints tool call rows to stdout with status and target path summary. */
export function printToolRows(rows: ToolCallWithResult[]): void {
  if (!rows.length) {
    console.log("No tool calls captured.");
    return;
  }
  for (const [index, row] of rows.entries()) {
    const status = row.result?.status || "unknown";
    const target = row.targetPaths.length ? `  ${row.targetPaths.slice(0, 3).join(", ")}` : "";
    console.log(`${index + 1}. ${row.toolName}  ${status}${target}`);
    const command = objectField(objectField(row.input, "command") ? row.input : undefined, "command") || objectField(row.input, "cmd");
    if (typeof command === "string") console.log(`   ${preview(command, 120)}`);
  }
}

/** Prints a normalized conversation report including messages, tool calls, and token counts. */
export function printConversationReport(report: NormalizedConversation): void {
  console.log(`Session ${report.conversationId}`);
  if (report.providerSessionId) console.log(`Provider session ${report.providerSessionId}`);
  if (report.transcriptPath) console.log(`Transcript ${report.transcriptPath}`);
  if (!report.messages.length) {
    console.log("No visible transcript messages captured.");
    return;
  }

  for (const message of report.messages) {
    if (message.role === "user") {
      console.log("");
      console.log(`${formatIsoTime(message.at)} user`);
      console.log(indent(message.text || "(no text captured)"));
      continue;
    }

    const tokenText = message.tokens ? `  ${formatTokens(message.tokens)}` : "";
    console.log("");
    console.log(`${formatIsoTime(message.at)} assistant${message.model ? `  ${shortModel(message.model)}` : ""}${tokenText}`);
    if (message.thinking) {
      console.log(indent("[thinking]"));
      console.log(indent(message.thinking, 4));
      console.log("");
    }
    console.log(indent(message.text || "(no text captured)"));
    if (message.toolCalls.length) {
      console.log("");
      console.log("  tools:");
      for (const [index, tool] of message.toolCalls.entries()) {
        const target = tool.targetPaths.length ? `  ${tool.targetPaths.slice(0, 3).join(", ")}` : "";
        console.log(`    ${index + 1}. ${tool.name}  ${tool.result?.status || "unknown"}${target}`);
        if (tool.plan) {
          console.log(indent("plan:", 6));
          console.log(indent(tool.plan, 8));
        }
      }
    }
  }
}

/** Prints turn list rows to stdout with time, provider, status, and title preview. */
export function printTurnRows(rows: TurnListItem[]): void {
  for (const row of rows) {
    console.log(`${formatTime(row.lastActivityAt)}  ${row.provider}  ${row.status.padEnd(9)}  ${row.sourceKey}  ${preview(row.titlePreview || "", 80)}`);
  }
}

/** Prints conversation list rows to stdout with time, provider, short id, and first prompt preview. */
export function printConversationRows(rows: ConversationListItem[]): void {
  for (const row of rows) {
    console.log(`${formatTime(row.startedAt || row.endedAt)}  ${row.provider}  ${shortConversationId(row)}  ${preview(row.firstPrompt || row.title || "", 80)}`);
  }
}

/** Extracts the `data` field from an object if present, otherwise returns the value as-is. */
export function queryData(value: unknown): unknown {
  return value && typeof value === "object" && "data" in value ? (value as { data?: unknown }).data : value;
}

/** Returns whether the array contains visible message rows by checking for role and conversationId fields. */
export function isVisibleMessageArray(value: unknown[]): value is VisibleMessage[] {
  return value.some((row) => Boolean(row && typeof row === "object" && "role" in row && "conversationId" in row));
}

/** Returns whether the array contains tool call rows by checking for a toolName field. */
export function isToolArray(value: unknown[]): value is ToolCallWithResult[] {
  return value.some((row) => Boolean(row && typeof row === "object" && "toolName" in row));
}

/** Returns whether the array contains turn list rows by checking for sourceKey and stats fields. */
export function isTurnArray(value: unknown[]): value is TurnListItem[] {
  return value.some((row) => Boolean(row && typeof row === "object" && "sourceKey" in row && "stats" in row));
}

/** Returns whether the array contains conversation list rows by checking for providerSessionId and confidence fields. */
export function isConversationArray(value: unknown[]): value is ConversationListItem[] {
  return value.some((row) => Boolean(row && typeof row === "object" && "providerSessionId" in row && "confidence" in row));
}

/** Returns a short provider-prefixed conversation identifier using the first 8 chars of the session id. */
export function shortConversationId(row: ConversationListItem): string {
  const session = row.providerSessionId || row.id.split(":").slice(1).join(":");
  return `${row.provider}:${session.slice(0, 8)}`;
}

/** Formats a Date as HH:MM, returning "--:--" when undefined. */
export function formatTime(date: Date | undefined): string {
  if (!date) return "--:--";
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Formats an ISO timestamp string as HH:MM, returning "--:--" when undefined or invalid. */
function formatIsoTime(value: string | undefined): string {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return formatTime(date);
}

/** Formats a Date as a "YYYY-MM-DD HH:MM" string, or "(unknown)" when undefined. */
export function formatDateTime(date: Date | undefined): string {
  return date ? `${formatDatePart(date)} ${formatTime(date)}` : "(unknown)";
}

/** Formats a Date as a zero-padded YYYY-MM-DD string. */
export function formatDatePart(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Formats the elapsed time between two dates as "Xm" or "XhYY", returning "--" when either is undefined. */
export function formatDuration(start: Date | undefined, end: Date | undefined): string {
  if (!start || !end) return "--";
  const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
}

/** Returns a double-quoted preview of the value, truncated to max characters. */
export function quotePreview(value: string, max: number): string {
  return `"${preview(value, max)}"`;
}

/** Returns a whitespace-compacted preview of the value, truncating with "..." when it exceeds max characters. */
export function preview(value: string, max: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 3)}...` : compact;
}

/** Returns a named field from an object value, or undefined if the value is not an object. */
export function objectField(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

/** Returns a named field from an object as a string, or undefined if missing or not a string. */
export function stringField(value: unknown, key: string): string | undefined {
  const field = objectField(value, key);
  return typeof field === "string" ? field : undefined;
}

/** Returns a named field from an object as a number, or undefined if missing or not a number. */
export function numberField(value: unknown, key: string): number | undefined {
  const field = objectField(value, key);
  return typeof field === "number" ? field : undefined;
}

/** Merges consecutive messages with the same role and id, concatenating streamed text fragments. */
function coalesceMessages(rows: VisibleMessage[]): VisibleMessage[] {
  const result: VisibleMessage[] = [];
  for (const row of rows) {
    const previous = result.at(-1);
    if (previous && previous.role === row.role && previous.id === row.id && row.text && !row.textPreview) {
      previous.text = `${previous.text || ""}${row.text}`;
      continue;
    }
    result.push({ ...row });
  }
  return result;
}

/** Formats a token usage breakdown as a space-separated "label=value" string. */
function formatTokens(tokens: TokenUsage): string {
  return [
    tokenPart("input", tokens.input),
    tokenPart("output", tokens.output),
    tokenPart("cache_read", tokens.cacheRead),
    tokenPart("cache_creation", tokens.cacheCreation)
  ].filter(Boolean).join(" ");
}

/** Returns a "label=value" token string for one usage category, or undefined if the value is absent. */
function tokenPart(label: string, value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${label}=${formatTokenNumber(value)}`;
}

/** Formats a token count with a "k" suffix for values >= 1000. */
function formatTokenNumber(value: number): string {
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

/** Returns a shortened model name with provider prefix and trailing date suffix stripped. */
function shortModel(model: string): string {
  return model
    .replace(/^claude-/, "")
    .replace(/^gpt-/, "")
    .replace(/-\d{8}$/, "");
}

/** Indents each line of a string by the given number of spaces (default 2). */
function indent(value: string, width = 2): string {
  const pad = " ".repeat(width);
  return value.split(/\r?\n/).map((line) => `${pad}${line}`).join("\n");
}

/** Left-pads a number to two digits with a leading zero. */
function pad(value: number): string {
  return String(value).padStart(2, "0");
}
