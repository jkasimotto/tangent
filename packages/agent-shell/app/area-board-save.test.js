import assert from "node:assert/strict";
import test from "node:test";
import save from "./public/area-board-save.js";
test("serializes saves and stops after conflict", async () => {
  const calls = []; const drafts = {
    /** Records a failed scene. */
    save(_area, draft) { calls.push(`draft:${draft.canvas.nodes[0].id}`); },
    /** Records successful cleanup. */
    clear() { calls.push("clear"); },
  }; let release;
  const controller = save.create({ area: "otto", drafts,
    /** Simulates serialized responses. */
    post: async (canvas) => { calls.push(canvas.nodes[0].id); if (canvas.nodes[0].id === "a") await new Promise((resolve) => { release = resolve; }); return canvas.nodes[0].id === "b" ? { status: 409 } : { hash: "next" }; },
    /** Leaves timers under test control. */
    setTimer: () => 1,
    /** Leaves timers under test control. */
    clearTimer() {},
  });
  controller.start("base"); controller.edit({ nodes: [{ id: "a" }], edges: [] }); const first = controller.flush(); controller.edit({ nodes: [{ id: "b" }], edges: [] }); release(); await first; await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["a", "clear", "b", "draft:b"]); assert.equal(controller.stopped, true);
});

test("creates no recovery draft while an edit is merely waiting to save", async () => {
  const calls = []; const states = [];
  const controller = save.create({ area: "otto", drafts: {
    /** Records unexpected recovery. */
    save() { calls.push("draft"); },
    /** Records cleanup. */
    clear() { calls.push("clear"); },
  },
  /** Completes one save. */
  post: async () => ({ hash: "next" }),
  /** Leaves timers under test control. */
  setTimer: () => 1,
  /** Leaves timers under test control. */
  clearTimer() {},
  /** Records visible state. */
  onState: ({ state }) => states.push(state) });
  controller.start("base"); controller.edit({ elements: [{ id: "ink" }] });
  assert.deepEqual(calls, []);
  await controller.flush();
  assert.deepEqual(calls, ["clear"]);
  assert.deepEqual(states, ["dirty", "saving", "saved"]);
});

test("stores recovery only after a temporary save failure and retries it", async () => {
  const calls = []; let attempt = 0;
  const controller = save.create({ area: "otto", drafts: {
    /** Records recovery. */
    save(_area, draft) { calls.push(["draft", draft.baseHash, draft.canvas.id]); },
    /** Records cleanup. */
    clear() { calls.push(["clear"]); },
  },
  /** Fails once, then succeeds. */
  post: async (canvas, hash) => { calls.push(["post", canvas.id, hash]); attempt += 1; return attempt === 1 ? { status: 503 } : { hash: "next" }; },
  /** Leaves timers under test control. */
  setTimer: () => 1,
  /** Leaves timers under test control. */
  clearTimer() {} });
  controller.start("base"); controller.edit({ id: "mine" }); await controller.flush();
  controller.start("base"); await controller.flush();
  assert.deepEqual(calls, [["post", "mine", "base"], ["draft", "base", "mine"], ["post", "mine", "base"], ["clear"]]);
});
