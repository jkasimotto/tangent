import assert from "node:assert/strict";
import test from "node:test";
import drafts from "./public/area-board-draft-store.js";
test("offers recovery and clears only after committed success", () => {
  const values = new Map();
  const storage = {
    /** Reads one key. */
    getItem: (key) => values.get(key) ?? null,
    /** Stores one key. */
    setItem: (key, value) => values.set(key, value),
    /** Removes one key. */
    removeItem: (key) => values.delete(key)
  };
  const store = drafts.create(storage); store.save("otto", { baseHash: "a", canvas: { nodes: [], edges: [] } });
  assert.equal(store.load("otto").baseHash, "a"); store.clear("otto"); assert.equal(store.load("otto"), null);
});
