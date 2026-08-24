import assert from "node:assert/strict";
import test from "node:test";
import { uniqueSessionName } from "./session-names.mjs";

test("long pipeline names preserve step and retry suffixes", () => {
  const base = "standards-standards-architecture-names-shapes-and-ownership-of-all-types";
  const occupied = uniqueSessionName(base, "-s3", new Set());
  const retried = uniqueSessionName(base, "-s3", new Set([occupied]));
  assert.equal(occupied.length, 60);
  assert.equal(retried.length, 60);
  assert.match(occupied, /-s3$/);
  assert.match(retried, /-s3-r2$/);
  assert.notEqual(retried, occupied);
});

test("allocation has a finite budget even for adversarial candidate sets", () => {
  const live = new Set(["work", "work-r2", "work-r3", "work-r4"]);
  assert.equal(uniqueSessionName("work", "", live), "work-r5");
  assert.throws(() => uniqueSessionName("x", "12345678", live, 8), /suffix exceeds/);
});
