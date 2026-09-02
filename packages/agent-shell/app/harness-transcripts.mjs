// Finding the files a harness wrote for one recorded conversation.
//
// Three harness families, three unrelated layouts, and one of them was wrong
// for as long as it has existed: pi transcripts were looked for at
// `<transcripts>/<id>.jsonl` while pi writes
// `<transcripts>/<cwd-slug>/<timestamp>_<id>.jsonl`, so no pi conversation
// had ever resolved. This module is the single place that knows the layouts,
// including where each harness puts the conversations its subagents ran.

import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { dayFolder, expandHome, firstLine } from "./harness-conversation.mjs";

/** The harness family one recorded provider id belongs to, or null. */
export function transcriptFamily(provider) {
  const id = String(provider ?? "");
  if (id.startsWith("claude")) return "claude";
  if (id.startsWith("codex")) return "codex";
  if (id === "pi" || id.startsWith("pi-")) return "pi";
  return null;
}

/** Encodes a cwd the same way Claude names its projects folder. */
export function claudeProjectKey(cwd) {
  return String(cwd ?? "").replace(/[/.]/g, "-");
}

/**
 * Encodes a cwd the same way pi names its session folder.
 *
 * Unlike Claude, pi keeps dots and wraps the slug in leading and trailing
 * dashes, so the two encodings are not interchangeable.
 */
export function piProjectKey(cwd) {
  const value = String(cwd ?? "");
  return value ? `-${value.replaceAll("/", "-")}--` : "";
}

/**
 * Resolves the transcript for one recorded conversation.
 *
 * Returns `{ provider, family, path }`, or null when the harness declares no
 * transcripts folder, the record carries no conversation id, or the file the
 * layout points at is not there.
 */
export async function resolveTranscript({ harness, conversation, cwd, startedAt } = {}) {
  const resolved = await resolveConversationFiles({ harness, conversation, cwd, startedAt });
  return resolved?.path ? { provider: resolved.provider, family: resolved.family, path: resolved.path } : null;
}

/**
 * Resolves the transcript for one conversation together with the transcripts
 * of the subagents it ran.
 *
 * Subagents spend against the same Job, so a cost that omits them is wrong by
 * however much the subagents did. Each family records them differently:
 * Claude writes them beside the parent under `<id>/subagents/`, Codex writes
 * each one as its own rollout that names its parent thread, and pi runs them
 * inside the parent conversation with no separate file.
 */
export async function resolveConversationFiles({ harness, conversation, cwd, startedAt } = {}) {
  const provider = String(conversation?.provider ?? harness?.id ?? "");
  const family = transcriptFamily(provider);
  if (!harness?.transcripts || !conversation?.id || !family) return null;
  const root = expandHome(harness.transcripts);
  if (family === "claude") return claudeFiles({ provider, root, cwd, id: conversation.id });
  if (family === "pi") return piFiles({ provider, root, cwd, id: conversation.id });
  return codexFiles({ provider, transcripts: harness.transcripts, cwd, id: conversation.id, startedAt });
}

/** Locates one Claude conversation and the subagent transcripts beside it. */
async function claudeFiles({ provider, root, cwd, id }) {
  const folder = path.join(root, claudeProjectKey(cwd));
  const file = path.join(folder, `${id}.jsonl`);
  const names = await readdir(folder).catch(() => null);
  if (!names?.includes(`${id}.jsonl`)) return { provider, family: "claude", path: null, subagents: [], subagentsSupported: true };
  const subagentFolder = path.join(folder, id, "subagents");
  const subagentNames = await readdir(subagentFolder).catch(() => []);
  const subagents = subagentNames
    .filter((name) => name.startsWith("agent-") && name.endsWith(".jsonl"))
    .map((name) => path.join(subagentFolder, name));
  return { provider, family: "claude", path: file, subagents, subagentsSupported: true };
}

/**
 * Locates one pi conversation.
 *
 * The file name carries a timestamp the record does not know, so the id is
 * matched against the suffix. The cwd folder is tried first; a conversation
 * whose attempt lost its cwd falls back to a scan of every session folder,
 * which is the only way an older record resolves at all.
 */
async function piFiles({ provider, root, cwd, id }) {
  const suffix = `_${id}.jsonl`;
  const preferred = cwd ? [piProjectKey(cwd)] : [];
  const folders = preferred.length ? preferred : await readdir(root).catch(() => []);
  for (const folder of folders) {
    const names = await readdir(path.join(root, folder)).catch(() => []);
    const match = names.find((name) => name.endsWith(suffix));
    if (match) return { provider, family: "pi", path: path.join(root, folder, match), subagents: [], subagentsSupported: false };
  }
  if (!preferred.length) return { provider, family: "pi", path: null, subagents: [], subagentsSupported: false };
  return piFiles({ provider, root, cwd: null, id });
}

/**
 * Locates one Codex thread and every subagent thread descended from it.
 *
 * Codex mints its own thread ids, so the rollout is found by matching the id
 * inside the file name rather than by joining a path. Subagent rollouts name
 * their parent in `session_meta`, and a subagent may spawn its own, so the
 * descendants are walked rather than taken one level deep.
 */
async function codexFiles({ provider, transcripts, cwd, id, startedAt }) {
  const rollouts = await codexRolloutIndex({ transcripts, startedAt });
  const main = rollouts.find((entry) => entry.id === id) ?? null;
  if (!main) return { provider, family: "codex", path: null, subagents: [], subagentsSupported: true };
  const byParent = new Map();
  for (const entry of rollouts) {
    if (!entry.parentId) continue;
    byParent.set(entry.parentId, [...(byParent.get(entry.parentId) ?? []), entry]);
  }
  const subagents = [];
  const queue = [id];
  const seen = new Set(queue);
  while (queue.length) {
    for (const child of byParent.get(queue.shift()) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      subagents.push(child.transcriptPath);
      queue.push(child.id);
    }
  }
  return { provider, family: "codex", path: main.transcriptPath, subagents, subagentsSupported: true };
}

/**
 * Indexes the Codex rollouts written around one start time.
 *
 * A subagent starts whenever the parent decides to spawn it, so unlike the
 * launch-time lookup this cannot filter on a narrow time window; it reads the
 * first line of every rollout in the surrounding days and keeps the parent
 * link. Only the first line of each file is read.
 */
async function codexRolloutIndex({ transcripts, startedAt }) {
  const root = expandHome(transcripts);
  const started = Date.parse(startedAt ?? "");
  if (!root || Number.isNaN(started)) return [];
  const folders = dayFolders(started);
  const key = `${root}|${folders.join(",")}`;
  const stamp = await foldersStamp(root, folders);
  const cached = rolloutIndexCache.get(key);
  if (cached?.stamp === stamp) return cached.entries;
  const entries = [];
  for (const folder of folders) {
    const dir = path.join(root, folder);
    const names = await readdir(dir).catch(() => []);
    for (const name of names) {
      if (!name.startsWith("rollout-") || !name.endsWith(".jsonl")) continue;
      const meta = await rolloutMeta(path.join(dir, name));
      if (meta) entries.push(meta);
    }
  }
  rolloutIndexCache.set(key, { stamp, entries });
  return entries;
}

/**
 * The Codex rollout index, kept for as long as the day folders are unchanged.
 *
 * Building it reads the first line of every rollout in four days of folders,
 * which is far too much work to repeat for each attempt of each Job on every
 * refresh. A new rollout changes its folder's modification time, so the
 * folders' own stamps are enough to know when to build it again.
 */
const rolloutIndexCache = new Map();

/** The modification stamp of the day folders one index was built from. */
async function foldersStamp(root, folders) {
  const parts = [];
  for (const folder of folders) {
    const info = await stat(path.join(root, folder)).catch(() => null);
    parts.push(info ? String(info.mtimeMs) : "none");
  }
  return parts.join("|");
}

/** The day folders a conversation and its subagents could have been written to. */
function dayFolders(started) {
  return [...new Set([-1, 0, 1, 2].map((offset) => dayFolder(started + offset * 86_400_000)))];
}

/** Reads one rollout's identity and parent link from its first line. */
async function rolloutMeta(file) {
  const first = await firstLine(file).catch(() => null);
  if (!first) return null;
  let parsed;
  try { parsed = JSON.parse(first); } catch { return null; }
  if (parsed?.type !== "session_meta") return null;
  const payload = parsed.payload ?? {};
  const spawn = payload.source?.subagent?.thread_spawn ?? null;
  const at = Date.parse(payload.timestamp ?? parsed.timestamp ?? "");
  return {
    id: payload.id ?? payload.session_id,
    parentId: spawn?.parent_thread_id ?? null,
    transcriptPath: file,
    cwd: payload.cwd ?? null,
    modelProvider: payload.model_provider ?? null,
    threadSource: payload.thread_source ?? null,
    startedAt: Number.isNaN(at) ? null : at,
  };
}

/**
 * Finds the Codex thread one attempt started, by folder and start time.
 *
 * Codex mints its own thread id, so an attempt records none and the thread is
 * matched afterwards on the two facts the attempt does know. This reads the
 * same cached rollout index the cost path already builds, unlike the
 * launch-time lookup, which is deliberately uncached because it runs once.
 * Subagent threads are excluded: they are reached through their parent.
 */
export async function findCodexThread({ transcripts, cwd, startedAt, windowMs = 60_000 }) {
  const started = Date.parse(startedAt ?? "");
  if (!cwd || Number.isNaN(started)) return null;
  const matches = (await codexRolloutIndex({ transcripts, startedAt }))
    .filter((entry) => entry.cwd === cwd && entry.threadSource !== "subagent" && entry.startedAt !== null)
    .filter((entry) => entry.startedAt >= started - 5_000 && entry.startedAt <= started + windowMs)
    .sort((left, right) => left.startedAt - right.startedAt);
  return matches[0] ?? null;
}
