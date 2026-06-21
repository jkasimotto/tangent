import { formatTokens, messageTokens, stepKindLabel, truncateText } from "./format.js";
import type { UsageMessage, UsageStep, UsageTranscriptHighlight, UsageTranscriptHighlightsView } from "./types.js";

/** Builds the transcript highlights. */
export function buildTranscriptHighlights(messages: UsageMessage[], steps: UsageStep[]): UsageTranscriptHighlightsView {
  const highlights: UsageTranscriptHighlight[] = [];
  const firstUser = messages.find((message) => message.role === "user");
  const firstAssistant = messages.find((message) => message.role === "assistant");
  const finalAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const expensiveAssistants = [...messages]
    .filter((message) => message.role === "assistant")
    .sort((left, right) => (messageTokens(right) || 0) - (messageTokens(left) || 0))
    .slice(0, 2);
  const toolClusters = buildToolClusters(steps).slice(0, 2);

  if (firstUser) highlights.push(messageHighlight(firstUser, "user-prompt", "User prompt"));
  if (firstAssistant) highlights.push(messageHighlight(firstAssistant, "assistant-plan", "Assistant plan"));
  for (const message of expensiveAssistants) {
    if (!highlights.some((highlight) => highlight.id === message.id)) {
      highlights.push(messageHighlight(message, "assistant-expensive", "High-token assistant response"));
    }
  }
  highlights.push(...toolClusters);
  if (finalAssistant && !highlights.some((highlight) => highlight.id === finalAssistant.id)) {
    highlights.push(messageHighlight(finalAssistant, "assistant-result", "Assistant result"));
  }
  const latest = [...messages].reverse().find((message) => message.textPreview || message.text);
  if (latest && !highlights.some((highlight) => highlight.id === latest.id)) {
    highlights.push(messageHighlight(latest, "latest", "Latest message"));
  }

  return {
    highlights: highlights.slice(0, 8),
    actions: [
      { id: "read-transcript", label: "Read transcript", href: "#transcript" },
      { id: "show-user-messages", label: "Show user messages", href: "#user-messages" },
      { id: "show-tool-calls", label: "Show tool calls", href: "#tool-calls" },
      { id: "create-rollup-selected", label: "Create rollup from selected", href: "#rollup-selected" }
    ]
  };
}

/** Supports the message highlight helper. */
function messageHighlight(message: UsageMessage, kind: UsageTranscriptHighlight["kind"], title: string): UsageTranscriptHighlight {
  const tokens = messageTokens(message);
  const role = message.role === "user" || message.role === "assistant" || message.role === "system" || message.role === "tool" ? message.role : undefined;
  return {
    id: message.id,
    kind,
    title,
    role,
    summary: summaryForMessage(message, kind),
    textPreview: truncateText(message.textPreview || message.text, 360),
    tokenLabel: formatTokens(tokens),
    toolCallCount: message.toolCalls?.length,
    inspectTarget: { kind: "message", id: message.id, label: title }
  };
}

/** Supports the summary for message helper. */
function summaryForMessage(message: UsageMessage, kind: UsageTranscriptHighlight["kind"]): string {
  if (kind === "user-prompt") return "Initial user request that framed the session.";
  if (kind === "assistant-plan") return "First assistant response that set direction.";
  if (kind === "assistant-expensive") return "Assistant response with high token weight.";
  if (kind === "assistant-result") return "Result or final visible answer from the assistant.";
  if (kind === "latest") return "Most recent visible message in the session.";
  return truncateText(message.textPreview || message.text, 180);
}

/** Builds the tool clusters. */
function buildToolClusters(steps: UsageStep[]): UsageTranscriptHighlight[] {
  const grouped = new Map<string, UsageStep[]>();
  for (const step of steps) {
    if (!isToolLike(step)) continue;
    const key = step.kind === "command" ? "command" : step.kind === "file_write" ? "file_write" : step.kind === "file_read" || step.kind === "file_search" ? "file_read" : "tool";
    grouped.set(key, [...(grouped.get(key) || []), step]);
  }
  return [...grouped.entries()]
    .sort((left, right) => right[1].length - left[1].length)
    .map(([kind, group]) => ({
      id: `tool-cluster:${kind}`,
      kind: "tool-cluster" as const,
      title: `${group.length} ${stepKindLabel(kind).toLowerCase()}`,
      role: "tool" as const,
      summary: clusterSummary(kind, group),
      textPreview: group.slice(0, 5).map((step) => step.label || step.toolName || step.kind).join(" | "),
      toolCallCount: group.length,
      inspectTarget: { kind: "tool" as const, id: `cluster:${kind}`, label: stepKindLabel(kind) }
    }));
}

/** Returns whether tool like. */
function isToolLike(step: UsageStep): boolean {
  return step.kind === "tool_call" || step.kind === "tool_result" || step.kind === "file_read" || step.kind === "file_search" || step.kind === "file_write" || step.kind === "command";
}

/** Supports the cluster summary helper. */
function clusterSummary(kind: string, group: UsageStep[]): string {
  const targets = [...new Set(group.flatMap((step) => step.targetPaths || []))].slice(0, 3);
  const prefix = kind === "file_write" ? "Edited" : kind === "file_read" ? "Read or searched" : kind === "command" ? "Ran commands against" : "Used tools against";
  return targets.length ? `${prefix}: ${targets.join(", ")}` : `${prefix} session context.`;
}
