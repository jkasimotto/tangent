// Resolves the Claude session a mark should anchor to. The primary path is "current session for a
// cwd": the same Claude Code process making the capture is running in the cwd the CLI is invoked
// from, so the newest transcript keyed to that cwd across every Claude profile is, in practice, the
// session that just misbehaved. `--session <id>` is the escape hatch for marking a different,
// already-identified session (e.g. an efficiency-lens exemplar found via `tangent usage insights`).
//
// Reuses `claudeHomes`/`discoverClaudeNative` re-exported from `@tangent/usage-index-sqlite` (backed
// by `@tangent/usage-providers`, which already fixed nested-cwd discovery in commit 3b0a824) rather
// than reimplementing profile enumeration or transcript-file discovery here.

import { stat } from "node:fs/promises";
import path from "node:path";

import { discoverClaudeNative } from "@tangent/usage-index-sqlite";

import type { MarkAnchor } from "./types.js";

/**
 * Resolves the anchor for the newest Claude transcript keyed to `cwd`, across every Claude profile.
 * Returns undefined when no transcript exists for this cwd yet (a brand-new session, or a cwd
 * Claude Code has never run in), so the caller can fall back to `--session` or fail with guidance.
 */
export async function resolveCurrentSessionAnchor(cwd: string): Promise<MarkAnchor | undefined> {
  const files = await discoverClaudeNative(cwd);
  if (!files.length) return undefined;
  return buildAnchor(await newestFile(files));
}

/**
 * Resolves the anchor for a specific session id, searching transcripts across every Claude profile
 * regardless of cwd, since an explicitly named session (e.g. a mined efficiency exemplar) may not
 * belong to the repo the mark is being captured from.
 */
export async function resolveAnchorForSession(sessionId: string): Promise<MarkAnchor | undefined> {
  const files = await discoverClaudeNative();
  const match = files.find((file) => path.basename(file, ".jsonl") === sessionId);
  return match ? buildAnchor(match) : undefined;
}

/** Resolves an anchor by cwd, or by an explicit session id when one is given. */
export async function resolveAnchor(cwd: string, sessionId?: string): Promise<MarkAnchor | undefined> {
  return sessionId ? resolveAnchorForSession(sessionId) : resolveCurrentSessionAnchor(cwd);
}

/**
 * Builds an anchor from a transcript file path. `ordinal` is left unset: filling it requires a
 * Usage index lookup, and the design specifies lazy resolution on first view rather than making
 * every mark capture depend on the session already being indexed.
 */
function buildAnchor(transcriptPath: string): MarkAnchor {
  const sessionId = path.basename(transcriptPath, ".jsonl");
  return {
    provider: "claude",
    sessionId,
    conversationId: `claude:${sessionId}`,
    transcriptPath
  };
}

/** Returns the most recently modified file among the given paths. */
async function newestFile(files: string[]): Promise<string> {
  const stats = await Promise.all(files.map(async (file) => ({ file, mtimeMs: (await stat(file)).mtimeMs })));
  stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return stats[0]!.file;
}
