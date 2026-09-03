// Finding the files a harness wrote for one recorded conversation, including
// the ones its subagents wrote.
//
// Three harness families, three unrelated layouts, and one of them was wrong
// for as long as it existed: pi transcripts were looked for at
// `<transcripts>/<id>.jsonl` while pi writes
// `<transcripts>/<cwd-slug>/<timestamp>_<id>.jsonl`, so no pi conversation
// had ever resolved and liveness was silently off for every pi attempt. This
// module is the single place that knows the layouts, so the next reader
// cannot drift away from the observer again.

import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { dayFolder, expandHome, firstLine } from "./harness-conversation.mjs";

/** The harness family one recorded harness or provider id belongs to, or null. */
export function transcriptFamily(id) {
  const value = String(id ?? "");
  if (value.startsWith("claude")) return "claude";
  if (value.startsWith("codex")) return "codex";
  if (value === "pi" || value.startsWith("pi-")) return "pi";
  return null;
}

/** The harness a conversation record names, under either key it has used. */
export function conversationHarness(conversation, harness) {
  return String(conversation?.harness ?? conversation?.provider ?? harness?.id ?? "");
}

/** Encodes a cwd the same way Claude names its projects folder. */
export function claudeProjectKey(cwd) {
  return String(cwd ?? "").replace(/[/.]/g, "-");
}

/**
 * Encodes a cwd the same way pi names its session folder.
 *
 * Unlike Claude, pi keeps dots and wraps the slug in a leading and a trailing
 * dash, so the two encodings are not interchangeable. Measured against the
 * `cwd` on the first line of a session in each of 51 session folders: the
 * rule matched 51 of 51.
 */
export function piProjectKey(cwd) {
  const value = String(cwd ?? "");
  return value ? `-${value.replaceAll("/", "-")}--` : "";
}

/**
 * Resolves the transcript for one recorded conversation.
 *
 * Returns `{ harness, family, path }`, or null when the harness declares no
 * transcripts folder, the record carries no conversation id, or the file the
 * layout points at is not there.
 */
export async function resolveTranscript({ harness, conversation, cwd, startedAt } = {}) {
  const resolved = await resolveConversationFiles({ harness, conversation, cwd, startedAt });
  return resolved?.path ? { harness: resolved.harness, family: resolved.family, path: resolved.path } : null;
}

/**
 * Resolves the transcript for one conversation together with the transcripts
 * of the subagents it ran.
 *
 * Subagents spend against the same Job, so a cost that omits them is wrong by
 * however much the subagents did. Each family records them differently:
 * Claude writes them beside the parent under `<id>/subagents/`, Codex writes
 * each one as its own rollout that names the thread it belongs to, and pi
 * runs them inside the parent conversation with no separate file.
 */
export async function resolveConversationFiles({ harness, conversation, cwd, startedAt } = {}) {
  const id = conversationHarness(conversation, harness);
  const family = transcriptFamily(id);
  if (!harness?.transcripts || !conversation?.id || !family) return null;
  const root = expandHome(harness.transcripts);
  if (family === "claude") return claudeFiles({ harness: id, root, cwd, id: conversation.id });
  if (family === "pi") return piFiles({ harness: id, root, cwd, id: conversation.id });
  return codexFiles({ harness: id, transcripts: harness.transcripts, id: conversation.id, startedAt });
}

/** Locates one Claude conversation and the subagent transcripts beside it. */
async function claudeFiles({ harness, root, cwd, id }) {
  const folder = path.join(root, claudeProjectKey(cwd));
  const names = await readdir(folder).catch(() => null);
  if (!names?.includes(`${id}.jsonl`)) return { harness, family: "claude", path: null, subagents: [], subagentsSupported: true };
  const subagentFolder = path.join(folder, id, "subagents");
  const subagentNames = await readdir(subagentFolder).catch(() => []);
  const subagents = subagentNames
    .filter((name) => name.startsWith("agent-") && name.endsWith(".jsonl"))
    .map((name) => path.join(subagentFolder, name));
  return { harness, family: "claude", path: path.join(folder, `${id}.jsonl`), subagents, subagentsSupported: true };
}

/**
 * Locates one pi conversation.
 *
 * The file name carries a timestamp the attempt record does not know, so the
 * id is matched against the file name's suffix. The cwd folder is tried
 * first; an attempt that lost its cwd falls back to a scan of every session
 * folder, which is the only way an older record resolves at all.
 */
async function piFiles({ harness, root, cwd, id }) {
  const suffix = `_${id}.jsonl`;
  const folders = cwd ? [piProjectKey(cwd)] : await readdir(root).catch(() => []);
  for (const folder of folders) {
    const names = await readdir(path.join(root, folder)).catch(() => []);
    const match = names.find((name) => name.endsWith(suffix));
    if (match) return { harness, family: "pi", path: path.join(root, folder, match), subagents: [], subagentsSupported: false };
  }
  if (cwd) return piFiles({ harness, root, cwd: null, id });
  return { harness, family: "pi", path: null, subagents: [], subagentsSupported: false };
}

/**
 * Locates one Codex thread and every rollout descended from it.
 *
 * Codex mints its own thread ids, so the rollout is found in an index of the
 * surrounding day folders rather than by joining a path.
 *
 * A child rollout sets `payload.session_id` to the id of the *root* thread
 * and `payload.id` to its own, so one lookup on `session_id` collects the
 * whole tree at every depth. Measured across 2,005 rollouts: 1,043 of 1,043
 * child rollouts resolve that way, while `thread_spawn.parent_thread_id` is
 * present on only 373 of them and names the immediate parent rather than the
 * root. Reading only the spawn link would have missed 670 rollouts, every
 * `guardian_review` thread among them. The spawn edge is walked as well, so
 * a rollout that carries it but not the session link is still reached.
 */
async function codexFiles({ harness, transcripts, id, startedAt }) {
  const rollouts = await codexRolloutIndex({ transcripts, startedAt });
  const main = rollouts.find((entry) => entry.id === id) ?? null;
  if (!main) return { harness, family: "codex", path: null, subagents: [], subagentsSupported: true };
  const byParent = new Map();
  for (const entry of rollouts) {
    for (const parent of entry.parents) byParent.set(parent, [...(byParent.get(parent) ?? []), entry]);
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
  return { harness, family: "codex", path: main.transcriptPath, subagents, subagentsSupported: true };
}

/**
 * The Codex rollout index, kept for as long as the day folders are unchanged.
 *
 * Building it reads the first line of every rollout in four days of folders,
 * which is far too much work to repeat for every attempt of every Job on
 * every refresh. A new rollout changes its folder's modification time, so the
 * folders' own stamps are enough to know when to build it again.
 */
const rolloutIndexCache = new Map();

/**
 * Indexes the Codex rollouts written around one start time.
 *
 * A subagent starts whenever the parent decides to spawn it, so unlike the
 * launch-time lookup this cannot filter on a narrow time window. Only the
 * first line of each file is read.
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
    for (const name of await readdir(dir).catch(() => [])) {
      if (!name.startsWith("rollout-") || !name.endsWith(".jsonl")) continue;
      const meta = await rolloutMeta(path.join(dir, name));
      if (meta) entries.push(meta);
    }
  }
  rolloutIndexCache.set(key, { stamp, entries });
  return entries;
}

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

/** Reads one rollout's identity and the threads it belongs to, from its first line. */
export async function rolloutMeta(file) {
  const first = await firstLine(file).catch(() => null);
  if (!first) return null;
  let parsed;
  try { parsed = JSON.parse(first); } catch { return null; }
  if (parsed?.type !== "session_meta") return null;
  const payload = parsed.payload ?? {};
  const id = payload.id ?? payload.session_id;
  const root = payload.session_id && payload.session_id !== id ? payload.session_id : null;
  const spawned = payload.source?.subagent?.thread_spawn?.parent_thread_id ?? null;
  const at = Date.parse(payload.timestamp ?? parsed.timestamp ?? "");
  return {
    id,
    parents: [...new Set([root, spawned].filter((value) => value && value !== id))],
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
 * Codex mints its own thread id and takes none at launch, so an attempt
 * stores nothing and the thread is matched afterwards on the two facts the
 * attempt does know. This reads the same cached index the cost path builds,
 * unlike the launch-time lookup in `harness-conversation.mjs`, which is
 * deliberately uncached because it runs once. Threads spawned by another
 * thread are excluded: they are reached through their parent.
 */
export async function findCodexThread({ transcripts, cwd, startedAt, windowMs = 60_000 }) {
  const started = Date.parse(startedAt ?? "");
  if (!cwd || Number.isNaN(started)) return null;
  return (await codexRolloutIndex({ transcripts, startedAt }))
    .filter((entry) => entry.cwd === cwd && !entry.parents.length && entry.startedAt !== null)
    .filter((entry) => entry.startedAt >= started - 5_000 && entry.startedAt <= started + windowMs)
    .sort((left, right) => left.startedAt - right.startedAt)[0] ?? null;
}
