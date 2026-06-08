import type { TopicRollup, TurnDigest } from "../types/digest.js";

export type TopicGroup = {
  key: string;
  title: string;
  digests: TurnDigest[];
};

export function groupTurnDigests(digests: TurnDigest[]): TopicGroup[] {
  const groups = new Map<string, TopicGroup>();
  for (const digest of digests) {
    const hint = digest.topicHints[0] || fallbackHint(digest);
    const key = slug(hint.key || hint.title);
    const existingKey = findMergeKey(groups, key, digest);
    const group = groups.get(existingKey) || { key: existingKey, title: hint.title || titleFromKey(existingKey), digests: [] };
    group.digests.push(digest);
    groups.set(existingKey, group);
  }
  return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export function fallbackTopicRollup(date: string, group: TopicGroup): TopicRollup {
  const providers = unique(group.digests.map((digest) => digest.source.provider));
  const decisions = unique(group.digests.flatMap((digest) => digest.decisions.map((entry) => entry.decision)).filter(Boolean));
  const experiments = unique(group.digests.flatMap((digest) => digest.experiments.map((entry) => `${entry.question}: ${entry.outcome}`)).filter(Boolean));
  const openQuestions = unique(group.digests.flatMap((digest) => digest.designNotes.flatMap((entry) => entry.openQuestions || [])));
  const followUps = unique(group.digests.flatMap((digest) => digest.followUps));
  const summaries = group.digests.map((digest) => digest.summary || digest.headline).filter(Boolean);
  const narrativeMarkdown = summaries.map((summary) => `- ${summary}`).join("\n");
  return {
    schema: "daily.topic-rollup.v1",
    date,
    key: group.key,
    title: group.title,
    sourceTurnKeys: group.digests.map((digest) => digest.source.sourceKey),
    providers,
    timeSpentMs: sum(group.digests.map((digest) => digest.source.wallTimeMs)),
    summary: summaries[0] || group.title,
    narrativeMarkdown,
    sections: designSections(group.digests),
    decisions,
    experiments,
    openQuestions,
    followUps,
    evidence: group.digests.flatMap((digest) => digest.evidence.map((entry) => ({ ...entry, sourceKey: digest.source.sourceKey }))),
    caveats: unique(group.digests.flatMap((digest) => digest.quality.caveats))
  };
}

function fallbackHint(digest: TurnDigest): { key: string; title: string } {
  const file = digest.entities.files[0]?.split("/")[0];
  return {
    key: slug(file || digest.headline || "general"),
    title: titleFromKey(file || digest.headline || "General")
  };
}

function findMergeKey(groups: Map<string, TopicGroup>, key: string, digest: TurnDigest): string {
  if (groups.has(key)) return key;
  const nextFiles = new Set(digest.entities.files);
  for (const group of groups.values()) {
    const groupFiles = new Set(group.digests.flatMap((entry) => entry.entities.files));
    if ([...nextFiles].some((file) => groupFiles.has(file))) return group.key;
  }
  return key;
}

function designSections(digests: TurnDigest[]): TopicRollup["sections"] {
  return digests.flatMap((digest) => digest.designNotes.map((note) => ({
    heading: note.title,
    markdown: [
      note.context,
      ...(note.options || []).map((option) => `Option: ${option.name}\n${option.details}`),
      ...(note.openQuestions?.length ? [`Open questions:\n${note.openQuestions.map((item) => `- ${item}`).join("\n")}`] : [])
    ].filter(Boolean).join("\n\n")
  })));
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "general";
}

function titleFromKey(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))];
}

function sum(values: Array<number | undefined>): number | undefined {
  const total = values.reduce<number>((acc, value) => acc + (value || 0), 0);
  return total || undefined;
}
