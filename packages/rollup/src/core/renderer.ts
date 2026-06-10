import type { RollupConfig } from "../types/config.js";
import type { RollupNote } from "../types/rollup-note.js";
import type { TopicRollup } from "../types/digest.js";
import { timestampLabel } from "./time.js";

export function renderRollupNote(note: RollupNote, config: RollupConfig): string {
  const lines: string[] = [];
  lines.push(`Generated: ${timestampLabel(note.generatedAt, note.timezone)}`);
  lines.push(`Sources: ${note.source.turnKeys.length} turns${sourceProviders(note)}`);
  lines.push("");

  if (!note.topics.length) {
    lines.push("No turns have been processed for this period yet.", "");
  } else {
    for (const topic of note.topics) renderTopic(lines, topic);
  }

  if (config.note.includeMetrics && note.metrics) renderMetrics(lines, note);
  if (note.sourceCaveats.length) renderList(lines, "Source caveats", note.sourceCaveats);

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

function renderTopic(lines: string[], topic: TopicRollup): void {
  lines.push(`## ${topic.title}`);
  lines.push(`_Source: ${topic.sourceTurnKeys.length} turns${topic.timeSpentMs ? `, ${durationLabel(topic.timeSpentMs)} active agent wall time` : ""}_`);
  lines.push("");
  lines.push(topic.narrativeMarkdown || topic.summary);
  lines.push("");

  for (const section of topic.sections) {
    if (!section.markdown.trim()) continue;
    lines.push(`### ${section.heading}`);
    lines.push("");
    lines.push(section.markdown.trim());
    lines.push("");
  }

  renderList(lines, "Decisions", topic.decisions);
  renderList(lines, "Experiments", topic.experiments);
  renderList(lines, "Open questions", topic.openQuestions);
  renderList(lines, "Follow-ups", topic.followUps);
}

function renderMetrics(lines: string[], note: RollupNote): void {
  if (!note.metrics) return;
  renderList(lines, "Metrics", [
    `${note.metrics.turns} turns`,
    `${note.metrics.topics} topics`,
    note.metrics.activeAgentWallTimeMs ? `${durationLabel(note.metrics.activeAgentWallTimeMs)} active agent wall time` : undefined
  ].filter((item): item is string => Boolean(item)));
}

function renderList(lines: string[], title: string, items: string[]): void {
  const clean = items.filter(Boolean);
  if (!clean.length) return;
  lines.push(`### ${title}`);
  lines.push("");
  for (const item of clean) lines.push(`- ${item}`);
  lines.push("");
}

function sourceProviders(note: RollupNote): string {
  return note.source.providers.length ? `, ${note.source.providers.map((provider) => provider === "claude" ? "Claude" : "Codex").join(" + ")}` : "";
}

function durationLabel(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}
