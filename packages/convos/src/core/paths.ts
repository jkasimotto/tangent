import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

import type { ConvosProvider } from "./schema/convos-jsonl-v1.js";

export function convosHome(): string {
  return process.env.CONVOS_HOME || path.join(homedir(), ".convos");
}

export function globalConfigPath(): string {
  return path.join(convosHome(), "config.json");
}

export function repoHash(repoRoot: string): string {
  return createHash("sha256").update(path.resolve(repoRoot)).digest("hex").slice(0, 16);
}

export function repoEventDir(repoRoot: string, provider: ConvosProvider): string {
  return path.join(convosHome(), "repos", repoHash(repoRoot), "events", provider);
}

export function repoRawDir(repoRoot: string, provider: ConvosProvider): string {
  return path.join(convosHome(), "repos", repoHash(repoRoot), "raw", provider);
}

export function repoIndexPath(repoRoot: string): string {
  return path.join(convosHome(), "repos", repoHash(repoRoot), "index", "convos.sqlite");
}

export function globalEventDir(provider: ConvosProvider, date = new Date()): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return path.join(convosHome(), "events", provider, yyyy, mm);
}

export function eventFileForConversation(repoRoot: string | undefined, provider: ConvosProvider, conversationId: string): string {
  const safeId = conversationId.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  if (repoRoot) return path.join(repoEventDir(repoRoot, provider), `${safeId}.jsonl`);
  return path.join(globalEventDir(provider), `${safeId}.jsonl`);
}

export function rawHookFileForSession(repoRoot: string | undefined, provider: ConvosProvider, sessionId: string, date = new Date()): string {
  const safeId = sessionId.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  if (repoRoot) return path.join(repoRawDir(repoRoot, provider), `${safeId}.jsonl`);
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return path.join(convosHome(), "raw", provider, yyyy, mm, `${safeId}.jsonl`);
}

export function repoLocalConvosDir(repoRoot: string, provider: ConvosProvider): string {
  return path.join(repoRoot, ".convos", "events", provider);
}
