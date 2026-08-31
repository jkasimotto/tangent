// Armed-prompt persistence: one JSON file per session under the armed root,
// so a prompt `armSession` (server.mjs) is waiting to type into a harness
// that has not finished booting yet survives a server restart. Pure module,
// no tmux, no HTTP.
//
// Why it exists: armedSessions used to be an in-memory Map only. A server
// restart between arming a session (the pane still sits at its shell) and
// the poll loop noticing the harness came up dropped the prompt outright —
// the pane's own step's own `tangent shell rebuild` could do this to the
// very next pipeline step. Every arm is written here first, before the
// launch command is typed, and the record is cleared once the prompt is
// confirmed delivered (or the session died before it could be). At boot the
// server reads what is left and re-arms it (rearmPersistedPrompts in
// server.mjs), so a step that was still booting when the process stopped
// gets its prompt from the new process instead.

import { rm } from "node:fs/promises";
import path from "node:path";
import { readJsonObject, walkJsonFiles, writeJsonObject } from "./json-store.mjs";

export const ARMED_PROMPT_SCHEMA = "armed-prompt.v2";
const LEGACY_ARMED_PROMPT_SCHEMA = "armed-prompt.v1";

/** File path of one session's armed-prompt record. */
export function armedPromptPath(root, session) {
  return path.join(root, `${session}.json`);
}

/** Writes one session's armed-prompt record atomically. */
export async function writeArmedPrompt(root, session, fields) {
  const record = { schema: ARMED_PROMPT_SCHEMA, session, armedAt: new Date().toISOString(), ...fields };
  const target = armedPromptPath(root, session);
  return writeJsonObject(target, record);
}

/** Removes one session's armed-prompt record; a missing file is not an error. */
export async function clearArmedPrompt(root, session) {
  await rm(armedPromptPath(root, session), { force: true });
}

/**
 * Every armed-prompt record on disk, for re-arming after a restart. A file
 * that is half-written or foreign is skipped rather than thrown, so one bad
 * record cannot hide the rest.
 */
export async function readAllArmedPrompts(root) {
  const records = [];
  for (const file of await walkJsonFiles(root)) {
    const parsed = await readJsonObject(file);
    if ([ARMED_PROMPT_SCHEMA, LEGACY_ARMED_PROMPT_SCHEMA].includes(parsed?.schema) && parsed.session) records.push({ ...parsed, schema: ARMED_PROMPT_SCHEMA, receiptRequest: parsed.receiptRequest ?? null });
  }
  return records;
}
