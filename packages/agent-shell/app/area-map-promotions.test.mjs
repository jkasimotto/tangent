import assert from "node:assert/strict"; import test from "node:test"; import { createAreaMapPromotions } from "./area-map-promotions.mjs";
/** Creates one in-memory runtime-record store. */
const memory = () => { let value; return {
  /** Reads the current test record or its fallback. */
  async read(_a, _n, fallback) { return value ?? structuredClone(fallback); },
  /** Replaces the current test record. */
  async write(_a, _n, next) { value = structuredClone(next); },
}; };
test("advances idempotent state and resumes every incomplete state", async () => { const promotions = createAreaMapPromotions({ store: memory() }); await promotions.start("otto", { id: "op", kind: "idea", sourceCanvasHash: "hash", nodeId: "n" }); assert.equal((await promotions.advance("otto", "op", "requested", "waiting-for-brain")).promotion.state, "waiting-for-brain"); assert.deepEqual((await promotions.incomplete("otto")).map((item) => item.id), ["op"]); assert.equal((await promotions.advance("otto", "op", "requested", "waiting-for-brain")).idempotent, true); });
test("the exact brain can attach one durable result and retries are idempotent", async () => { const promotions = createAreaMapPromotions({ store: memory() }); await promotions.start("otto", { id: "op", kind: "idea", sourceCanvasHash: "hash", nodeId: "n" }); const first = await promotions.complete("otto", "op", { file: "otto/ideas.md", subpath: "#^idea-1" }, "notice-1"); assert.equal(first.promotion.state, "durable-created"); assert.equal((await promotions.complete("otto", "op", first.promotion.durableRef)).idempotent, true); assert.equal((await promotions.complete("otto", "op", { file: "other.md" })).status, 409); });
