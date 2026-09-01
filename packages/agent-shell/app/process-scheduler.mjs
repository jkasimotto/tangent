// The server is the scheduler (ADR-0043, D17 and D18). Every 10 s it reads
// each `process-<slug>.md` in the vault, decides whether the process is due,
// and when it is, writes one note to the Area brain inbox that says how to
// start it. Tangent starts no worker itself. A loop note (`every:` alone)
// instead sends its body to a live brain every so often. Run state lives in
// `~/.tangent/agent-shell/processes/<area>/<slug>.json`.

import { existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describeWhen, latestSlotAtOrBefore, nextSlotAfter, parseProcessNote, processSlugFromFile, scheduleSlotsBetween } from "./process-note.mjs";

const TREE_SKIP = new Set([".git", ".obsidian", "shared", "node_modules"]);
const OPEN_STATUSES = new Set(["open", "active", "verify"]);
const processLocks = new Map();
export const PROCESS_START_WINDOW_MS = 10 * 60_000;
export const PROCESS_AUTO_FAILURE_LIMIT = 3;
export const PROCESS_START_PHASES = Object.freeze(["accepted", "goal-created", "job-created", "started"]);
const PROCESS_START_PHASE_INDEX = new Map(PROCESS_START_PHASES.map((phase, index) => [phase, index]));
const DISMISSIBLE_PROCESS_EVENT_STATES = new Set(["waiting", "deferred", "did-not-start", "could-not-start"]);
const WORK_PROCESS_EVENT_STATES = new Set(["waiting", "deferred", "starting", "did-not-start", "could-not-start", "running"]);

/** Returns one stable base64url identity for NUL-separated fields. */
function digest(...parts) {
  return createHash("sha256").update(parts.join("\0")).digest("base64url");
}

/** Hashes the complete Process note without exposing its bytes. */
export function processDefinitionRevision(note) { return digest(note.raw ?? ""); }

/** Converts absent and compatibility state into the runtime v2 value without writing it. */
export function normalizeProcessState(value = {}, note = null, now = new Date()) {
  if (value?.schema === "process-state.v2") return {
    ...value, revision: Number(value.revision) || 0,
    auto: { consecutiveFailedSlots: 0, disabledAt: null, ...value.auto },
    whenRearm: { waitingForFalse: false, dismissedEventId: null, clearedAt: null, ...value.whenRearm },
    dismissedOccurrence: value.dismissedOccurrence ?? null,
    operations: Array.isArray(value.operations) ? value.operations : [],
  };
  const firstSeenAt = value.firstSeenAt ?? now.toISOString();
  let currentEvent = null;
  if (value.lastNoticeAt && (!value.lastGoalAt || value.lastGoalAt < value.lastNoticeAt) && note && !note.loop) {
    const slotAt = value.lastDueAt ?? value.lastNoticeAt;
    currentEvent = newProcessEvent(note, "schedule", slotAt, value.lastNoticeAt, { policy: "ask" });
  }
  return {
    schema: "process-state.v2", revision: 0, firstSeenAt,
    scheduleThroughAt: value.lastDueAt ?? firstSeenAt, currentEvent, lastEvent: null, backlog: null,
    auto: { consecutiveFailedSlots: 0, disabledAt: null },
    whenRearm: { waitingForFalse: false, dismissedEventId: null, clearedAt: null },
    dismissedOccurrence: null, operations: [],
    lastCheckedAt: value.lastCheckedAt ?? null, lastProbe: value.lastProbe ?? null, lastReason: value.lastReason ?? null,
    ...Object.fromEntries(["lastDueAt", "lastNoticeAt", "lastDeliveredAt", "lastGoalAt", "lastGoalFile"].filter((key) => value[key]).map((key) => [key, value[key]])),
  };
}

/** Returns an accepted start phase for an event, or null before Brain acceptance. */
function acceptedProcessAttempt(event) {
  return event?.attempts?.find((item) => ["accepted", "goal-created", "job-created", "started"].includes(item.status)) ?? null;
}

/** Returns one saved operation replay, or refuses reuse with different input. */
function processOperationReplay(state, operationId, action, eventId) {
  const prior = state.operations.find((item) => item.id === operationId);
  if (!prior) return null;
  if (prior.action !== action || prior.eventId !== eventId) {
    throw Object.assign(new Error("the operation ID was already used with different input"), { code: "operation-conflict" });
  }
  return prior;
}

/** Records one bounded idempotent Process operation. */
function recordProcessOperation(state, { id, action, eventId, at }) {
  state.operations = [...state.operations.filter((item) => item.id !== id), { id, action, eventId, at }].slice(-20);
}

/** Dismisses one exact actionable occurrence without changing its Process definition. */
export function dismissProcessOccurrence(state, note, { eventId, expectedRevision, operationId = randomUUID(), now = new Date() } = {}) {
  const next = structuredClone(normalizeProcessState(state, note, now));
  const replay = processOperationReplay(next, operationId, "dismiss", eventId);
  if (replay) return { state: next, event: next.currentEvent, idempotent: true };
  if (expectedRevision != null && Number(expectedRevision) !== next.revision) {
    throw Object.assign(new Error(`the Process revision is ${next.revision}`), { code: "stale-process-revision" });
  }
  if (note.loop) throw Object.assign(new Error("a loop has no bounded occurrence to dismiss"), { code: "process-loop-has-no-occurrence" });
  const event = next.currentEvent;
  if (!event || event.id !== eventId) throw Object.assign(new Error("the Process event changed"), { code: "stale-process-event" });
  if (acceptedProcessAttempt(event) || ["starting", "running"].includes(event.status)) {
    throw Object.assign(new Error("This occurrence already started."), { code: "process-occurrence-started" });
  }
  if (!DISMISSIBLE_PROCESS_EVENT_STATES.has(event.status)) {
    throw Object.assign(new Error("this occurrence is no longer actionable"), { code: "stale-process-event" });
  }
  const dismissedAt = new Date(now).toISOString();
  next.dismissedOccurrence = { event: structuredClone(event), dismissedAt, replacedAt: null };
  event.status = "skipped";
  event.deferredUntil = null;
  event.revision += 1;
  next.lastEvent = { id: event.id, source: event.source, slotAt: event.slotAt, outcome: "skipped", goalFile: null, jobRun: null, endedAt: dismissedAt };
  if (event.source === "probe") next.whenRearm = { waitingForFalse: true, dismissedEventId: event.id, clearedAt: null };
  recordProcessOperation(next, { id: operationId, action: "dismiss", eventId: event.id, at: dismissedAt });
  return { state: bump(next, now), event, idempotent: false };
}

/** Restores the exact last dismissed occurrence when no newer occurrence exists. */
export function restoreProcessOccurrence(state, note, { eventId, expectedRevision, operationId = randomUUID(), now = new Date() } = {}) {
  const next = structuredClone(normalizeProcessState(state, note, now));
  const replay = processOperationReplay(next, operationId, "restore", eventId);
  if (replay) return { state: next, event: next.currentEvent, idempotent: true };
  if (expectedRevision != null && Number(expectedRevision) !== next.revision) {
    throw Object.assign(new Error(`the Process revision is ${next.revision}`), { code: "stale-process-revision" });
  }
  const dismissed = next.dismissedOccurrence;
  if (!dismissed || dismissed.event?.id !== eventId) {
    throw Object.assign(new Error("the dismissed occurrence is no longer available"), { code: "stale-process-event" });
  }
  if (next.currentEvent?.id !== eventId || next.currentEvent.status !== "skipped") {
    throw Object.assign(new Error("A newer occurrence exists."), { code: "newer-process-occurrence" });
  }
  next.currentEvent = structuredClone(dismissed.event);
  next.currentEvent.revision = Math.max(1, Number(next.currentEvent.revision) || 0) + 1;
  next.dismissedOccurrence = null;
  if (next.whenRearm.dismissedEventId === eventId) next.whenRearm = { waitingForFalse: false, dismissedEventId: null, clearedAt: null };
  recordProcessOperation(next, { id: operationId, action: "restore", eventId, at: new Date(now).toISOString() });
  return { state: bump(next, now), event: next.currentEvent, idempotent: false };
}

/** Creates one stable due or manual event. */
function newProcessEvent(note, source, slotAt, observedAt, { policy = note.startPolicy ?? "ask", missed = [] } = {}) {
  const definitionRevision = processDefinitionRevision(note);
  return {
    id: digest(note.file, source, slotAt), revision: 1, source, slotAt, observedAt, definitionRevision, policy,
    status: "waiting", deferredUntil: null,
    missed: { count: Math.max(0, missed.length - 1), since: missed.length > 1 ? missed[0].toISOString() : null },
    currentAttemptId: null, attempts: [], plannedGoalFile: null, goalFile: null, job: null, failureCounted: false,
    createdAt: observedAt, updatedAt: observedAt,
  };
}

/** Advances one Process state revision and update time. */
function bump(state, now) {
  state.revision = (Number(state.revision) || 0) + 1;
  if (state.currentEvent) state.currentEvent.updatedAt = new Date(now).toISOString();
  return state;
}

/** Prepares one fenced start attempt. The caller performs Brain delivery after releasing the Process lock. */
export function prepareProcessStart(state, note, { now = new Date(), trigger = "julian", mode = "start", operationId = randomUUID() } = {}) {
  const next = structuredClone(normalizeProcessState(state, note, now));
  let event = next.currentEvent;
  if (mode === "run-again") {
    if (event && !["finished", "skipped", "did-not-start", "could-not-start"].includes(event.status)) throw Object.assign(new Error("a Process event is already active"), { code: "process-start-in-flight" });
    event = newProcessEvent(note, "manual", new Date(now).toISOString(), new Date(now).toISOString());
    next.currentEvent = event;
  }
  if (!event) throw Object.assign(new Error("this Process has no waiting event"), { code: "stale-process-event" });
  if (["running", "starting"].includes(event.status)) throw Object.assign(new Error("this Process is already starting or running"), { code: "process-start-in-flight" });
  if (["finished", "skipped"].includes(event.status)) throw Object.assign(new Error("this Process event is finished"), { code: "stale-process-event" });
  if (trigger === "julian") { next.auto.consecutiveFailedSlots = 0; next.auto.disabledAt = null; }
  const attempt = {
    id: digest(operationId, event.id, "attempt"), operationId, trigger, mode, status: "delivery-pending",
    requestedAt: new Date(now).toISOString(), deadlineAt: new Date(new Date(now).getTime() + PROCESS_START_WINDOW_MS).toISOString(),
    brain: null, error: null, updatedAt: new Date(now).toISOString(),
  };
  event.attempts = [...event.attempts.filter((item) => !["prepared", "delivery-pending"].includes(item.status)), attempt].slice(-10);
  event.currentAttemptId = attempt.id;
  event.status = "starting";
  return { state: bump(next, now), event, attempt };
}

/** Settles the result of Brain delivery after the Process lock was released. */
export function settleProcessDelivery(state, attemptId, outcome, now = new Date()) {
  const next = structuredClone(state);
  const event = next.currentEvent;
  const attempt = event?.attempts?.find((item) => item.id === attemptId);
  if (!attempt || event.currentAttemptId !== attemptId) throw Object.assign(new Error("the Process attempt changed"), { code: "stale-process-attempt" });
  if (outcome.ok) {
    attempt.status = "delivered"; attempt.brain = outcome.brain ?? null; event.status = "starting";
    next.lastNoticeAt = attempt.requestedAt; next.lastDeliveredAt = new Date(now).toISOString();
  } else {
    attempt.status = "failed"; attempt.error = { code: outcome.code ?? "process-start-failed", message: outcome.error };
    event.status = "could-not-start";
    if (attempt.trigger === "auto" && !event.failureCounted) {
      event.failureCounted = true;
      next.auto.consecutiveFailedSlots += 1;
      if (next.auto.consecutiveFailedSlots >= PROCESS_AUTO_FAILURE_LIMIT) next.auto.disabledAt = new Date(now).toISOString();
    }
  }
  attempt.updatedAt = new Date(now).toISOString();
  return bump(next, now);
}

/** Returns the accepted start attempt that controller recovery can resume. */
export function recoverableProcessStart(state) {
  const event = state?.currentEvent;
  const attempt = event?.attempts?.find((item) => item.id === event.currentAttemptId);
  return attempt && PROCESS_START_PHASE_INDEX.has(attempt.status) && attempt.status !== "started"
    ? { event, attempt }
    : null;
}

/**
 * Durably advances one composite Process start after its preceding effect
 * settled. Phases are monotonic, so an exact recovery replay is a read and a
 * stale or out-of-order effect cannot move the operation backwards.
 */
export function recordProcessStartPhase(state, attemptId, phase, facts = {}, now = new Date()) {
  if (!PROCESS_START_PHASE_INDEX.has(phase)) throw new Error(`unknown Process start phase ${phase}`);
  const next = structuredClone(state);
  const event = next.currentEvent;
  const attempt = event?.attempts?.find((item) => item.id === attemptId);
  if (!attempt || event.currentAttemptId !== attemptId || !PROCESS_START_PHASE_INDEX.has(attempt.status)) {
    throw Object.assign(new Error("the Process attempt is stale"), { code: "stale-process-attempt" });
  }
  const currentIndex = PROCESS_START_PHASE_INDEX.get(attempt.status);
  const nextIndex = PROCESS_START_PHASE_INDEX.get(phase);
  if (nextIndex <= currentIndex) return next;
  if (nextIndex > currentIndex + 1) {
    throw Object.assign(new Error(`Process start cannot move from ${attempt.status} to ${phase}`), { code: "process-phase-gap" });
  }
  if (facts.plannedGoalFile) event.plannedGoalFile = facts.plannedGoalFile;
  if (facts.goalFile) event.goalFile = facts.goalFile;
  if (facts.job) event.job = structuredClone(facts.job);
  attempt.status = phase;
  attempt.updatedAt = new Date(now).toISOString();
  if (phase === "started") {
    event.status = "running";
    next.auto.consecutiveFailedSlots = 0;
    next.auto.disabledAt = null;
    next.lastGoalFile = event.goalFile;
    next.lastGoalAt = new Date(now).toISOString();
  } else {
    event.status = "starting";
  }
  return bump(next, now);
}

/** Serializes scheduler and control work for one exact Area/process identity. */
export async function withProcessLock(area, slug, operation) {
  const key = `${area}\0${slug}`;
  const previous = processLocks.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  processLocks.set(key, current);
  await previous.catch(() => {});
  try { return await operation(); }
  finally {
    release();
    if (processLocks.get(key) === current) processLocks.delete(key);
  }
}

/** The machine-local state file of one process. */
export function processStatePath(stateRoot, area, slug) {
  return path.join(stateRoot, area, `${slug}.json`);
}

/** Reads one process's run state; an absent or broken file is empty state. */
export async function readProcessState(stateRoot, area, slug) {
  try {
    const value = JSON.parse(await readFile(processStatePath(stateRoot, area, slug), "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

/** Atomically writes one process's run state. */
export async function writeProcessState(stateRoot, area, slug, state) {
  const file = processStatePath(stateRoot, area, slug);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

/** Removes only one process's derived run state. An absent file is already clear. */
export async function removeProcessState(stateRoot, area, slug) {
  try { await unlink(processStatePath(stateRoot, area, slug)); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}

/** Every Area path in the vault, parents before children. */
async function walkAreas(treesRoot) {
  const out = [];
  /** Walks visible Area directories. */
  const walk = async (directory, relative) => {
    let entries = [];
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || TREE_SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
      const area = relative ? `${relative}/${entry.name}` : entry.name;
      out.push(area);
      await walk(path.join(directory, entry.name), area);
    }
  };
  await walk(treesRoot, "");
  return out;
}

/** Reads every process note of one Area. */
export async function readAreaProcesses(treesRoot, area) {
  let entries = [];
  try { entries = await readdir(path.join(treesRoot, area)); } catch { return []; }
  const notes = [];
  for (const name of entries.filter((entry) => processSlugFromFile(entry)).sort()) {
    const file = `${area}/${name}`;
    let text = "";
    try { text = await readFile(path.join(treesRoot, file), "utf8"); } catch { continue; }
    notes.push(parseProcessNote(text, { file, area }));
  }
  return notes;
}

/** Reads every process note in the vault, or in one Area and the Areas inside it. */
export async function discoverProcesses(treesRoot, { area = "" } = {}) {
  const areas = (await walkAreas(treesRoot)).filter((item) => !area || item === area || item.startsWith(`${area}/`));
  const notes = [];
  for (const item of areas) notes.push(...await readAreaProcesses(treesRoot, item));
  return notes;
}

/** How many intervals a loop waits for a lost delivery before it fires anyway. */
const LOOP_STALE_INTERVALS = 3;

/** The one message the brain gets on each loop tick: the body, named by its loop. */
export function loopNotice(note) {
  return `Loop ${note.slug} (every ${note.every}): ${note.body}`;
}

/**
 * Whether a loop is due: it never fired, or `every:` passed since the last
 * tick and that tick reached the brain. One message is in flight at most.
 * After three intervals with no delivery it fires anyway, so a lost
 * delivery costs three intervals, not the loop.
 */
export function loopDue(note, state, now) {
  const last = instant(state.lastNoticeAt);
  if (!last) return { due: true, reason: "first tick", slot: new Date(now) };
  const elapsed = new Date(now).getTime() - last.getTime();
  if (elapsed < note.everyMs) return { due: false, reason: `next tick ${new Date(last.getTime() + note.everyMs).toISOString()}`, slot: null };
  const delivered = instant(state.lastDeliveredAt);
  if (delivered && delivered.getTime() >= last.getTime()) return { due: true, reason: `${note.every} passed since the last tick`, slot: new Date(now) };
  if (elapsed >= note.everyMs * LOOP_STALE_INTERVALS) return { due: true, reason: `the last tick never reached the brain; ${LOOP_STALE_INTERVALS} intervals passed`, slot: new Date(now) };
  return { due: false, reason: `the last tick ${state.lastNoticeAt} waits for the composer`, slot: null };
}

/** The one note the brain gets when a process is due (D17). */
export function dueNotice(note, _treesRoot, event = null, attempt = null) {
  const fences = event && attempt ? ` --event ${event.id} --attempt ${attempt.id} --definition ${event.definitionRevision} --operation-id ${attempt.operationId}` : "";
  return `Process ${note.slug} is due. Start it with: tangent process start ${note.area}/${note.slug}${fences}`;
}

/** The instant a stored ISO field names, or null. */
function instant(value) {
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(time) ? new Date(time) : null;
}

/**
 * Whether a scheduled process has a slot to fire. Missed slots coalesce to
 * the latest one at or before now, and slots before the process was first
 * seen never fire, so a new note does not fire for this morning.
 */
export function scheduleDue(note, state, now) {
  const slot = latestSlotAtOrBefore(note.schedule, now);
  const floor = instant(state.lastDueAt) ?? instant(state.firstSeenAt);
  if (!slot) return { due: false, slot: null, reason: "no slot yet" };
  if (floor && slot.getTime() <= floor.getTime()) return { due: false, slot, reason: `next slot ${nextSlotAfter(note.schedule, now)?.toISOString() ?? "unknown"}` };
  return { due: true, slot, reason: `slot ${slot.toISOString()} passed` };
}

/** Whether a `when:` process is due for a probe run: never checked, or `every:` has passed. */
export function probeCheckDue(note, state, now) {
  const last = instant(state.lastCheckedAt);
  if (!last) return { check: true, reason: "never checked" };
  const elapsed = new Date(now).getTime() - last.getTime();
  return elapsed >= note.everyMs
    ? { check: true, reason: `${note.every} passed since the last check` }
    : { check: false, reason: `next check ${new Date(last.getTime() + note.everyMs).toISOString()}` };
}

/**
 * True when a Goal is the one a process note started: its `process:`
 * frontmatter names the note file or slug, or its title is the process
 * title. The title match covers a brain that started the process without
 * `--instruction-file`, so a `when:` note is not left waiting forever.
 */
export function goalNamesProcess(goal, note) {
  const named = String(goal?.process ?? "").trim();
  if (named && [note.file, note.slug, `process-${note.slug}`, `process-${note.slug}.md`].includes(named)) return true;
  if (named && named.endsWith(`/process-${note.slug}.md`)) return true;
  return String(goal?.title ?? "").trim().toLowerCase() === String(note.title ?? "").trim().toLowerCase();
}

/** True when a Goal record is still open in any of its working statuses. */
function goalIsOpen(goal) {
  return Boolean(goal) && OPEN_STATUSES.has(String(goal.status ?? "open"));
}

/**
 * Decides whether one process is due now. `openGoal` is the open Goal the
 * process created, when one exists: a due process is skipped while it is
 * open. `runProbe` runs the `when:` probe and resolves its exit code. A
 * `when:` process whose note the brain has not acted on is not probed again,
 * so the inbox gets one note per condition, not one per interval.
 */
export async function evaluateProcess({ note, state, now = new Date(), runProbe, openGoal = null, areaHidden = "", brainLive = true }) {
  if (note.error) return { due: false, reason: `broken note: ${note.error}`, slot: null };
  if (note.status === "paused") return { due: false, reason: "paused", slot: null };
  if (areaHidden) return { due: false, reason: `Area is ${areaHidden}`, slot: null };
  if (note.loop) return brainLive ? loopDue(note, state, now) : { due: false, reason: "brain not running", slot: null };
  if (openGoal && goalIsOpen(openGoal)) return { due: false, reason: `Goal ${openGoal.file} is still open`, slot: null, openGoal };
  if (note.schedule) return { ...scheduleDue(note, state, now) };
  if (state.whenRearm?.waitingForFalse) {
    const check = probeCheckDue(note, state, now);
    if (!check.check) return { due: false, reason: check.reason, slot: null };
    const exitCode = await runProbe(note);
    return exitCode === 0
      ? { due: false, reason: "the dismissed condition is still true", slot: null, checked: true, exitCode }
      : { due: false, reason: `probe exited ${exitCode}; the condition cleared`, slot: null, checked: true, exitCode, rearmCleared: true };
  }
  if (state.currentEvent && !["finished", "skipped", "did-not-start", "could-not-start"].includes(state.currentEvent.status)) return { due: false, reason: `event ${state.currentEvent.id} waits for the brain`, slot: null };
  if (state.lastNoticeAt && (!state.lastGoalAt || state.lastGoalAt < state.lastNoticeAt)) return { due: false, reason: `note sent ${state.lastNoticeAt}; waits for the brain`, slot: null };
  const check = probeCheckDue(note, state, now);
  if (!check.check) return { due: false, reason: check.reason, slot: null };
  const exitCode = await runProbe(note);
  return exitCode === 0
    ? { due: true, reason: `probe exited 0 (${check.reason})`, slot: new Date(now), checked: true, exitCode }
    : { due: false, reason: `probe exited ${exitCode}`, slot: null, checked: true, exitCode };
}

/**
 * One sweep: reads every process, evaluates it, and sends the brain one
 * note per due process. `openGoalFor(note)` finds the open Goal the
 * process created. `notify(area, text, { idempotencyKey })` writes the
 * note to the exact-Area inbox. `hiddenAreaStatus(area)` resolves to `done`
 * or `archived` when the Area or an ancestor is folded away: its processes
 * are never due (area-archive Decision 7).
 */
export async function sweepProcesses({ treesRoot, stateRoot, now = new Date(), runProbe, openGoalFor, notify, requestStart = null, recoverStart = null, hiddenAreaStatus = async () => "", brainLive = async () => true, autoStartEnabled = process.env.TANGENT_PROCESS_AUTO_START !== "0" }) {
  const results = [];
  for (const discovered of await discoverProcesses(treesRoot)) {
    let delivery = null;
    const result = await withProcessLock(discovered.area, discovered.slug, async () => {
    const note = (await readAreaProcesses(treesRoot, discovered.area)).find((item) => item.slug === discovered.slug);
    if (!note) return;
    const stored = await readProcessState(stateRoot, note.area, note.slug);
    const state = normalizeProcessState(stored, note, now);
    let next = structuredClone(state);
    let deferredReady = false;
    if (next.currentEvent?.status === "deferred" && instant(next.currentEvent.deferredUntil)?.getTime() <= now.getTime()) {
      next.currentEvent.status = "waiting";
      next.currentEvent.deferredUntil = null;
      next.currentEvent.revision += 1;
      deferredReady = true;
    }
    const openGoal = await openGoalFor(note);
    if (openGoal) {
      next.lastGoalFile = openGoal.file;
      if (!next.lastGoalAt || (next.lastNoticeAt && next.lastGoalAt < next.lastNoticeAt)) next.lastGoalAt = now.toISOString();
      if (next.currentEvent && goalIsOpen(openGoal) && !["finished", "skipped"].includes(next.currentEvent.status)) {
        next.currentEvent.status = "running";
        next.currentEvent.goalFile = openGoal.file;
      } else if (next.currentEvent?.status === "running") {
        next.currentEvent.status = "finished";
        next.lastEvent = { id: next.currentEvent.id, source: next.currentEvent.source, slotAt: next.currentEvent.slotAt, outcome: "finished", goalFile: openGoal.file, jobRun: next.currentEvent.job?.run ?? null, endedAt: now.toISOString() };
        next.auto.consecutiveFailedSlots = 0;
        next.auto.disabledAt = null;
      }
    }
    let outcome;
    try {
      outcome = await evaluateProcess({ note, state: next, now, runProbe, openGoal, areaHidden: await hiddenAreaStatus(note.area), brainLive: note.loop ? await brainLive(note.area) : true });
    } catch (error) {
      outcome = { due: false, reason: `check failed: ${error.message}`, slot: null };
    }
    if (outcome.checked) {
      next.lastCheckedAt = now.toISOString();
      next.lastProbe = { exitCode: outcome.exitCode, at: now.toISOString() };
    }
    if (outcome.rearmCleared) next.whenRearm = { waitingForFalse: false, dismissedEventId: null, clearedAt: now.toISOString() };
    if (note.schedule && (outcome.reason === "paused" || outcome.reason.startsWith("Area is "))) {
      const inactiveThrough = latestSlotAtOrBefore(note.schedule, now)?.toISOString() ?? now.toISOString();
      next.scheduleThroughAt = inactiveThrough;
      next.lastDueAt = inactiveThrough;
    }
    if (outcome.due && note.loop) {
      const slotAt = (outcome.slot ?? now).toISOString();
      next.lastDueAt = slotAt;
      next.lastNoticeAt = now.toISOString();
      const addressed = await notify(note.area, note.loop ? loopNotice(note) : dueNotice(note, treesRoot), { idempotencyKey: `process:${note.area}:${note.slug}:${slotAt}` });
      if (note.loop && addressed) next.lastDeliveredAt = now.toISOString();
    } else if (outcome.due && !note.loop) {
      const slotAt = (outcome.slot ?? now).toISOString();
      const slots = note.schedule ? scheduleSlotsBetween(note.schedule, next.scheduleThroughAt ?? next.firstSeenAt, now) : [new Date(slotAt)];
      next.scheduleThroughAt = slotAt;
      next.lastDueAt = slotAt;
      if (!next.currentEvent || ["finished", "skipped", "did-not-start", "could-not-start"].includes(next.currentEvent.status)) {
        if (next.currentEvent) {
          next.lastEvent = { id: next.currentEvent.id, source: next.currentEvent.source, slotAt: next.currentEvent.slotAt, outcome: next.currentEvent.status, goalFile: next.currentEvent.goalFile, jobRun: next.currentEvent.job?.run ?? null, endedAt: now.toISOString() };
          if (next.dismissedOccurrence?.event?.id === next.currentEvent.id) next.dismissedOccurrence.replacedAt = now.toISOString();
        }
        next.currentEvent = newProcessEvent(note, note.schedule ? "schedule" : "probe", slotAt, now.toISOString(), { missed: slots.length ? slots : [new Date(slotAt)] });
      } else if (slots.length) {
        next.backlog = { firstSlotAt: next.backlog?.firstSlotAt ?? slots[0].toISOString(), latestSlotAt: slots.at(-1).toISOString(), count: (next.backlog?.count ?? 0) + slots.length };
      }
      const canAuto = note.startPolicy === "auto" && autoStartEnabled && !next.auto.disabledAt && next.currentEvent.status === "waiting" && !goalIsOpen(openGoal);
      if (canAuto) {
        const prepared = prepareProcessStart(next, note, { now, trigger: "auto" });
        next = prepared.state;
        delivery = { note, event: prepared.event, attempt: prepared.attempt };
      }
    }
    if (deferredReady && !delivery && note.startPolicy === "auto" && autoStartEnabled && !next.auto.disabledAt && !goalIsOpen(openGoal)) {
      const prepared = prepareProcessStart(next, note, { now, trigger: "auto" });
      next = prepared.state;
      delivery = { note, event: prepared.event, attempt: prepared.attempt };
    }
    const attempt = next.currentEvent?.attempts?.find((item) => item.id === next.currentEvent?.currentAttemptId);
    if (next.currentEvent?.status === "starting" && attempt && ["prepared", "delivery-pending", "delivered"].includes(attempt.status) && new Date(attempt.deadlineAt).getTime() <= now.getTime()) {
      attempt.status = "expired";
      attempt.updatedAt = now.toISOString();
      next.currentEvent.status = "did-not-start";
      if (attempt.trigger === "auto" && !next.currentEvent.failureCounted) {
        next.currentEvent.failureCounted = true;
        next.auto.consecutiveFailedSlots += 1;
        if (next.auto.consecutiveFailedSlots >= PROCESS_AUTO_FAILURE_LIMIT) next.auto.disabledAt = now.toISOString();
      }
    }
    next.lastReason = outcome.reason;
    if (JSON.stringify(next) !== JSON.stringify(stored)) await writeProcessState(stateRoot, note.area, note.slug, bump(next, now));
    return { note, due: outcome.due, reason: outcome.reason, state: next };
    });
    if (!result) continue;
    if (delivery && requestStart) {
      let outcome;
      try { outcome = await requestStart(delivery); }
      catch (error) { outcome = { ok: false, code: error.code, error: String(error.message ?? error) }; }
      result.state = await withProcessLock(delivery.note.area, delivery.note.slug, async () => {
        const current = normalizeProcessState(await readProcessState(stateRoot, delivery.note.area, delivery.note.slug), delivery.note, now);
        const settled = settleProcessDelivery(current, delivery.attempt.id, outcome, now);
        await writeProcessState(stateRoot, delivery.note.area, delivery.note.slug, settled);
        return settled;
      });
    }
    const recoverable = recoverableProcessStart(result.state);
    if (recoverable && recoverStart) {
      try {
        result.state = await recoverStart({ note: result.note, event: recoverable.event, attempt: recoverable.attempt });
      } catch (error) {
        result.recoveryError = { code: error.code ?? "process-start-recovery-failed", message: String(error.message ?? error) };
      }
    }
    results.push(result);
  }
  return results;
}

/**
 * One process as the Area page, Work, and `tangent process list` show it.
 * `brainLive` says whether the Area brain runs now, so a due process whose
 * note waits in the inbox reads `Due, brain not running`.
 */
export function processView(note, state, now = new Date(), { brainLive = false, openGoal = null, areaHidden = "" } = {}) {
  const runtime = normalizeProcessState(state, note, now);
  const nextRunAt = note.schedule
    ? nextSlotAfter(note.schedule, now)?.toISOString() ?? null
    : note.loop
      ? (instant(state.lastNoticeAt) ? new Date(instant(state.lastNoticeAt).getTime() + note.everyMs) : now).toISOString()
    : note.everyMs ? new Date((instant(state.lastCheckedAt)?.getTime() ?? now.getTime()) + (instant(state.lastCheckedAt) ? note.everyMs : 0)).toISOString() : null;
  const goalOpen = openGoal && goalIsOpen(openGoal);
  const event = runtime.currentEvent;
  const noticeWaits = Boolean(event && !["finished", "skipped", "running"].includes(event.status));
  const occurrenceVisible = Boolean(note.error || (!note.loop && note.status === "active" && !areaHidden && WORK_PROCESS_EVENT_STATES.has(event?.status)));
  const dismissed = runtime.dismissedOccurrence;
  const restoreAvailable = Boolean(dismissed?.event?.id && event?.id === dismissed.event.id && event.status === "skipped");
  const restoreReason = !dismissed?.event?.id ? "There is no dismissed occurrence to restore."
    : restoreAvailable ? null : "A newer occurrence exists.";
  let stateWord = "Waiting";
  let stateDetail = runtime.lastReason ?? "";
  if (note.error) stateWord = "Broken note";
  else if (note.status === "paused") stateWord = "Paused";
  else if (areaHidden) stateWord = `Area ${areaHidden}`;
  else if (note.loop) stateWord = brainLive ? "Loop" : "Waiting for brain";
  else if (goalOpen || event?.status === "running") stateWord = "Running";
  else if (event?.status === "starting") { stateWord = "Starting"; stateDetail = `Sent to the brain at ${event.attempts?.find((item) => item.id === event.currentAttemptId)?.requestedAt ?? event.updatedAt}.`; }
  else if (event?.status === "did-not-start") { stateWord = "Did not start"; stateDetail = `The brain was told at ${event.attempts?.find((item) => item.id === event.currentAttemptId)?.requestedAt ?? event.updatedAt} and started no Job.`; }
  else if (event?.status === "could-not-start") { stateWord = "Could not start"; stateDetail = event.attempts?.find((item) => item.id === event.currentAttemptId)?.error?.message ?? "The start request failed."; }
  else if (runtime.auto.disabledAt) { stateWord = "Needs you"; stateDetail = `Auto-start stopped after ${runtime.auto.consecutiveFailedSlots} failed runs.`; }
  else if (event?.status === "deferred") stateWord = `Deferred to ${event.deferredUntil}`;
  else if (event?.status === "waiting") stateWord = "Start it?";
  else if (event?.status === "skipped" && dismissed?.event?.id === event.id) { stateWord = "Dismissed"; stateDetail = "The Process definition is active. The next due occurrence returns."; }
  const startReason = note.error ? note.error : note.status === "paused" ? "Resume the Process first." : areaHidden ? `Reopen the Area first.` : ["starting", "running"].includes(event?.status) ? "The Process is already starting or running." : null;
  const dismissReason = note.loop ? "A loop has no bounded occurrence."
    : acceptedProcessAttempt(event) || ["starting", "running"].includes(event?.status) ? "This occurrence already started."
      : DISMISSIBLE_PROCESS_EVENT_STATES.has(event?.status) ? null : "This occurrence is no longer actionable.";
  return {
    area: note.area, slug: note.slug, file: note.file, title: note.title, status: note.status,
    when: describeWhen(note), schedule: note.schedule?.text ?? null, probe: note.when, every: note.every,
    launch: note.launch, path: note.path, verify: note.verify, error: note.error, loop: note.loop, body: note.loop ? note.body : undefined,
    nextRunAt: note.status === "paused" || areaHidden ? null : nextRunAt,
    lastRunAt: state.lastDueAt ?? null, lastNoticeAt: state.lastNoticeAt ?? null, lastCheckedAt: state.lastCheckedAt ?? null,
    startPolicy: note.startPolicy, revision: runtime.revision, eventId: event?.id ?? null, eventRevision: event?.revision ?? null,
    occurrenceVisible, dismissedEventId: dismissed?.event?.id ?? null, lastOccurrenceOutcome: dismissed?.event?.id ? "dismissed" : runtime.lastEvent?.outcome ?? null,
    restoreAvailable, restoreReason, conditionRearmWaiting: Boolean(runtime.whenRearm.waitingForFalse),
    stateDetail, missedCount: event?.missed?.count ?? 0, missedSince: event?.missed?.since ?? null,
    lastGoalFile: event?.goalFile ?? runtime.lastGoalFile ?? null, lastJobRun: event?.job?.run ?? null,
    currentAgentSession: event?.job?.agentSession ?? null,
    actionReasons: { start: startReason, retry: startReason, defer: startReason, dismiss: dismissReason, restore: restoreReason, readRun: (event?.goalFile ?? runtime.lastGoalFile) ? null : "This Process has no run yet.", stop: event?.job?.agentSession ? null : "No Process Agent is running." },
    lastReason: runtime.lastReason ?? null,
    goalOpen: Boolean(goalOpen), due: !note.loop && noticeWaits, brainLive, state: stateWord,
  };
}

/**
 * Rewrites the `status:` line of a process note. The caller commits the
 * file through the vault so the change has provenance.
 */
export function withProcessStatus(text, status) {
  if (!["active", "paused"].includes(status)) throw new Error("status must be active or paused");
  const match = String(text).match(/^---\n[\s\S]*?\n---/);
  if (!match) throw new Error("the process note has no frontmatter");
  const block = /^status:.*$/m.test(match[0]) ? match[0].replace(/^status:.*$/m, `status: ${status}`) : match[0].replace(/\n---$/, `\nstatus: ${status}\n---`);
  return String(text).replace(match[0], () => block);
}

/** True when the vault file exists, for callers that resolve a slug. */
export function processFileExists(treesRoot, file) {
  return existsSync(path.join(treesRoot, file));
}
