import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { DraftRecord, SaveResult } from "../../kernel/kernel-types.ts";
import { draftFailureKind, draftOffer, draftTime, recoveryFailure, recoveryOutcome } from "./recovery-model.ts";

/** Builds a draft whose save failed with the given result. */
function draft(failure: Partial<SaveResult>, savedAt = "2026-09-03T14:05:00.000Z"): DraftRecord {
  return { savedAt, failure: { status: 409, ...failure }, restored: false } as DraftRecord;
}

const OK: SaveResult = { status: 200 };

test("the failure kind is the server's code, else conflict or blocked from the refused save", () => {
  assert.equal(draftFailureKind(draft({ code: "world-conflict", conflict: true })), "world-conflict");
  assert.equal(draftFailureKind(draft({ conflict: true })), "conflict");
  assert.equal(draftFailureKind(draft({})), "blocked");
});

test("the offer names the draft's time, the failure in words, and both choices", () => {
  const offer = draftOffer(draft({ code: "world-conflict", conflict: true }));
  assert.ok(offer.heading.startsWith("Draft from "));
  assert.equal(offer.cause.headline, "Map not saved. Another save landed first.");
  assert.equal(offer.cause.nextStep, "Reload saved or keep mine.");
  assert.equal(offer.restore, "Restore");
  assert.equal(offer.discard, "Discard");
});

test("an unknown failure code never reaches the words", () => {
  const offer = draftOffer(draft({ code: "shard-hash-mismatch-v9" }));
  assert.ok(!offer.cause.headline.includes("shard-hash"));
  assert.ok(!offer.cause.nextStep.includes("shard-hash"));
  assert.equal(offer.cause.headline, "Map not saved.");
});

test("the draft time is hours and minutes for a date and the raw value otherwise", () => {
  assert.match(draftTime("2026-09-03T14:05:00.000Z"), /\d/);
  assert.equal(draftTime("not a date"), "not a date");
});

test("reload always reports the reload and retry says nothing", () => {
  assert.equal(recoveryOutcome("reload", null, "saved"), "Saved map reloaded.");
  assert.equal(recoveryOutcome("reload", null, "conflict"), "Saved map reloaded.");
  assert.equal(recoveryOutcome("retry", OK, "saved"), null);
  assert.equal(recoveryOutcome("retry", null, "blocked"), null);
});

test("keep mine reports what actually happened", () => {
  assert.equal(recoveryOutcome("keepMine", null, "conflict"), "Keep mine is unavailable. Retry or reload saved.");
  assert.equal(recoveryOutcome("keepMine", OK, "blocked"), "Local draft kept. Retry or reload saved.");
  assert.equal(recoveryOutcome("keepMine", OK, "conflict"), "Map not saved. Keep mine found another conflict.");
  assert.equal(recoveryOutcome("keepMine", OK, "saved"), "Map saved with local changes.");
  assert.equal(recoveryOutcome("keepMine", OK, "saving"), null);
});

test("a thrown error becomes the headline and its own words", () => {
  assert.equal(recoveryFailure(new Error("network down")), "Map not saved. network down");
  assert.equal(recoveryFailure("refused"), "Map not saved. refused");
});
