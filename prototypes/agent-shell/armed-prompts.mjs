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

import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const ARMED_PROMPT_SCHEMA = "armed-prompt.v1";

/** File path of one session's armed-prompt record. */
export function armedPromptPath(root, session) {
  return path.join(root, `${session}.json`);
}

/** Writes one session's armed-prompt record atomically. */
export async function writeArmedPrompt(root, session, fields) {
  await mkdir(root, { recursive: true });
  const record = { schema: ARMED_PROMPT_SCHEMA, session, armedAt: new Date().toISOString(), ...fields };
  const target = armedPromptPath(root, session);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(tmp, target);
  return record;
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
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(await readFile(path.join(root, entry.name), "utf8"));
      if (parsed?.schema === ARMED_PROMPT_SCHEMA && parsed.session) records.push(parsed);
    } catch {
      // half-written or foreign: skip it, never block the others
    }
  }
  return records;
}
