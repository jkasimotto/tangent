import assert from "node:assert/strict";
import test from "node:test";
import { describeWhen, latestSlotAtOrBefore, nextSlotAfter, parseEvery, parseProcessNote, parseSchedule, processSlugFromFile } from "./process-note.mjs";

test("a process note parses its frontmatter, title, and body", () => {
  const note = parseProcessNote("---\ntype: process\nstatus: active\nschedule: weekdays 08:30\nlaunch: claude/opus\npath: ~/Projects/dnd\nverify: yes\n---\n\n# Rebase staging\n\nRebase the branch.\n", { file: "neara/pgande/process-rebase.md", area: "neara/pgande" });
  assert.equal(note.error, null);
  assert.equal(note.slug, "rebase");
  assert.equal(note.title, "Rebase staging");
  assert.equal(note.status, "active");
  assert.deepEqual(note.schedule.days, [1, 2, 3, 4, 5]);
  assert.equal(note.schedule.text, "Weekdays 08:30");
  assert.equal(note.launch, "claude/opus");
  assert.equal(note.path, "~/Projects/dnd");
  assert.equal(note.verify, true);
  assert.equal(note.body, "# Rebase staging\n\nRebase the branch.");
  assert.equal(describeWhen(note), "Weekdays 08:30");
});

test("a when: process needs every: and describes its probe", () => {
  const note = parseProcessNote("---\ntype: process\nwhen: test -f /tmp/red\nevery: 30m\n---\nFix the red build.\n", { file: "otto/dnd/process-red-build.md", area: "otto/dnd" });
  assert.equal(note.error, null);
  assert.equal(note.everyMs, 30 * 60_000);
  assert.equal(note.title, "Red Build");
  assert.equal(describeWhen(note), "Every 30m while `test -f /tmp/red` exits 0");
  const missing = parseProcessNote("---\ntype: process\nwhen: true\n---\nBody.\n", { file: "otto/dnd/process-x.md", area: "otto/dnd" });
  assert.match(missing.error, /every:/);
});

test("a broken note keeps its slug and says what is wrong", () => {
  assert.match(parseProcessNote("---\ntype: goal\nschedule: daily 09:00\n---\nBody.\n", { file: "a/process-x.md", area: "a" }).error, /type: process/);
  assert.match(parseProcessNote("---\ntype: process\n---\nBody.\n", { file: "a/process-x.md", area: "a" }).error, /schedule: .* or when:/);
  assert.match(parseProcessNote("---\ntype: process\nschedule: daily 09:00\nwhen: true\nevery: 1h\n---\nBody.\n", { file: "a/process-x.md", area: "a" }).error, /not both/);
  assert.match(parseProcessNote("---\ntype: process\nschedule: daily 09:00\nstatus: off\n---\nBody.\n", { file: "a/process-x.md", area: "a" }).error, /active or paused/);
  assert.match(parseProcessNote("---\ntype: process\nschedule: daily 09:00\n---\n", { file: "a/process-x.md", area: "a" }).error, /body is empty/);
  assert.equal(processSlugFromFile("a/goal-x.md"), null);
});

test("schedule words cover daily, weekdays, day names, lists, and UTC", () => {
  assert.equal(parseSchedule("daily 09:00").text, "Daily 09:00");
  assert.equal(parseSchedule("weekdays 08:30").text, "Weekdays 08:30");
  assert.equal(parseSchedule("mondays 10:00").text, "Mondays 10:00");
  assert.equal(parseSchedule("mon,thu 16:00").text, "Mondays, Thursdays 16:00");
  assert.equal(parseSchedule("daily 07:30, 16:00, 19:30 UTC").text, "Daily 07:30, 16:00, 19:30 UTC");
  assert.equal(parseSchedule("09:00").text, "Daily 09:00");
  assert.throws(() => parseSchedule("daily"), /at least one time/);
  assert.throws(() => parseSchedule("daily 25:00"), /not a time/);
  assert.throws(() => parseSchedule("fortnightly 09:00"), /not a day/);
  assert.throws(() => parseEvery("soon"), /duration/);
  assert.equal(parseEvery("2h"), 7_200_000);
});

test("slots are computed in UTC and missed slots coalesce to the latest", () => {
  const schedule = parseSchedule("weekdays 09:00 UTC");
  const friday = new Date("2026-08-28T12:00:00Z");
  assert.equal(latestSlotAtOrBefore(schedule, friday).toISOString(), "2026-08-28T09:00:00.000Z");
  assert.equal(nextSlotAfter(schedule, friday).toISOString(), "2026-08-31T09:00:00.000Z");
  const sunday = new Date("2026-08-30T12:00:00Z");
  assert.equal(latestSlotAtOrBefore(schedule, sunday).toISOString(), "2026-08-28T09:00:00.000Z");
  const three = parseSchedule("daily 07:30, 16:00, 19:30 UTC");
  assert.equal(latestSlotAtOrBefore(three, new Date("2026-08-28T16:05:00Z")).toISOString(), "2026-08-28T16:00:00.000Z");
  assert.equal(nextSlotAfter(three, new Date("2026-08-28T16:05:00Z")).toISOString(), "2026-08-28T19:30:00.000Z");
  assert.equal(nextSlotAfter(three, new Date("2026-08-28T20:00:00Z")).toISOString(), "2026-08-29T07:30:00.000Z");
});
