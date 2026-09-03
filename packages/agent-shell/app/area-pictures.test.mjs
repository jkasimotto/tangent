import assert from "node:assert/strict"; import test from "node:test"; import { createAreaPictures } from "./area-pictures.mjs";
/** Creates an in-memory store holding one value. */
const memory = () => {
  let value = null;
  return {
    /** Returns the stored value or the fallback. */
    async read(_a, _n, fallback) { return value ?? fallback; },
    /** Stores a copy of the next value. */
    async write(_a, _n, next) { value = structuredClone(next); }
  };
};
/** Fixed clock for the tests. */
const now = () => "now";
test("validates closed vocabulary, limits, source snapshots, and atomic replacement", async () => {
  const pictures = createAreaPictures({ store: memory(), now });
  const input = { area: "otto", outcomes: [{ id: "one", outcome: "Ship map", signal: { kind: "moving" }, next: "Do it", who: "Julian", evidence: [], relations: [], unsure: null, source: { file: "otto/otto.md" } }], options: [], childFallbacks: [], sourceSnapshots: [{ source: { file: "otto/otto.md" }, hash: "abc" }] };
  assert.equal((await pictures.present("otto", input, { session: "brain", generation: 1 })).picture.version, 1);
  assert.equal((await pictures.present("otto", { ...input, outcomes: [{ ...input.outcomes[0], signal: { kind: "unknown" } }] }, {})).status, 422);
});
test("withdraw fences a stale picture hash", async () => {
  const pictures = createAreaPictures({ store: memory(), now });
  const saved = await pictures.present("otto", { area: "otto", outcomes: [], options: [] }, { session: "brain", generation: 1 });
  assert.equal((await pictures.withdraw("otto", "stale")).status, 409);
  assert.equal((await pictures.withdraw("otto", saved.picture.contentHash)).status, 200);
  assert.equal(await pictures.get("otto"), null);
});
