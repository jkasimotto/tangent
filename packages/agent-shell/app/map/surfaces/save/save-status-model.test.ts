import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { DraftRecord } from "../../kernel/kernel-types.ts";
import { draftWaiting, saveStatusView, saveView } from "./save-status-model.ts";

const WAITING = { restored: false } as DraftRecord;
const RESTORED = { restored: true } as DraftRecord;

test("a clean map reads exactly Saved with no buttons", () => {
  const view = saveStatusView("saved", null);
  assert.equal(view.view, "saved");
  assert.equal(view.text, "Saved");
  assert.equal(view.className, "tangent-map-save saved");
  assert.deepEqual(view.buttons, []);
});

test("a clean map with a draft waiting reads Saved with recovery, and a restored draft does not", () => {
  assert.equal(saveView("saved", WAITING), "recovery");
  assert.equal(saveStatusView("saved", WAITING).text, "Saved · Recovery available");
  assert.equal(saveStatusView("saved", WAITING).className, "tangent-map-save saved");
  assert.equal(saveView("saved", RESTORED), "saved");
  assert.equal(draftWaiting(null), false);
  assert.equal(draftWaiting(WAITING), true);
});

test("a draft never changes the words of a save in progress", () => {
  assert.equal(saveStatusView("saving", WAITING).text, "Saving…");
  assert.equal(saveStatusView("dirty", WAITING).text, "Pending save…");
  assert.equal(saveStatusView("saving", WAITING).className, "tangent-map-save saving");
});

test("a blocked save offers Retry, Reload saved and Keep mine", () => {
  const view = saveStatusView("blocked", null);
  assert.equal(view.text, "Not saved ");
  assert.equal(view.className, "tangent-map-save blocked");
  assert.deepEqual(view.buttons.map((button) => button.action), ["retry", "reload", "keepMine"]);
  assert.deepEqual(view.buttons.map((button) => button.label), ["Retry", "Reload saved", "Keep mine"]);
});

test("a conflict offers Reload saved and Keep mine but no Retry", () => {
  const view = saveStatusView("conflict", null);
  assert.equal(view.text, "Not saved ");
  assert.equal(view.className, "tangent-map-save conflict");
  assert.deepEqual(view.buttons.map((button) => button.label), ["Reload saved", "Keep mine"]);
});
