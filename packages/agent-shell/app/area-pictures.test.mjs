import assert from "node:assert/strict"; import test from "node:test"; import { createAreaPictures } from "./area-pictures.mjs";
const memory = () => { let value = null; return { async read(_a, _n, fallback) { return value ?? fallback; }, async write(_a, _n, next) { value = structuredClone(next); } }; };
test("validates closed vocabulary, limits, source snapshots, and atomic replacement", async () => {
  const pictures = createAreaPictures({ store: memory(), now: () => "now" });
  const input = { area: "otto", outcomes: [{ id: "one", outcome: "Ship map", signal: { kind: "moving" }, next: "Do it", who: "Julian", evidence: [], relations: [], unsure: null, source: { file: "otto/otto.md" } }], options: [], childFallbacks: [], sourceSnapshots: [{ source: { file: "otto/otto.md" }, hash: "abc" }] };
  assert.equal((await pictures.present("otto", input, { session: "brain", generation: 1 })).picture.version, 1);
  assert.equal((await pictures.present("otto", { ...input, outcomes: [{ ...input.outcomes[0], signal: { kind: "unknown" } }] }, {})).status, 422);
});
