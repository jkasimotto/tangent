import assert from "node:assert/strict";
import test from "node:test";
import {
  ASK_DISMISSALS_KEY,
  normalizeDismissedAskIds,
  readDismissedAskIds,
  writeDismissedAskIds,
} from "./public/ask-dismissal-core.js";

/** Creates a writable local-storage double. */
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    /** Reads one stored value. */
    getItem(key) { return values.get(key) ?? null; },
    /** Writes one stored value. */
    setItem(key, value) { values.set(key, value); },
    /** Removes one stored value. */
    removeItem(key) { values.delete(key); },
  };
}

test("dismissals persist one versioned set of exact ask identities", () => {
  const local = storage();
  assert.equal(writeDismissedAskIds(local, new Set(["stopped-step:b", "stopped-step:a", "stopped-step:a"])), true);
  assert.deepEqual(JSON.parse(local.getItem(ASK_DISMISSALS_KEY)), {
    schema: "agent-shell.ask-dismissals.v1",
    ids: ["stopped-step:a", "stopped-step:b"],
  });
  assert.deepEqual([...readDismissedAskIds(local)], ["stopped-step:a", "stopped-step:b"]);
  assert.equal(writeDismissedAskIds(local, new Set()), true);
  assert.equal(local.getItem(ASK_DISMISSALS_KEY), null, "Undo of the final receipt removes the record");
});

test("damaged or unavailable storage never hides an ask", () => {
  assert.deepEqual([...readDismissedAskIds(storage({ [ASK_DISMISSALS_KEY]: "{" }))], []);
  assert.deepEqual(normalizeDismissedAskIds([" x ", "", null, "x", "y"]), ["x", "y"]);
  const unavailable = {
    /** Refuses reads. */
    getItem() { throw new Error("blocked"); },
    /** Refuses writes. */
    setItem() { throw new Error("blocked"); },
    /** Refuses removals. */
    removeItem() { throw new Error("blocked"); },
  };
  assert.deepEqual([...readDismissedAskIds(unavailable)], []);
  assert.equal(writeDismissedAskIds(unavailable, new Set(["request:one"])), false);
});
