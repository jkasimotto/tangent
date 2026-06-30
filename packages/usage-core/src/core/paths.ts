import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

import type { UsageProvider } from "./schema/usage-jsonl-v1.js";

/** Returns the root directory for all tangent usage data, from env or ~/.tangent/usage. */
export function usageHome(): string {
  return process.env.USAGE_HOME || path.join(homedir(), ".tangent", "usage");
}

/** Returns the path to the global usage configuration file. */
export function globalConfigPath(): string {
  return path.join(usageHome(), "config.json");
}

/** Returns a short SHA-256 hash of the resolved repo root path for use as a stable directory key. */
export function repoHash(repoRoot: string): string {
  return createHash("sha256").update(path.resolve(repoRoot)).digest("hex").slice(0, 16);
}

/** Returns the per-repo per-provider directory where raw usage event JSONL files are stored. */
export function repoEventDir(repoRoot: string, provider: UsageProvider): string {
  return path.join(usageHome(), "repos", repoHash(repoRoot), "events", provider);
}

/** Returns the path to the SQLite index file for a repo. */
export function repoIndexPath(repoRoot: string): string {
  return path.join(usageHome(), "repos", repoHash(repoRoot), "index", "usage.sqlite");
}

/** Returns the path to the global SQLite index file. */
export function globalIndexPath(): string {
  return path.join(usageHome(), "global", "index", "usage.sqlite");
}

/** Returns the archive directory for a repo's usage data. */
export function repoArchiveDir(repoRoot: string): string {
  return path.join(usageHome(), "repos", repoHash(repoRoot), "archive");
}

/** Returns the global per-provider event directory for the given month (defaults to current UTC month). */
export function globalEventDir(provider: UsageProvider, date = new Date()): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return path.join(usageHome(), "events", provider, yyyy, mm);
}

/** Returns the root directory for all global events for a provider. */
export function globalEventRoot(provider: UsageProvider): string {
  return path.join(usageHome(), "events", provider);
}

/** Returns the JSONL file path for a conversation's events, scoped to repo or global storage. */
export function eventFileForConversation(repoRoot: string | undefined, provider: UsageProvider, conversationId: string): string {
  const safeId = conversationId.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  if (repoRoot) return path.join(repoEventDir(repoRoot, provider), `${safeId}.jsonl`);
  return path.join(globalEventDir(provider), `${safeId}.jsonl`);
}

/** Returns the local in-repo usage events directory for a provider. */
export function repoLocalUsageDir(repoRoot: string, provider: UsageProvider): string {
  return path.join(repoRoot, ".tangent", "usage", "events", provider);
}
