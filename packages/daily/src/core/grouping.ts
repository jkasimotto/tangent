import type { DailyConfig } from "../types/config.js";
import type { SessionDigest } from "../types/digest.js";
import type { WorkSession } from "../types/daily-note.js";
import type { DailyRepoInfo } from "./repo.js";

export function groupWorkSessions(args: {
  digests: SessionDigest[];
  repo: DailyRepoInfo;
  date: string;
  config: DailyConfig;
}): WorkSession[] {
  const sorted = [...args.digests].sort((a, b) => dateSortKey(a).localeCompare(dateSortKey(b)));
  const sessions: WorkSession[] = [];
  for (const digest of sorted) {
    const prior = sessions.at(-1);
    if (!prior || !shouldMerge(prior, digest, args.config)) {
      sessions.push(newSession(args.repo.id, args.date, digest));
      continue;
    }
    prior.digests.push(digest);
    prior.conversationIds.push(digest.conversation.id);
    prior.providers = [...new Set([...prior.providers, digest.conversation.provider])];
    prior.endedAt = maxIso(prior.endedAt, digest.conversation.endedAt || digest.conversation.startedAt);
    prior.title = sessionTitle(prior.digests);
  }
  return sessions;
}

function newSession(repoId: string, date: string, digest: SessionDigest): WorkSession {
  return {
    id: `${date}-${digest.conversation.id.replace(/[^a-zA-Z0-9]+/g, "-")}`,
    repoId,
    date,
    startedAt: digest.conversation.startedAt,
    endedAt: digest.conversation.endedAt || digest.conversation.startedAt,
    conversationIds: [digest.conversation.id],
    providers: [digest.conversation.provider],
    title: digest.headline || digest.conversation.title,
    digests: [digest]
  };
}

function shouldMerge(session: WorkSession, digest: SessionDigest, config: DailyConfig): boolean {
  if (config.processing.grouping === "conversation") return false;
  const priorEnd = session.endedAt || session.startedAt;
  const nextStart = digest.conversation.startedAt || digest.conversation.endedAt;
  if (!priorEnd || !nextStart) return false;
  const gapMs = new Date(nextStart).getTime() - new Date(priorEnd).getTime();
  if (gapMs < 0) return true;
  if (gapMs > config.processing.workSessionIdleGapMinutes * 60 * 1000) return false;
  if (config.processing.grouping === "idle-gap") return true;
  return branchOrPathOverlap(session.digests, digest);
}

function branchOrPathOverlap(existing: SessionDigest[], next: SessionDigest): boolean {
  const branches = new Set(existing.map((digest) => digest.conversation.branch).filter(Boolean));
  if (next.conversation.branch && branches.has(next.conversation.branch)) return true;
  const existingPaths = new Set(existing.flatMap(pathsForDigest));
  return pathsForDigest(next).some((filePath) => existingPaths.has(filePath) || hasSharedTopLevel(filePath, existingPaths));
}

function pathsForDigest(digest: SessionDigest): string[] {
  return [
    ...digest.workDone.flatMap((entry) => entry.files || []),
    ...digest.decisions.flatMap((entry) => entry.evidence.map((evidence) => evidence.file).filter(Boolean) as string[]),
    ...digest.followUps.flatMap((entry) => entry.evidence.map((evidence) => evidence.file).filter(Boolean) as string[])
  ];
}

function hasSharedTopLevel(filePath: string, existingPaths: Set<string>): boolean {
  const top = filePath.split("/")[0];
  if (!top) return false;
  return [...existingPaths].some((existing) => existing.split("/")[0] === top);
}

function sessionTitle(digests: SessionDigest[]): string {
  if (digests.length === 1) return digests[0]!.headline;
  return digests[0]!.headline || digests.map((digest) => digest.conversation.title).join(" / ");
}

function dateSortKey(digest: SessionDigest): string {
  return digest.conversation.startedAt || digest.conversation.endedAt || digest.conversation.id;
}

function maxIso(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return new Date(left) > new Date(right) ? left : right;
}
