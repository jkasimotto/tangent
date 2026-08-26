import { test } from "node:test";
import assert from "node:assert/strict";

import {
  contextReminderText,
  contextRepeatText,
  continuationSection,
  continuationSessionName,
  reminderDue
} from "./context-handover.mjs";

const THRESHOLD = 300_000;

test("reminderDue is null below the threshold", () => {
  assert.equal(reminderDue({ fill: { usedTokens: 299_999, windowTokens: 1_000_000 }, thresholdTokens: THRESHOLD, reminders: undefined }), null);
});

test("reminderDue fires 'first' exactly once at the threshold", () => {
  const fill = { usedTokens: 300_000, windowTokens: 1_000_000 };
  assert.equal(reminderDue({ fill, thresholdTokens: THRESHOLD, reminders: undefined }), "first");
  assert.equal(reminderDue({ fill, thresholdTokens: THRESHOLD, reminders: { firstAt: "2026-08-23T10:00:00.000Z", repeatAt: null } }), null);
});

test("reminderDue fires 'repeat' once carried context passes a tenth past the threshold", () => {
  const firstOnly = { firstAt: "2026-08-23T10:00:00.000Z", repeatAt: null };
  assert.equal(reminderDue({ fill: { usedTokens: 329_999, windowTokens: 1_000_000 }, thresholdTokens: THRESHOLD, reminders: firstOnly }), null);
  assert.equal(reminderDue({ fill: { usedTokens: 330_000, windowTokens: 1_000_000 }, thresholdTokens: THRESHOLD, reminders: firstOnly }), "repeat");
  assert.equal(reminderDue({ fill: { usedTokens: 330_000, windowTokens: 1_000_000 }, thresholdTokens: THRESHOLD, reminders: { firstAt: "2026-08-23T10:00:00.000Z", repeatAt: "2026-08-23T11:00:00.000Z" } }), null, "a repeat that already fired does not fire again");
  assert.equal(reminderDue({ fill: { usedTokens: 330_000, windowTokens: 1_000_000 }, thresholdTokens: THRESHOLD, reminders: undefined }), "first", "past-repeat fill with no recorded first still fires first, since first has not fired yet");
});

test("reminderDue is null for a small-window model whose window is at or under the threshold", () => {
  assert.equal(reminderDue({ fill: { usedTokens: 300_000, windowTokens: 300_000 }, thresholdTokens: THRESHOLD, reminders: undefined }), null);
  assert.equal(reminderDue({ fill: { usedTokens: 200_000, windowTokens: 200_000 }, thresholdTokens: THRESHOLD, reminders: undefined }), null);
});

test("reminderDue is null for unknown fill", () => {
  assert.equal(reminderDue({ fill: null, thresholdTokens: THRESHOLD, reminders: undefined }), null);
  assert.equal(reminderDue({ fill: { usedTokens: NaN, windowTokens: 1_000_000 }, thresholdTokens: THRESHOLD, reminders: undefined }), null);
});

test("reminderDue: a compaction dip below the threshold never re-arms a level that already fired", () => {
  const alreadyFired = { firstAt: "2026-08-23T10:00:00.000Z", repeatAt: null };
  assert.equal(reminderDue({ fill: { usedTokens: 50_000, windowTokens: 1_000_000 }, thresholdTokens: THRESHOLD, reminders: alreadyFired }), null);
});

test("contextReminderText and contextRepeatText route context risk to the exact controller", () => {
  const reminder = contextReminderText({ usedTokens: 310_000, windowTokens: 1_000_000, subject: "step" });
  assert.match(reminder, /Your context is at 310k of 1000k \(31%\)/);
  assert.match(reminder, /submit a typed context-risk report/);
  assert.match(reminder, /exact Area brain chooses and starts any fresh attempt/);

  const repeat = contextRepeatText({ usedTokens: 331_000, thresholdTokens: THRESHOLD, subject: "Goal" });
  assert.match(repeat, /well past 300k tokens \(331k\)/);
  assert.match(repeat, /Submit a typed context-risk report now/);
  assert.match(repeat, /do not replace yourself/);
});

test("continuationSessionName: fresh, second, and collision cases", () => {
  // normName (matching pipelineStepSessionName and brainSessionName)
  // collapses "--" separators to a single dash, so a real session name is
  // single-dash even though the design prose writes it with double dashes.
  assert.equal(continuationSessionName("tangent-x-s2", new Set()), "tangent-x-s2-g2");
  assert.equal(continuationSessionName("tangent-x-s2", new Set(["tangent-x-s2-g2"])), "tangent-x-s2-g3");
  assert.equal(continuationSessionName("tangent-x-s2-g2", new Set(["tangent-x-s2-g2"])), "tangent-x-s2-g3", "strips the existing generation suffix before deriving the next one");
  assert.equal(continuationSessionName("tangent-x-s2-g2-r3", new Set(["tangent-x-s2-g2"])), "tangent-x-s2-g3", "also strips a collision -r suffix");
});

test("continuationSection orders entries and skips failed ones", () => {
  const entries = [
    { session: "tangent--x--s2", facts: "did part 1" },
    { session: "tangent--x--s2--g2", facts: "never arrived", failed: true },
    { session: "tangent--x--s2--g3", facts: "did part 2" }
  ];
  const section = continuationSection({ index: 2, total: 3, entries, subject: "step" });
  assert.match(section, /^## Continuing this step/);
  assert.match(section, /You are a fresh session continuing step 2 of 3\./);
  assert.match(section, /### Continuation 1 \(from tangent--x--s2\)\n\ndid part 1/);
  assert.match(section, /### Continuation 2 \(from tangent--x--s2--g3\)\n\ndid part 2/);
  assert.doesNotMatch(section, /never arrived/);
  assert.doesNotMatch(section, /tangent--x--s2--g2\)/);
  assert.match(section, /The working tree already holds that session's uncommitted work\. Continue; do not repeat commits or work the facts call finished\.$/);
});

test("continuationSection for a solo Goal names the Goal, not a step", () => {
  const section = continuationSection({ index: 1, total: 1, entries: [{ session: "tangent-x", facts: "wrote the design" }], subject: "Goal" });
  assert.match(section, /^## Continuing this Goal/);
  assert.match(section, /You are a fresh session continuing this Goal\./);
});
