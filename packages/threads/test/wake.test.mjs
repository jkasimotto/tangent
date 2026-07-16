import test from "node:test";
import assert from "node:assert/strict";
import { parseWakeCondition, evaluateWakeCondition } from "../dist/core/wake.js";

/** Fake git probe returning a canned ancestor answer. */
function probe(answer) {
  return {
    /** Simulates git merge-base --is-ancestor with a fixed result. */
    isAncestor: async () => answer
  };
}

test("parses date wake conditions", () => {
  const parsed = parseWakeCondition("Wake on 2026-07-20");
  assert.deepEqual(parsed, { kind: "date", date: "2026-07-20", raw: "Wake on 2026-07-20" });
});

test("parses merged wake conditions with a repo path", () => {
  const raw = "Wake when pgande-staging is merged into main in ~/neara/polez";
  const parsed = parseWakeCondition(raw);
  assert.equal(parsed.kind, "merged");
  assert.equal(parsed.branch, "pgande-staging");
  assert.equal(parsed.target, "main");
  assert.ok(parsed.repoPath.endsWith("/neara/polez"));
});

test("anything else is opaque and never met", async () => {
  const parsed = parseWakeCondition("Wake when Troy says so");
  assert.equal(parsed.kind, "opaque");
  assert.equal(await evaluateWakeCondition(parsed, new Date(), probe(true)), false);
});

test("date condition is met on or after the date", async () => {
  const parsed = parseWakeCondition("Wake on 2026-07-20");
  assert.equal(await evaluateWakeCondition(parsed, new Date("2026-07-19T23:00:00Z"), probe(false)), false);
  assert.equal(await evaluateWakeCondition(parsed, new Date("2026-07-20T01:00:00Z"), probe(false)), true);
});

test("merged condition delegates to the git probe", async () => {
  const parsed = parseWakeCondition("Wake when b is merged into main in /tmp/repo");
  assert.equal(await evaluateWakeCondition(parsed, new Date(), probe(true)), true);
  assert.equal(await evaluateWakeCondition(parsed, new Date(), probe(false)), false);
});
