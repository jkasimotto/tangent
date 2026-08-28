import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverProcesses, dueNotice, evaluateProcess, goalNamesProcess, loopNotice, processView, readProcessState, sweepProcesses, withProcessStatus } from "./process-scheduler.mjs";
import { parseProcessNote } from "./process-note.mjs";

/** A parsed scheduled process for one Area. */
function scheduled(extra = "") {
  return parseProcessNote(`---\ntype: process\nschedule: daily 09:00 UTC\n${extra}---\n# Rebase staging\n\nRebase it.\n`, { file: "neara/pgande/process-rebase.md", area: "neara/pgande" });
}

/** A parsed probe process for one Area. */
function probed() {
  return parseProcessNote("---\ntype: process\nwhen: test -f /tmp/red\nevery: 30m\n---\nFix the red build.\n", { file: "otto/dnd/process-red-build.md", area: "otto/dnd" });
}

test("the inbox note names the command the brain runs, with path, launch, and verify", () => {
  const note = scheduled("path: /Users/j/wt\nlaunch: pi-code --model glm\nverify: yes\n");
  assert.equal(
    dueNotice(note, "/vault"),
    'Process rebase is due. Start it with: tangent goal create --area neara/pgande --title "Rebase staging" --start --instruction-file /vault/neara/pgande/process-rebase.md --path /Users/j/wt --launch "pi-code --model glm" --verify',
  );
  assert.equal(dueNotice(scheduled(), "/vault"), 'Process rebase is due. Start it with: tangent goal create --area neara/pgande --title "Rebase staging" --start --instruction-file /vault/neara/pgande/process-rebase.md');
});

test("a scheduled process fires once per slot, coalesces missed slots, and never fires for slots before it was seen", async () => {
  const note = scheduled();
  const seen = { firstSeenAt: "2026-08-25T10:00:00Z" };
  const before = await evaluateProcess({ note, state: seen, now: new Date("2026-08-25T12:00:00Z") });
  assert.equal(before.due, false, "the 09:00 slot before first sight does not fire");
  const three = await evaluateProcess({ note, state: seen, now: new Date("2026-08-28T12:00:00Z") });
  assert.equal(three.due, true);
  assert.equal(three.slot.toISOString(), "2026-08-28T09:00:00.000Z", "three missed days fire once, for the latest slot");
  const again = await evaluateProcess({ note, state: { ...seen, lastDueAt: "2026-08-28T09:00:00.000Z" }, now: new Date("2026-08-28T13:00:00Z") });
  assert.equal(again.due, false);
  assert.match(again.reason, /next slot 2026-08-29T09:00:00/);
});

test("a when: process runs its probe only every: so often and is due on exit 0", async () => {
  const note = probed();
  const codes = [];
  /** Records the probe run and returns the next exit code. */
  const runProbe = async () => { codes.push(1); return codes.length === 1 ? 1 : 0; };
  const first = await evaluateProcess({ note, state: {}, now: new Date("2026-08-28T12:00:00Z"), runProbe });
  assert.equal(first.due, false);
  assert.equal(first.exitCode, 1);
  const early = await evaluateProcess({ note, state: { lastCheckedAt: "2026-08-28T12:00:00Z" }, now: new Date("2026-08-28T12:10:00Z"), runProbe });
  assert.equal(early.checked, undefined, "the probe waits for every:");
  assert.match(early.reason, /next check/);
  const due = await evaluateProcess({ note, state: { lastCheckedAt: "2026-08-28T12:00:00Z" }, now: new Date("2026-08-28T12:31:00Z"), runProbe });
  assert.equal(due.due, true);
  assert.equal(codes.length, 2);
});

test("a due process is skipped while the Goal it created is still open, and paused notes never fire", async () => {
  const note = scheduled();
  const hidden = await evaluateProcess({ note, state: { firstSeenAt: "2026-08-20T00:00:00Z" }, now: new Date("2026-08-28T12:00:00Z"), areaHidden: "archived" });
  assert.equal(hidden.due, false, "a process under an archived Area is never due");
  assert.equal(hidden.reason, "Area is archived");
  assert.equal(processView(note, {}, new Date("2026-08-28T12:00:00Z"), { areaHidden: "done" }).state, "Area done");
  const skipped = await evaluateProcess({ note, state: { firstSeenAt: "2026-08-20T00:00:00Z" }, now: new Date("2026-08-28T12:00:00Z"), openGoal: { file: "neara/pgande/goal-rebase.md", status: "active" } });
  assert.equal(skipped.due, false);
  assert.match(skipped.reason, /goal-rebase.md is still open/);
  const closed = await evaluateProcess({ note, state: { firstSeenAt: "2026-08-20T00:00:00Z" }, now: new Date("2026-08-28T12:00:00Z"), openGoal: { file: "neara/pgande/goal-rebase.md", status: "done" } });
  assert.equal(closed.due, true);
  const paused = await evaluateProcess({ note: scheduled("status: paused\n"), state: { firstSeenAt: "2026-08-20T00:00:00Z" }, now: new Date("2026-08-28T12:00:00Z") });
  assert.equal(paused.reason, "paused");
});

test("a sweep discovers process notes, writes state per process, and sends one note per due process", async () => {
  const trees = await mkdtemp(path.join(os.tmpdir(), "tangent-process-trees-"));
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "tangent-process-state-"));
  try {
    await mkdir(path.join(trees, "neara", "pgande"), { recursive: true });
    await mkdir(path.join(trees, "otto", "dnd"), { recursive: true });
    await writeFile(path.join(trees, "neara", "pgande", "process-rebase.md"), "---\ntype: process\nschedule: daily 09:00 UTC\n---\n# Rebase staging\n\nRebase it.\n", "utf8");
    await writeFile(path.join(trees, "otto", "dnd", "process-red-build.md"), "---\ntype: process\nwhen: test -f /tmp/red\nevery: 30m\n---\nFix the red build.\n", "utf8");
    await writeFile(path.join(trees, "otto", "dnd", "process-broken.md"), "---\ntype: process\n---\nNo schedule.\n", "utf8");
    const found = await discoverProcesses(trees);
    assert.deepEqual(found.map((note) => note.slug), ["rebase", "broken", "red-build"]);
    assert.deepEqual((await discoverProcesses(trees, { area: "otto/dnd" })).map((note) => note.slug), ["broken", "red-build"]);
    const notices = [];
    /** Collects the inbox notes the sweep sends. */
    const notify = async (area, text, options) => { notices.push({ area, text, options }); };
    /** The probe reports work. */
    const runProbe = async () => 0;
    /** No process has an open Goal yet. */
    const openGoalFor = async () => null;
    const first = await sweepProcesses({ treesRoot: trees, stateRoot, now: new Date("2026-08-28T12:00:00Z"), runProbe, openGoalFor, notify });
    assert.deepEqual(first.map((item) => [item.note.slug, item.due]), [["rebase", false], ["broken", false], ["red-build", true]]);
    assert.equal(notices.length, 1);
    assert.match(notices[0].text, /^Process red-build is due\. Start it with: tangent goal create --area otto\/dnd --title "Red Build" --start --instruction-file /);
    assert.equal(notices[0].options.idempotencyKey, "process:otto/dnd:red-build:2026-08-28T12:00:00.000Z");
    const rebaseState = await readProcessState(stateRoot, "neara/pgande", "rebase");
    assert.equal(rebaseState.firstSeenAt, "2026-08-28T12:00:00.000Z");
    assert.equal(rebaseState.lastDueAt, undefined);
    const second = await sweepProcesses({ treesRoot: trees, stateRoot, now: new Date("2026-08-29T09:00:30Z"), runProbe, openGoalFor, notify });
    assert.equal(second.find((item) => item.note.slug === "rebase").due, true);
    assert.match(second.find((item) => item.note.slug === "red-build").reason, /waits for the brain/);
    assert.equal(notices.length, 2, "a probe process with an unanswered note is not noted again");
    assert.equal((await readProcessState(stateRoot, "neara/pgande", "rebase")).lastDueAt, "2026-08-29T09:00:00.000Z");
    /** The rebase Goal is open now. */
    const openRebase = async (note) => (note.slug === "rebase" ? { file: "neara/pgande/goal-rebase-staging.md", status: "active" } : null);
    const third = await sweepProcesses({ treesRoot: trees, stateRoot, now: new Date("2026-08-30T09:00:30Z"), runProbe, openGoalFor: openRebase, notify });
    assert.match(third.find((item) => item.note.slug === "rebase").reason, /still open/);
    const state = await readProcessState(stateRoot, "neara/pgande", "rebase");
    assert.equal(state.lastGoalFile, "neara/pgande/goal-rebase-staging.md");
    const view = processView(found[0], state, new Date("2026-08-30T10:00:00Z"), { brainLive: false, openGoal: { file: state.lastGoalFile, status: "active" } });
    assert.equal(view.state, "Running");
    assert.equal(view.nextRunAt, "2026-08-31T09:00:00.000Z");
    const waiting = processView(found[0], { lastNoticeAt: "2026-08-29T09:00:30.000Z", lastDueAt: "2026-08-29T09:00:00.000Z" }, new Date("2026-08-29T10:00:00Z"), { brainLive: false });
    assert.equal(waiting.state, "Due, brain not running");
    assert.equal(processView(found[0], waiting, new Date("2026-08-29T10:00:00Z"), { brainLive: true }).state, "Due, brain told");
    assert.equal(processView(found[1], {}, new Date()).state, "Broken note");
  } finally {
    await rm(trees, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("pause and resume rewrite only the status line", () => {
  const text = "---\ntype: process\nschedule: daily 09:00\n---\nBody.\n";
  const paused = withProcessStatus(text, "paused");
  assert.equal(paused, "---\ntype: process\nschedule: daily 09:00\nstatus: paused\n---\nBody.\n");
  assert.equal(withProcessStatus(paused, "active"), "---\ntype: process\nschedule: daily 09:00\nstatus: active\n---\nBody.\n");
  assert.throws(() => withProcessStatus(text, "off"), /active or paused/);
});

test("a Goal names its process by frontmatter file, by slug, or by title", () => {
  const note = scheduled();
  assert.equal(goalNamesProcess({ process: "neara/pgande/process-rebase.md", title: "Anything" }, note), true, "the note file");
  assert.equal(goalNamesProcess({ process: "rebase", title: "Anything" }, note), true, "the slug");
  assert.equal(goalNamesProcess({ process: "process-rebase", title: "Anything" }, note), true, "the file stem");
  assert.equal(goalNamesProcess({ process: null, title: "Rebase staging" }, note), true, "the title, when the brain started it without --instruction-file");
  assert.equal(goalNamesProcess({ process: null, title: "rebase STAGING " }, note), true, "the title, whatever its case");
  assert.equal(goalNamesProcess({ process: "neara/pgande/process-other.md", title: "Other work" }, note), false);
  assert.equal(goalNamesProcess({ process: null, title: "Rebase" }, note), false, "a shorter title is another Goal");
});

/** A parsed loop for one Area. */
function looped() {
  return parseProcessNote("---\ntype: process\nevery: 20m\n---\nLook at the open questions.\n", { file: "neara/pgande/process-nudge.md", area: "neara/pgande" });
}

test("a loop ticks only while the brain runs, keeps one message in flight, and fires anyway after three intervals", async () => {
  const note = looped();
  /** Noon UTC on 2026-08-28 plus so many minutes. */
  const at = (minutes) => new Date(Date.UTC(2026, 7, 28, 12, minutes));
  assert.equal((await evaluateProcess({ note, state: {}, now: at(0), brainLive: false })).reason, "brain not running");
  const first = await evaluateProcess({ note, state: {}, now: at(0), brainLive: true });
  assert.deepEqual([first.due, first.reason], [true, "first tick"]);
  const sent = { lastNoticeAt: at(0).toISOString(), lastDeliveredAt: at(0).toISOString() };
  assert.equal((await evaluateProcess({ note, state: sent, now: at(10), brainLive: true })).due, false);
  assert.equal((await evaluateProcess({ note, state: sent, now: at(20), brainLive: true })).due, true);
  const undelivered = { lastNoticeAt: at(0).toISOString() };
  assert.match((await evaluateProcess({ note, state: undelivered, now: at(20), brainLive: true })).reason, /waits for the composer/);
  assert.match((await evaluateProcess({ note, state: undelivered, now: at(60), brainLive: true })).reason, /never reached the brain/);
  assert.equal((await evaluateProcess({ note: { ...note, status: "paused" }, state: {}, now: at(0), brainLive: true })).reason, "paused");
  assert.equal(loopNotice(note), "Loop nudge (every 20m): Look at the open questions.");
  const live = processView(note, sent, at(5), { brainLive: true });
  assert.deepEqual([live.state, live.when, live.nextRunAt, live.due, live.loop], ["Loop", "Every 20m, to the brain", at(20).toISOString(), false, true]);
  assert.equal(processView(note, {}, at(5), { brainLive: false }).state, "Waiting for brain");
});

test("a sweep sends a loop its body and records delivery only when a live brain took it", async () => {
  const trees = await mkdtemp(path.join(os.tmpdir(), "tangent-loop-trees-"));
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "tangent-loop-state-"));
  try {
    await mkdir(path.join(trees, "neara", "pgande"), { recursive: true });
    await writeFile(path.join(trees, "neara", "pgande", "process-nudge.md"), "---\ntype: process\nevery: 20m\n---\nLook at the open questions.\n", "utf8");
    const notices = [];
    let addressed = false;
    /** Collects the messages the sweep sends and answers like notifyBrain. */
    const notify = async (area, text, options) => { notices.push({ area, text, options }); return addressed; };
    /** No probe runs for a loop. */
    const runProbe = async () => 1;
    /** A loop has no Goal. */
    const openGoalFor = async () => null;
    /** The brain is away. */
    const noBrain = async () => false;
    /** The brain runs. */
    const brain = async () => true;
    const base = { treesRoot: trees, stateRoot, runProbe, openGoalFor, notify };
    await sweepProcesses({ ...base, now: new Date("2026-08-28T12:00:00Z"), brainLive: noBrain });
    assert.equal(notices.length, 0, "no brain, no tick");
    await sweepProcesses({ ...base, now: new Date("2026-08-28T12:00:10Z"), brainLive: brain });
    assert.equal(notices.length, 1);
    assert.equal(notices[0].text, "Loop nudge (every 20m): Look at the open questions.");
    assert.equal(notices[0].options.idempotencyKey, "process:neara/pgande:nudge:2026-08-28T12:00:10.000Z");
    let state = await readProcessState(stateRoot, "neara/pgande", "nudge");
    assert.equal(state.lastNoticeAt, "2026-08-28T12:00:10.000Z");
    assert.equal(state.lastDeliveredAt, undefined);
    await sweepProcesses({ ...base, now: new Date("2026-08-28T12:20:10Z"), brainLive: brain });
    assert.equal(notices.length, 1, "an undelivered tick holds the next one");
    addressed = true;
    await sweepProcesses({ ...base, now: new Date("2026-08-28T13:00:10Z"), brainLive: brain });
    assert.equal(notices.length, 2, "three intervals later it fires anyway");
    state = await readProcessState(stateRoot, "neara/pgande", "nudge");
    assert.equal(state.lastDeliveredAt, "2026-08-28T13:00:10.000Z");
    assert.equal(state.lastGoalFile, undefined);
  } finally {
    await rm(trees, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});
