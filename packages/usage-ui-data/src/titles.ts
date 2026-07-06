/**
 * Title sanitization for every Usage UI surface that shows a conversation's title: the browse
 * gallery cards, the project rail, the conversation header, timeline segment cards, and the
 * browser tab title. Claude Code writes raw command-XML into a conversation's title (and its
 * first message, which several call sites use as a title fallback) for slash-command turns, e.g.
 * `<command-name>/model</command-name>\n<command-message>model</command-message>` or
 * `<local-command-stdout>Cleared context</local-command-stdout>`, and injects raw
 * `<task-notification>` payloads as user messages when background tasks complete. Left
 * unsanitized, this markup leaks verbatim into the UI. This module strips it and, where a title
 * candidate is entirely machine markup, derives a human label from a later non-command candidate,
 * the bare command name, or the notification's own summary.
 */

const COMMAND_NAME_RE = /<command-name>([\s\S]*?)<\/command-name>/i;
const COMMAND_MARKUP_RE = /<command-name>[\s\S]*?<\/command-name>|<command-message>[\s\S]*?<\/command-message>|<command-args>[\s\S]*?<\/command-args>|<local-command-stdout>[\s\S]*?<\/local-command-stdout>/gi;
// A background-task completion notification Claude injects as a user message. Matched at the
// start of the text; title candidates are often previews truncated mid-payload, so all inner
// close tags are treated as optional below.
const TASK_NOTIFICATION_RE = /^\s*<task-notification>/i;
const TASK_SUMMARY_RE = /<summary>([\s\S]*?)(?:<\/summary>|$)/i;
const TASK_STATUS_RE = /<status>([\s\S]*?)(?:<\/status>|$)/i;

/** Returns whether text is (or contains) raw command-XML markup, e.g. a slash command's synthesized user message. */
export function isCommandXml(value: string | undefined): boolean {
  return Boolean(value && COMMAND_NAME_RE.test(value));
}

/** Returns whether text is a raw background-task notification payload (`<task-notification>...`). */
export function isTaskNotificationXml(value: string | undefined): boolean {
  return Boolean(value && TASK_NOTIFICATION_RE.test(value));
}

/**
 * Derives a human label from a task-notification payload: the notification's own `<summary>` text
 * when present (the only part of the payload written for humans), otherwise a generic
 * "Task <status>" / "Task notification" label. Never returns the raw tag soup.
 */
export function taskNotificationLabel(value: string): string {
  const summary = TASK_SUMMARY_RE.exec(value)?.[1]?.trim();
  if (summary) return summary;
  const status = TASK_STATUS_RE.exec(value)?.[1]?.replace(/<[^>]*$/, "").trim();
  return status ? `Task ${status}` : "Task notification";
}

/** Extracts the bare command name (e.g. "/model") from command-XML text, or undefined when no `<command-name>` tag is present. */
export function extractCommandName(value: string | undefined): string | undefined {
  const match = value ? COMMAND_NAME_RE.exec(value) : null;
  const name = match?.[1]?.trim();
  return name || undefined;
}

/**
 * Removes command-XML tag blocks (`<command-name>`, `<command-message>`, `<command-args>`,
 * `<local-command-stdout>`, tags and their content) from text, collapsing the remaining
 * whitespace. Safe to call on any string; a no-op when no markup is present.
 */
export function stripCommandMarkup(value: string): string {
  return value.replace(COMMAND_MARKUP_RE, " ").replace(/\s+/g, " ").trim();
}

/** Returns whether a candidate is machine markup a human would not recognize as a title. */
function isMachineMarkup(value: string): boolean {
  return isCommandXml(value) || isTaskNotificationXml(value);
}

/** Derives the best human label from a machine-markup candidate: the task summary for notifications, the bare "<command> session" form for command XML. */
function machineMarkupLabel(value: string): string {
  if (isTaskNotificationXml(value)) return taskNotificationLabel(value);
  return `${extractCommandName(value) || "command"} session`;
}

/**
 * Derives a human display title from an ordered list of title candidates (most-preferred first,
 * e.g. `[session.title, session.firstPrompt]`). When the leading non-empty candidate is machine
 * markup (command XML or a task notification), that text is a machine channel, not a title a
 * human recognizes, so this looks for the first later candidate that is not itself markup and
 * uses that instead; failing that, it falls back to a derived label ("/model session", the task
 * summary) rather than showing the tag soup. When the leading candidate is ordinary text, it is
 * returned with any incidental command markup stripped.
 */
export function deriveDisplayTitle(candidates: Array<string | undefined>, fallback = "Untitled session"): string {
  const trimmed = candidates.map((candidate) => (candidate || "").trim());
  const primary = trimmed.find((candidate) => candidate.length > 0);
  if (!primary) return fallback;
  if (!isMachineMarkup(primary)) return stripCommandMarkup(primary) || fallback;
  const nonMarkup = trimmed.find((candidate) => candidate && candidate !== primary && !isMachineMarkup(candidate));
  if (nonMarkup) return stripCommandMarkup(nonMarkup) || machineMarkupLabel(primary);
  return machineMarkupLabel(primary);
}
