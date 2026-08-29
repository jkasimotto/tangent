import assert from "node:assert/strict";
import test from "node:test";
import save from "./public/area-board-save.js";
test("serializes saves and stops after conflict", async () => {
  const calls = []; const drafts = { save() {}, clear() { calls.push("clear"); } }; let release;
  const controller = save.create({ area: "otto", drafts, post: async (canvas) => { calls.push(canvas.nodes[0].id); if (canvas.nodes[0].id === "a") await new Promise((resolve) => { release = resolve; }); return canvas.nodes[0].id === "b" ? { status: 409 } : { hash: "next" }; }, setTimer: () => 1, clearTimer() {} });
  controller.start("base"); controller.edit({ nodes: [{ id: "a" }], edges: [] }); const first = controller.flush(); controller.edit({ nodes: [{ id: "b" }], edges: [] }); release(); await first; await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["a", "clear", "b"]); assert.equal(controller.stopped, true);
});
