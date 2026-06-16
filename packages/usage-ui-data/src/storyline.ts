import { formatDuration, formatTokens, messageTokens, stepDuration, stepTokens, truncateText, uniquePaths } from "./format.js";
import type { UsageActionModel, UsageMessage, UsageSession, UsageStep, UsageStoryChapter, UsageStorylineView } from "./types.js";

type ChapterBucket = {
  id: UsageStoryChapter["id"];
  title: string;
  dominantKind: UsageStoryChapter["dominantKind"];
  steps: UsageStep[];
  messages: UsageMessage[];
};

/** Builds the session storyline. */
export function buildSessionStoryline(session: UsageSession, steps: UsageStep[], messages: UsageMessage[]): UsageStorylineView {
  const buckets = chapterBuckets();
  for (const message of messages) {
    const bucket = bucketForMessage(message, steps);
    buckets.get(bucket)?.messages.push(message);
  }
  for (const step of steps) {
    const bucket = bucketForStep(step);
    buckets.get(bucket)?.steps.push(step);
  }

  const chapters = [...buckets.values()]
    .filter((bucket) => bucket.steps.length || bucket.messages.length)
    .map((bucket) => chapterFromBucket(session, bucket));

  if (!chapters.length) {
    chapters.push({
      id: "unknown",
      title: "Session activity",
      summary: "No structured steps or messages were available for this session.",
      status: session.status === "active" ? "active" : "unknown",
      dominantKind: "unknown",
      steps: [],
      actions: [{ id: "inspect-evidence", label: "Inspect evidence", href: evidenceHref(session.id) }]
    });
  }

  return { chapters };
}

/** Builds storyline buckets. */
function chapterBuckets(): Map<UsageStoryChapter["id"], ChapterBucket> {
  const entries: ChapterBucket[] = [
    { id: "prompt-setup", title: "Prompt & setup", dominantKind: "prompt", steps: [], messages: [] },
    { id: "planning", title: "Planning", dominantKind: "planning", steps: [], messages: [] },
    { id: "repo-inspection", title: "Repo inspection", dominantKind: "tooling", steps: [], messages: [] },
    { id: "implementation", title: "Implementation", dominantKind: "editing", steps: [], messages: [] },
    { id: "validation", title: "Validation", dominantKind: "validation", steps: [], messages: [] },
    { id: "finalization", title: "Response & finalization", dominantKind: "summary", steps: [], messages: [] },
    { id: "errors", title: "Errors", dominantKind: "error", steps: [], messages: [] }
  ];
  return new Map(entries.map((entry) => [entry.id, entry]));
}

/** Supports the bucket for message helper. */
function bucketForMessage(message: UsageMessage, steps: UsageStep[]): UsageStoryChapter["id"] {
  if (message.role === "user") return "prompt-setup";
  if (message.role === "tool") return "repo-inspection";
  if (message.role === "assistant" && isPlanningText(message.text || message.textPreview)) return "planning";
  if (message.role === "assistant" && isLatestAssistant(message, steps)) return "finalization";
  return message.role === "assistant" ? "finalization" : "prompt-setup";
}

/** Supports the bucket for step helper. */
function bucketForStep(step: UsageStep): UsageStoryChapter["id"] {
  const kind = step.kind || "unknown";
  const label = `${step.label || ""} ${step.toolName || ""}`.toLowerCase();
  if (step.status === "error" || kind === "error") return "errors";
  if (kind === "user_message" || kind === "session" || kind === "turn") return "prompt-setup";
  if (kind === "assistant_response" || kind === "model_call") return isPlanningText(step.label) ? "planning" : "finalization";
  if (kind === "file_write" || /apply_patch|write|edit|create|update|delete/.test(label)) return "implementation";
  if (/test|check|lint|typecheck|build|vitest|tsc|governance/.test(label)) return "validation";
  if (kind === "file_read" || kind === "file_search" || kind === "tool_call" || kind === "tool_result" || kind === "command") return "repo-inspection";
  if (kind === "permission" || kind === "compaction" || kind === "subagent") return "repo-inspection";
  return "finalization";
}

/** Builds storyline from bucket. */
function chapterFromBucket(session: UsageSession, bucket: ChapterBucket): UsageStoryChapter {
  const allTimes = [...bucket.steps.map((step) => step.startedAt), ...bucket.messages.map((message) => message.createdAt || message.at)].filter(Boolean).sort() as string[];
  const endTimes = [...bucket.steps.map((step) => step.endedAt || step.startedAt), ...bucket.messages.map((message) => message.createdAt || message.at)].filter(Boolean).sort() as string[];
  const duration = bucket.steps.reduce((sum, step) => sum + (stepDuration(step) || 0), 0);
  const tokens = bucket.steps.reduce((sum, step) => sum + (stepTokens(step) || 0), 0) + bucket.messages.reduce((sum, message) => sum + (messageTokens(message) || 0), 0);
  const toolCallCount = bucket.steps.filter((step) => step.kind === "tool_call" || step.kind === "tool_result" || step.kind === "command").length;
  const fileCount = uniquePaths(bucket.steps).length;
  const failed = bucket.steps.some((step) => step.status === "error");
  const active = session.status === "active" && bucket.id === "finalization";
  const labels = bucket.steps
    .map((step) => truncateText(step.label || step.toolName || step.kind, 82))
    .filter(Boolean)
    .slice(0, 5);
  const messageSteps = bucket.messages
    .map((message) => truncateText(message.textPreview || message.text, 82))
    .filter(Boolean)
    .slice(0, Math.max(0, 5 - labels.length));

  return {
    id: bucket.id,
    title: bucket.title,
    summary: chapterSummary(bucket),
    startedAt: allTimes[0],
    endedAt: endTimes.at(-1),
    durationLabel: duration ? formatDuration(duration) : undefined,
    tokenLabel: tokens ? formatTokens(tokens) : undefined,
    toolCallCount: toolCallCount || undefined,
    fileCount: fileCount || undefined,
    status: failed ? "failed" : active ? "active" : "complete",
    dominantKind: bucket.dominantKind,
    steps: [...labels, ...messageSteps],
    actions: chapterActions(session.id, bucket.id)
  };
}

/** Builds storyline summary. */
function chapterSummary(bucket: ChapterBucket): string {
  const message = bucket.messages.find((item) => item.textPreview || item.text);
  if (bucket.id === "prompt-setup") {
    return message ? `User asked: ${truncateText(message.textPreview || message.text, 150)}` : "Session context and initial prompt were captured.";
  }
  if (bucket.id === "planning") return "Assistant established the approach, constraints, and work plan before changing the system.";
  if (bucket.id === "repo-inspection") return `Agent inspected repository state, files, commands, and available evidence across ${bucket.steps.length} recorded steps.`;
  if (bucket.id === "implementation") return "Agent edited or generated implementation artifacts for the selected session.";
  if (bucket.id === "validation") return "Agent ran validation commands or checks to confirm behavior.";
  if (bucket.id === "errors") return "One or more steps reported an error or failed status.";
  return message ? truncateText(message.textPreview || message.text, 180) : "Assistant summarized the result and next actions.";
}

/** Builds storyline actions. */
function chapterActions(sessionId: string, chapterId: string): UsageActionModel[] {
  return [
    { id: `${chapterId}-trace`, label: "Inspect trace", href: `/usage/sessions/${encodeURIComponent(sessionId)}/timeline` },
    { id: `${chapterId}-evidence`, label: "Inspect evidence", href: evidenceHref(sessionId) }
  ];
}

/** Supports the evidence href helper. */
function evidenceHref(sessionId: string): string {
  return `/usage/sessions/${encodeURIComponent(sessionId)}/evidence`;
}

/** Returns whether planning text. */
function isPlanningText(value: string | undefined): boolean {
  return /\b(plan|approach|proposal|architecture|design|first|next|phase|scope|migration)\b/i.test(value || "");
}

/** Returns whether latest assistant. */
function isLatestAssistant(message: UsageMessage, steps: UsageStep[]): boolean {
  const assistantMessages = steps.filter((step) => step.kind === "assistant_response");
  if (!assistantMessages.length) return true;
  return Boolean(message.createdAt || message.at);
}
