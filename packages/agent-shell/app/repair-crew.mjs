import { createHash } from "node:crypto";
import path from "node:path";
import { readJsonObject, walkJsonFiles, writeJsonObject } from "./json-store.mjs";
import { boundedSessionName } from "./session-names.mjs";

export const REPAIR_SCHEMA = "area-repair.v1";
export const REPAIR_RESULTS = new Set(["done", "blocked", "settled", "superseded", "expired", "failed"]);
export const REPAIR_REFUSAL = "the repair crew finishes live work. The Area brain or Julian decides this. Put it in your finishing note.";

/** Returns the store path for one exact Area. */
export function repairPath(root, area) {
  return path.join(root, `${area}.json`);
}

/** Reads one repair record, including an empty compatibility record. */
export async function readRepair(root, area) {
  const value = await readJsonObject(repairPath(root, area));
  if (!value || value.schema !== REPAIR_SCHEMA || value.area !== area) return { schema: REPAIR_SCHEMA, area, current: null, history: [] };
  return { schema: REPAIR_SCHEMA, area, current: value.current ?? null, history: Array.isArray(value.history) ? value.history.slice(-20) : [] };
}

/** Reads every repair record. */
export async function readAllRepairs(root) {
  const records = [];
  for (const file of await walkJsonFiles(root)) {
    const area = path.relative(root, file).replace(/\.json$/, "").split(path.sep).join("/");
    records.push(await readRepair(root, area));
  }
  return records;
}

/** Writes one repair record atomically. */
export async function writeRepair(root, record) {
  record.schema = REPAIR_SCHEMA;
  record.history = (record.history ?? []).slice(-20);
  return writeJsonObject(repairPath(root, record.area), record);
}

/** Returns the deterministic identity for one crew in one brain stop. */
export function repairId(area, stopSince, ordinal) {
  return createHash("sha256").update([area, stopSince, ordinal].map(String).join("\0")).digest("hex");
}

/** Builds one pending crew record before a tmux session exists. */
export function newRepair({ area, stop, trigger, ordinal, instanceId, cwd, resolvedLaunch, now = Date.now(), leaseMs = 30 * 60_000 }) {
  const startedAt = new Date(now).toISOString();
  const leaf = area.split("/").filter(Boolean).at(-1) ?? "area";
  return {
    id: repairId(area, stop.since, ordinal),
    ordinal,
    stop,
    trigger,
    session: boundedSessionName(leaf, "-repair", 60),
    target: null,
    instanceId,
    cwd,
    resolvedLaunch,
    providerSession: null,
    leaseUntil: new Date(now + leaseMs).toISOString(),
    startedAt,
    endedAt: null,
    result: null,
    report: null,
    commands: 0,
  };
}

/** Returns whether one crew can dispatch from the supplied authoritative facts. */
export function repairDispatchDecision({ area, brainWord, brainSince = null, waiting = [], record, hidden = false, owned = false, runningMachine = 0, now = Date.now(), graceMs = 180_000, machineLimit = 3 } = {}) {
  if (hidden) return { dispatch: false, reason: "Area is hidden" };
  if (!owned) return { dispatch: false, reason: "waiting work belongs to another Agent Shell instance" };
  if (!["Brain stopped", "Brain has a problem", "Brain hit a wall"].includes(brainWord)) return { dispatch: false, reason: "brain is live or recovering" };
  const useful = waiting.filter((item) => !["Needs your decision", "Idle", "Unknown", "Check it"].includes(item.word) && item.kind !== "process" && item.kind !== "command-echo");
  if (!useful.length) return { dispatch: false, reason: "no live work waits for the brain" };
  const oldestSince = Math.min(...useful.map((item) => Number(item.since) || now));
  if (now - oldestSince < graceMs) return { dispatch: false, reason: "repair grace is active", oldestSince };
  if (record?.current && !record.current.endedAt && Date.parse(record.current.leaseUntil) > now) return { dispatch: false, reason: "a crew already holds the Area lease" };
  const stopSince = brainSince ? new Date(Number(brainSince)).toISOString() : stopSinceOf(record, useful, now);
  const sameStop = [...(record?.history ?? []), ...(record?.current ? [record.current] : [])].filter((item) => item?.stop?.since === stopSince);
  if (sameStop.at(-1)?.result === "blocked") return { dispatch: false, reason: "the repair crew escalated the work", owner: "you", stopSince };
  const attempts = sameStop.length;
  if (attempts >= 2) return { dispatch: false, reason: "repair budget is spent", owner: "you", stopSince };
  if (runningMachine >= machineLimit) return { dispatch: false, reason: "machine repair limit is full", stopSince };
  return { dispatch: true, ordinal: attempts + 1, stopSince, waiting: useful, oldestSince };
}

/** Extends one crew lease after a committed command. */
export function extendRepairLease(repair, now = Date.now(), extensionMs = 10 * 60_000, maximumMs = 60 * 60_000) {
  if (!repair || repair.endedAt) return false;
  const maximum = Date.parse(repair.startedAt) + maximumMs;
  repair.leaseUntil = new Date(Math.min(maximum, Math.max(Date.parse(repair.leaseUntil), now) + extensionMs)).toISOString();
  repair.commands = Math.max(0, Number(repair.commands) || 0) + 1;
  return true;
}

/** Ends one crew once and moves it to bounded history. */
export function endRepair(record, result, report = null, now = Date.now()) {
  if (!REPAIR_RESULTS.has(result)) throw new Error(`unknown repair result ${result}`);
  const repair = record.current;
  if (!repair || repair.endedAt) return null;
  repair.result = result;
  repair.report = String(report ?? "").trim() || null;
  repair.endedAt = new Date(now).toISOString();
  record.history = [...(record.history ?? []), repair].slice(-20);
  record.current = null;
  return repair;
}

/** Returns the live crew only while its lease is valid. */
export function liveRepair(record, now = Date.now()) {
  const repair = record?.current;
  return repair && !repair.endedAt && Date.parse(repair.leaseUntil) > now ? repair : null;
}

/** Returns one stable stop boundary for a retry budget. */
function stopSinceOf(record, waiting, now) {
  const latest = record?.current ?? record?.history?.at?.(-1);
  if (latest && ["inactive", "no-record", "recovery-failed", "wall", "shell"].includes(latest.stop?.cause)) return latest.stop.since;
  return new Date(Math.min(...waiting.map((item) => Number(item.since) || now))).toISOString();
}
