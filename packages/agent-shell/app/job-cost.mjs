// What work cost: one Job, or everything that ran in a window.
//
// Spend does not only happen inside Jobs. An Area brain runs for days and
// spends the whole time, and a repair crew spends while it recovers a
// session. All three record the same five facts about an attempt, so all
// three are read the same way here, and a total that quietly covered only
// Jobs is not offered.
//
// The unit of cost is a conversation, not an attempt. Resuming an attempt
// reopens the conversation it already had, and Claude Code's ledger carries
// across the resume, so two attempts that share a conversation are one cost
// counted once.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { totalCost } from "./token-pricing.mjs";
import { conversationCost } from "./conversation-cost.mjs";
import { findCodexThread, transcriptFamily } from "./harness-transcripts.mjs";

/** One attempt's spend facts, in the shape every record family reduces to. */
export function spendAttempt({ scope, area, name, file, session, ref, conversation, cwd, startedAt, endedAt }) {
  return {
    scope, area, name,
    file: file ?? null,
    session: session ?? null,
    ref: ref ?? null,
    provider: ref?.provider ?? null,
    conversation: conversation ?? null,
    cwd: cwd ?? null,
    startedAt: startedAt ?? null,
    endedAt: endedAt ?? null,
  };
}

/**
 * The piece of work one attempt was spent on.
 *
 * A Job is named by the Goal file its record points at, because that is the
 * identity the Work screen already keys its rows on. A brain and a repair
 * crew have no Goal, so they are named by their Area and their kind: an Area
 * has exactly one brain and one repair crew at a time.
 */
export function workKey(attempt) {
  if (attempt?.scope === "job") return `job:${attempt.file ?? attempt.name ?? ""}`;
  return `${attempt?.scope ?? "job"}:${attempt?.area ?? ""}`;
}

/** Every attempt one Job record made, across all of its runs. */
export function jobAttempts(record, area, slug) {
  const attempts = [];
  for (const run of record?.runs?.length ? record.runs : [record]) {
    for (const assignment of run?.assignments ?? run?.steps ?? []) {
      for (const attempt of assignment?.attempts ?? []) {
        attempts.push(spendAttempt({
          scope: "job",
          area: record?.area ?? area,
          name: record?.goal ?? slug,
          file: record?.goal ?? null,
          session: attempt.session ?? assignment?.session ?? null,
          ref: attempt.resolvedLaunch?.ref,
          conversation: attempt.providerSession,
          cwd: attempt.cwd,
          startedAt: attempt.startedAt,
          endedAt: attempt.endedAt,
        }));
      }
    }
  }
  return attempts;
}

/**
 * Every generation one Area repair crew has run.
 *
 * A repair crew recovers a stopped Area and spends the whole time it works,
 * so leaving it out understates a day by however much recovery cost. Its
 * record keeps the same five facts under `current` and `history` that a Job
 * keeps under `attempts`.
 */
export function repairAttempts(record) {
  const generations = [...(record?.history ?? []), ...(record?.current ? [record.current] : [])];
  return generations.map((generation) => spendAttempt({
    scope: "repair",
    area: record?.area ?? "",
    name: `${record?.area ?? ""} repair`,
    file: null,
    session: generation.session ?? null,
    ref: generation.resolvedLaunch?.ref,
    conversation: generation.providerSession,
    cwd: generation.cwd,
    startedAt: generation.startedAt,
    endedAt: generation.endedAt,
  }));
}

/** Every generation one Area brain has run. */
export function brainAttempts(record) {
  return (record?.generations ?? []).map((generation) => spendAttempt({
    scope: "brain",
    area: record?.area ?? "",
    name: `${record?.area ?? ""} brain`,
    file: null,
    session: generation.session ?? null,
    ref: generation.resolvedLaunch?.ref,
    conversation: generation.providerSession,
    cwd: generation.cwd,
    startedAt: generation.startedAt,
    endedAt: generation.endedAt,
  }));
}

/**
 * Prices a list of attempts.
 *
 * `harnessFor` resolves a harness id against the registry the caller already
 * loaded. Attempts are folded onto the conversation they ran in, so a resumed
 * conversation is charged once, and every attempt that could not be reached
 * comes back in `unattributed` with the reason it could not, because a total
 * that hides its gaps is worse than one that names them.
 */
export async function priceAttempts(attempts, { harnessFor, rates, cache, discoverCodex = true } = {}) {
  const byConversation = new Map();
  const unattributed = [];
  for (const attempt of attempts) {
    const harness = attempt.ref?.harness ? harnessFor?.(attempt.ref.harness) : null;
    if (!harness) {
      unattributed.push({ ...attempt, reason: attempt.ref?.harness ? `the ${attempt.ref.harness} harness is not in the registry` : "the attempt recorded no harness" });
      continue;
    }
    if (!harness.transcripts) {
      unattributed.push({ ...attempt, reason: `the ${harness.id} harness declares no transcripts folder` });
      continue;
    }
    const conversation = attempt.conversation?.id
      ? attempt.conversation
      : discoverCodex ? await discoverConversation(harness, attempt) : null;
    if (!conversation?.id) {
      unattributed.push({ ...attempt, reason: "no conversation was recorded or found for this attempt" });
      continue;
    }
    const key = `${harness.transcripts}:${conversation.id}`;
    const known = byConversation.get(key);
    if (known) {
      known.attempts.push(attempt);
      continue;
    }
    const cost = await conversationCost({ harness, conversation, cwd: attempt.cwd, startedAt: attempt.startedAt, rates, cache });
    if (!cost?.path) {
      unattributed.push({ ...attempt, reason: "the transcript for this conversation is no longer on disk" });
      continue;
    }
    byConversation.set(key, { key, harness: harness.id, conversation, cost, attempts: [attempt] });
  }
  const conversations = [...byConversation.values()];
  return { ...totalCost(conversations.flatMap((entry) => entry.cost.parts)), conversations, unattributed };
}

/**
 * Finds the conversation an attempt did not record.
 *
 * Codex mints its own thread id and takes none at launch, so a codex attempt
 * stores nothing and the thread is matched afterwards by folder and start
 * time. Of 644 stored attempts, 246 are codex attempts reachable only this
 * way.
 */
async function discoverConversation(harness, attempt) {
  if (transcriptFamily(harness.id) !== "codex" || !attempt.cwd || !attempt.startedAt) return null;
  const found = await findCodexThread({ transcripts: harness.transcripts, cwd: attempt.cwd, startedAt: attempt.startedAt });
  return found?.id ? { harness: harness.id, provider: harness.id, id: found.id } : null;
}

/**
 * Reads every Job, brain and repair record under the Agent Shell state roots
 * and returns the attempts that started inside a window.
 *
 * A conversation is charged to the day its attempt started, so a session that
 * ran through midnight lands whole on the day it began rather than split
 * across two totals that neither of them explains.
 */
export async function attemptsInWindow({ pipelinesRoot, brainsRoot, repairsRoot = null, since = null, until = null } = {}) {
  const attempts = [];
  for (const file of await jsonFilesUnder(pipelinesRoot)) {
    const record = await readRecord(file);
    if (record) attempts.push(...jobAttempts(record, path.dirname(path.relative(pipelinesRoot, file)), path.basename(file, ".json")));
  }
  for (const file of await jsonFilesUnder(brainsRoot)) {
    const record = await readRecord(file);
    if (record) attempts.push(...brainAttempts(record));
  }
  for (const file of await jsonFilesUnder(repairsRoot)) {
    const record = await readRecord(file);
    if (record) attempts.push(...repairAttempts(record));
  }
  return attempts.filter((attempt) => withinWindow(attempt.startedAt, since, until));
}

/** True when an attempt started inside the requested window. */
function withinWindow(startedAt, since, until) {
  const at = Date.parse(startedAt ?? "");
  if (Number.isNaN(at)) return false;
  if (since && at < Date.parse(since)) return false;
  if (until && at > Date.parse(until)) return false;
  return true;
}

/** Every `.json` file under one folder, at any depth. */
async function jsonFilesUnder(folder) {
  if (!folder) return [];
  const found = [];
  for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) found.push(...await jsonFilesUnder(full));
    else if (entry.name.endsWith(".json")) found.push(full);
  }
  return found;
}

/** Reads one record file, or null when it is missing or not JSON. */
async function readRecord(file) {
  const text = await readFile(file, "utf8").catch(() => null);
  if (text === null) return null;
  try { return JSON.parse(text); } catch { return null; }
}
