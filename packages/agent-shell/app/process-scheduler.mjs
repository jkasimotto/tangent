// The server is the scheduler (ADR-0043, D17 and D18). Every 10 s it reads
// each `process-<slug>.md` in the vault, decides whether the process is due,
// and when it is, writes one note to the Area brain inbox that says how to
// start it. Tangent starts no worker itself. A loop note (`every:` alone)
// instead sends its body to a live brain every so often. Run state lives in
// `~/.tangent/agent-shell/processes/<area>/<slug>.json`.

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { describeWhen, latestSlotAtOrBefore, nextSlotAfter, parseProcessNote, processSlugFromFile } from "./process-note.mjs";

const TREE_SKIP = new Set([".git", ".obsidian", "shared", "node_modules"]);
const OPEN_STATUSES = new Set(["open", "active", "verify"]);

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
export function dueNotice(note, treesRoot) {
  const file = path.join(treesRoot, note.file);
  const flags = [note.path ? ` --path ${note.path}` : "", note.launch ? ` --launch ${JSON.stringify(note.launch)}` : "", note.verify ? " --verify" : ""].join("");
  return `Process ${note.slug} is due. Start it with: tangent goal create --area ${note.area} --title ${JSON.stringify(note.title)} --start --instruction-file ${file}${flags}`;
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
  return OPEN_STATUSES.has(String(goal?.status ?? "open"));
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
export async function sweepProcesses({ treesRoot, stateRoot, now = new Date(), runProbe, openGoalFor, notify, hiddenAreaStatus = async () => "", brainLive = async () => true }) {
  const results = [];
  for (const note of await discoverProcesses(treesRoot)) {
    const state = await readProcessState(stateRoot, note.area, note.slug);
    const next = { ...state };
    if (!next.firstSeenAt) next.firstSeenAt = now.toISOString();
    const openGoal = await openGoalFor(note);
    if (openGoal) {
      next.lastGoalFile = openGoal.file;
      if (!next.lastGoalAt || (next.lastNoticeAt && next.lastGoalAt < next.lastNoticeAt)) next.lastGoalAt = now.toISOString();
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
    if (outcome.due) {
      const slotAt = (outcome.slot ?? now).toISOString();
      next.lastDueAt = slotAt;
      next.lastNoticeAt = now.toISOString();
      const addressed = await notify(note.area, note.loop ? loopNotice(note) : dueNotice(note, treesRoot), { idempotencyKey: `process:${note.area}:${note.slug}:${slotAt}` });
      if (note.loop && addressed) next.lastDeliveredAt = now.toISOString();
    }
    next.lastReason = outcome.reason;
    if (JSON.stringify(next) !== JSON.stringify(state)) await writeProcessState(stateRoot, note.area, note.slug, next);
    results.push({ note, due: outcome.due, reason: outcome.reason, state: next });
  }
  return results;
}

/**
 * One process as the Area page, Work, and `tangent process list` show it.
 * `brainLive` says whether the Area brain runs now, so a due process whose
 * note waits in the inbox reads `Due, brain not running`.
 */
export function processView(note, state, now = new Date(), { brainLive = false, openGoal = null, areaHidden = "" } = {}) {
  const nextRunAt = note.schedule
    ? nextSlotAfter(note.schedule, now)?.toISOString() ?? null
    : note.loop
      ? (instant(state.lastNoticeAt) ? new Date(instant(state.lastNoticeAt).getTime() + note.everyMs) : now).toISOString()
    : note.everyMs ? new Date((instant(state.lastCheckedAt)?.getTime() ?? now.getTime()) + (instant(state.lastCheckedAt) ? note.everyMs : 0)).toISOString() : null;
  const goalOpen = openGoal && goalIsOpen(openGoal);
  const noticeWaits = Boolean(state.lastNoticeAt) && !goalOpen && (!state.lastGoalAt || state.lastGoalAt < state.lastNoticeAt);
  let stateWord = "Waiting";
  if (note.error) stateWord = "Broken note";
  else if (note.status === "paused") stateWord = "Paused";
  else if (areaHidden) stateWord = `Area ${areaHidden}`;
  else if (note.loop) stateWord = brainLive ? "Loop" : "Waiting for brain";
  else if (goalOpen) stateWord = "Running";
  else if (noticeWaits) stateWord = brainLive ? "Due, brain told" : "Due, brain not running";
  return {
    area: note.area, slug: note.slug, file: note.file, title: note.title, status: note.status,
    when: describeWhen(note), schedule: note.schedule?.text ?? null, probe: note.when, every: note.every,
    launch: note.launch, path: note.path, verify: note.verify, error: note.error, loop: note.loop, body: note.loop ? note.body : undefined,
    nextRunAt: note.status === "paused" || areaHidden ? null : nextRunAt,
    lastRunAt: state.lastDueAt ?? null, lastNoticeAt: state.lastNoticeAt ?? null, lastCheckedAt: state.lastCheckedAt ?? null,
    lastGoalFile: state.lastGoalFile ?? null, lastReason: state.lastReason ?? null,
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
