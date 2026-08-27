// The conversation behind one attempt (ADR-0042). A harness entry in
// harnesses.md says how a conversation id is given at launch (`sessionIdArg`),
// how it is reopened (`resume`), and where its transcripts live
// (`transcripts`). This module renders those templates and finds codex
// rollouts, which get no id at launch, by folder and start time.

import { randomUUID } from "node:crypto";
import { readdir, open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Expands a leading `~` so a registry path reads like the shell writes it. */
export function expandHome(value) {
  const text = String(value ?? "");
  if (text === "~") return os.homedir();
  return text.startsWith("~/") ? path.join(os.homedir(), text.slice(2)) : text;
}

/**
 * The conversation record for a new attempt on `harness`, or null when the
 * harness takes no session id at launch (codex). Made before the session
 * exists, so the attempt knows its conversation from its first record.
 */
export function newConversation(harness, makeId = randomUUID) {
  if (!harness?.sessionIdArg) return null;
  return { provider: harness.id, id: makeId() };
}

/** The launch line with the harness's session id flag appended, or unchanged. */
export function launchWithConversation(harness, command, conversation) {
  if (!harness?.sessionIdArg || !conversation?.id) return String(command ?? "");
  return `${String(command ?? "").trim()} ${harness.sessionIdArg.replaceAll("{id}", conversation.id)}`.trim();
}

/**
 * The command that reopens one conversation, from the harness's `resume`
 * template. `{command}` is the attempt's own launch line, so an alias like
 * claude-otto and its model flags carry over. Null when the harness has no
 * `resume` or the attempt has no conversation id.
 */
export function resumeCommand(harness, { command = "", id = "" } = {}) {
  if (!harness?.resume || !id) return null;
  return harness.resume.replaceAll("{command}", String(command ?? "").trim()).replaceAll("{id}", id).replace(/\s+/g, " ").trim();
}

/** Reads the first line of one file without loading the rest. */
async function firstLine(file) {
  const handle = await open(file, "r");
  try {
    const chunks = [];
    const buffer = Buffer.alloc(16384);
    let text = "";
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
      text = Buffer.concat(chunks).toString("utf8");
      if (text.includes("\n")) break;
    }
    return text.split("\n")[0];
  } finally {
    await handle.close();
  }
}

/** The local YYYY/MM/DD folder codex uses for one instant. */
function dayFolder(at) {
  const date = new Date(at);
  /** Two-digit month or day. */
  const pad = (n) => String(n).padStart(2, "0");
  return path.join(String(date.getFullYear()), pad(date.getMonth() + 1), pad(date.getDate()));
}

/**
 * Finds codex rollouts started in `cwd` around `startedAt`: the first line of
 * each rollout is `session_meta` with the folder and the start time. Every
 * match is returned, so two rollouts 200 ms apart both show (D22). A rollout
 * that started up to 5 s before the attempt still counts, because clocks and
 * record writes are not ordered.
 */
export async function findCodexRollouts({ transcripts, cwd, startedAt, windowMs = 60_000 }) {
  const root = expandHome(transcripts);
  const started = Date.parse(startedAt);
  if (!root || !cwd || Number.isNaN(started)) return [];
  const folders = [...new Set([started - 86_400_000, started, started + 86_400_000].map(dayFolder))];
  const matches = [];
  for (const folder of folders) {
    const dir = path.join(root, folder);
    const names = await readdir(dir).catch(() => []);
    for (const name of names.filter((entry) => entry.startsWith("rollout-") && entry.endsWith(".jsonl"))) {
      const file = path.join(dir, name);
      let meta;
      try { meta = JSON.parse(await firstLine(file)); } catch { continue; }
      if (meta?.type !== "session_meta") continue;
      const payload = meta.payload ?? {};
      const at = Date.parse(payload.timestamp ?? meta.timestamp ?? "");
      if (payload.cwd !== cwd || Number.isNaN(at) || at < started - 5_000 || at > started + windowMs) continue;
      matches.push({ id: payload.id ?? payload.session_id, transcriptPath: file, startedAt: new Date(at).toISOString(), threadSource: payload.thread_source ?? null });
    }
  }
  return matches.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
