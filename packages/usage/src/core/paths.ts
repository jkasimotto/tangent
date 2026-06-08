import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

import type { UsageProvider } from "./schema/usage-jsonl-v1.js";

export function usageHome(): string {
  return process.env.USAGE_HOME || path.join(homedir(), ".tangent", "usage");
}

export function globalConfigPath(): string {
  return path.join(usageHome(), "config.json");
}

export function repoHash(repoRoot: string): string {
  return createHash("sha256").update(path.resolve(repoRoot)).digest("hex").slice(0, 16);
}

export function repoEventDir(repoRoot: string, provider: UsageProvider): string {
  return path.join(usageHome(), "repos", repoHash(repoRoot), "events", provider);
}

export function repoRawDir(repoRoot: string, provider: UsageProvider): string {
  return path.join(usageHome(), "repos", repoHash(repoRoot), "raw", provider);
}

export function repoIndexPath(repoRoot: string): string {
  return path.join(usageHome(), "repos", repoHash(repoRoot), "index", "usage.sqlite");
}

export function repoArchiveDir(repoRoot: string): string {
  return path.join(usageHome(), "repos", repoHash(repoRoot), "archive");
}

export function globalEventDir(provider: UsageProvider, date = new Date()): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return path.join(usageHome(), "events", provider, yyyy, mm);
}

export function eventFileForConversation(repoRoot: string | undefined, provider: UsageProvider, conversationId: string): string {
  const safeId = conversationId.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  if (repoRoot) return path.join(repoEventDir(repoRoot, provider), `${safeId}.jsonl`);
  return path.join(globalEventDir(provider), `${safeId}.jsonl`);
}

export function rawHookFileForSession(repoRoot: string | undefined, provider: UsageProvider, sessionId: string, date = new Date()): string {
  const safeId = sessionId.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  if (repoRoot) return path.join(repoRawDir(repoRoot, provider), `${safeId}.jsonl`);
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return path.join(usageHome(), "raw", provider, yyyy, mm, `${safeId}.jsonl`);
}

export function repoLocalUsageDir(repoRoot: string, provider: UsageProvider): string {
  return path.join(repoRoot, ".tangent", "usage", "events", provider);
}
