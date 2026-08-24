import assert from "node:assert/strict";
import test from "node:test";
import {
  AREA_FOCUS_KEY,
  isInAreaFocus,
  normalizeAreaFocus,
  readAreaFocus,
  reconcileAreaFocus,
  rewriteAreaFocus,
  writeAreaFocus,
} from "./public/area-focus-core.js";

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

test("Area Focus normalizes overlapping roots and scopes complete subtrees", () => {
  const roots = normalizeAreaFocus(["otto/tangent/ui", "neara/pgande", "otto/tangent", "otto/tangent"]);
  assert.deepEqual(roots, ["neara/pgande", "otto/tangent"]);
  assert.equal(isInAreaFocus("otto/tangent/ui", roots), true);
  assert.equal(isInAreaFocus("otto/standards", roots), false);
  assert.equal(isInAreaFocus("anything", []), true);
});

test("Area Focus persists one versioned local record and clear removes it", () => {
  const local = storage();
  assert.equal(writeAreaFocus(local, ["otto/tangent/child", "otto/tangent"]), true);
  assert.deepEqual(JSON.parse(local.getItem(AREA_FOCUS_KEY)), {
    schema: "agent-shell.area-focus.v1",
    areas: ["otto/tangent"],
  });
  assert.deepEqual(readAreaFocus(local), { areas: ["otto/tangent"], error: false });
  assert.equal(writeAreaFocus(local, []), true);
  assert.equal(local.getItem(AREA_FOCUS_KEY), null);
});

test("unknown, damaged, and unavailable storage safely restores complete Work", () => {
  assert.deepEqual(readAreaFocus(storage({ [AREA_FOCUS_KEY]: '{"schema":"future","areas":["otto/tangent"]}' })), { areas: [], error: false });
  assert.deepEqual(readAreaFocus(storage({ [AREA_FOCUS_KEY]: "{" })), { areas: [], error: true });
  const unavailable = {
    /** Refuses reads. */
    getItem() { throw new Error("blocked"); },
    /** Refuses writes. */
    setItem() { throw new Error("blocked"); },
    /** Refuses removals. */
    removeItem() { throw new Error("blocked"); },
  };
  assert.deepEqual(readAreaFocus(unavailable), { areas: [], error: true });
  assert.equal(writeAreaFocus(unavailable, ["otto/tangent"]), false);
});

test("Area moves rewrite roots and stale Area deletion cannot trap Work", () => {
  assert.deepEqual(
    rewriteAreaFocus(["otto/tangent", "neara/pgande"], "otto/tangent", "otto/tools/tangent"),
    ["neara/pgande", "otto/tools/tangent"],
  );
  assert.deepEqual(
    reconcileAreaFocus(["neara/pgande", "otto/tools/tangent"], ["otto", "otto/tools", "otto/tools/tangent"]),
    ["otto/tools/tangent"],
  );
  assert.deepEqual(reconcileAreaFocus(["missing/path"], ["otto", "otto/tangent"]), []);
});
