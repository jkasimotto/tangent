import type { DailyConfig } from "../types/config.js";
import type { DailyNote, WorkSession } from "../types/daily-note.js";
import type { SessionDigest } from "../types/digest.js";
import { timeLabel, timestampLabel } from "./time.js";

export function renderDailyNote(note: DailyNote, config: DailyConfig): string {
  const lines: string[] = [];
  const title = config.note.titleTemplate
    .replaceAll("{{repo}}", note.repo.name)
    .replaceAll("{{date}}", note.date);

  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`Generated: ${timestampLabel(note.generatedAt, note.timezone)}`);
  lines.push(`Repo: \`${note.repo.name}\``);
  lines.push(`Sources: ${note.source.conversationIds.length} conversations${sourceProviders(note)}`);
  lines.push("");

  if (config.note.includeStandupSnippet) renderStandup(lines, note);
  renderDaySummary(lines, note);
  renderWorkSessions(lines, note.workSessions, note.timezone);
  renderDigestList(lines, "Decisions", note.decisions.map((entry) => entry.decision));
  renderDigestList(lines, "Experiments", note.experiments.map((entry) => `${entry.questionOrHypothesis}: ${entry.outcome}`));
  if (config.note.includeDesignSeeds) renderDesignSeeds(lines, note);
  if (config.note.includeFollowUps) renderDigestList(lines, "Follow-ups", note.followUps.map((entry) => entry.task));
  renderDigestList(lines, "Risks", note.risks.map((entry) => entry.risk));
  if (config.note.includeMetrics && note.metrics) renderMetrics(lines, note);
  if (note.sourceCaveats.length) renderDigestList(lines, "Source caveats", note.sourceCaveats);

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

function renderStandup(lines: string[], note: DailyNote): void {
  lines.push("## Standup snippet", "");
  renderSubList(lines, "Done", note.standup.done);
  renderSubList(lines, "Next", note.standup.next);
  renderSubList(lines, "Blockers", note.standup.blockers.length ? note.standup.blockers : ["None captured."]);
  lines.push("");
}

function renderDaySummary(lines: string[], note: DailyNote): void {
  lines.push("## Day summary", "");
  lines.push(note.daySummary.short || "No high-signal summary captured yet.");
  if (note.daySummary.themes.length) {
    lines.push("");
    renderBullets(lines, note.daySummary.themes);
  }
  lines.push("");
}

function renderWorkSessions(lines: string[], sessions: WorkSession[], timezone: string): void {
  lines.push("## Work sessions", "");
  if (!sessions.length) {
    lines.push("No processed conversations for this day.", "");
    return;
  }

  for (const session of sessions) {
    const start = timeLabel(session.startedAt, timezone);
    const end = timeLabel(session.endedAt, timezone);
    const prefix = start && end ? `${start}-${end}` : start || end || "Time unknown";
    lines.push(`### ${prefix} - ${session.title}`);
    lines.push("");
    for (const digest of session.digests) renderSessionDigest(lines, digest);
  }
}

function renderSessionDigest(lines: string[], digest: SessionDigest): void {
  lines.push("**High-signal summary**  ");
  lines.push(digest.summary.short || digest.headline);
  lines.push("");
  renderDigestList(lines, "Work done", digest.workDone.map((entry) => withFiles(entry.text, entry.files)));
  renderDigestList(lines, "Decisions", digest.decisions.map((entry) => entry.decision));
  renderDigestList(lines, "Experiments", digest.experiments.map((entry) => `${entry.questionOrHypothesis}: ${entry.outcome}`));
  renderDigestList(lines, "Design seeds", digest.designNotes.map((entry) => entry.title));
  renderDigestList(lines, "Follow-ups", digest.followUps.map((entry) => entry.task));
}

function renderDesignSeeds(lines: string[], note: DailyNote): void {
  if (!note.designSeeds.length) return;
  lines.push("## Design seeds", "");
  for (const seed of note.designSeeds) {
    lines.push(`### ${seed.title}`);
    lines.push("");
    lines.push(seed.context);
    if (seed.proposal) {
      lines.push("");
      lines.push(`Proposal: ${seed.proposal}`);
    }
    if (seed.tradeoffs?.length) renderDigestList(lines, "Tradeoffs", seed.tradeoffs);
    if (seed.openQuestions?.length) renderDigestList(lines, "Open questions", seed.openQuestions);
    lines.push("");
  }
}

function renderMetrics(lines: string[], note: DailyNote): void {
  if (!note.metrics) return;
  lines.push("## Metrics", "");
  renderBullets(lines, [
    `${note.metrics.conversations} conversations`,
    `${note.metrics.toolCalls} tool calls`,
    `${note.metrics.filesRead} files read`,
    `${note.metrics.filesWritten} files written`,
    `${note.metrics.testsRun} test commands`,
    `${note.metrics.testFailures} test failures`,
    note.metrics.tokensTotal ? `${note.metrics.tokensTotal} tokens` : undefined
  ].filter((item): item is string => Boolean(item)));
  lines.push("");
}

function renderSubList(lines: string[], title: string, items: string[]): void {
  lines.push(`**${title}**`);
  renderBullets(lines, items);
  lines.push("");
}

function renderDigestList(lines: string[], title: string, items: string[]): void {
  const clean = items.filter(Boolean);
  if (!clean.length) return;
  lines.push(`**${title}**`);
  renderBullets(lines, clean);
  lines.push("");
}

function renderBullets(lines: string[], items: string[]): void {
  for (const item of items) lines.push(`- ${item}`);
}

function withFiles(text: string, files: string[] | undefined): string {
  return files?.length ? `${text} (${files.map((file) => `\`${file}\``).join(", ")})` : text;
}

function sourceProviders(note: DailyNote): string {
  const providers = [...new Set(note.workSessions.flatMap((session) => session.providers))];
  return providers.length ? `, ${providers.map((provider) => provider === "claude" ? "Claude" : "Codex").join(" + ")}` : "";
}
