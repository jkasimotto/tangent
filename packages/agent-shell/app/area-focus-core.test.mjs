import assert from "node:assert/strict";
import test from "node:test";
import {
  AREA_FOCUS_KEY,
  isInAreaFocus,
  normalizeAreaFocus,
  readAreaFocus,
  reconcileAreaFocus,
  rewriteAreaFocus,
  toggleAreaFocusRoot,
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
  assert.deepEqual(readAreaFocus(local), { areas: ["otto/tangent"], only: false, error: false });
  assert.equal(writeAreaFocus(local, []), true);
  assert.equal(local.getItem(AREA_FOCUS_KEY), null);
});

test("unknown, damaged, and unavailable storage safely restores complete Work", () => {
  assert.deepEqual(readAreaFocus(storage({ [AREA_FOCUS_KEY]: '{"schema":"future","areas":["otto/tangent"]}' })), { areas: [], only: false, error: false });
  assert.deepEqual(readAreaFocus(storage({ [AREA_FOCUS_KEY]: "{" })), { areas: [], only: false, error: true });
  const unavailable = {
    /** Refuses reads. */
    getItem() { throw new Error("blocked"); },
    /** Refuses writes. */
    setItem() { throw new Error("blocked"); },
    /** Refuses removals. */
    removeItem() { throw new Error("blocked"); },
  };
  assert.deepEqual(readAreaFocus(unavailable), { areas: [], only: false, error: true });
  assert.equal(writeAreaFocus(unavailable, ["otto/tangent"]), false);
});

test("Area moves rewrite roots and stale Area deletion cannot trap Work", () => {
  assert.deepEqual(
    rewriteAreaFocus(["otto/tangent", "otto/other/child", "neara/pgande"], "otto", "home/otto"),
    ["home/otto/other/child", "home/otto/tangent", "neara/pgande"],
  );
  assert.deepEqual(
    reconcileAreaFocus(["neara/pgande", "otto/tools/tangent"], ["otto", "otto/tools", "otto/tools/tangent"]),
    ["otto/tools/tangent"],
  );
  assert.deepEqual(reconcileAreaFocus(["missing/path"], ["otto", "otto/tangent"]), []);
});

test("a star toggles one root from its row and refuses an Area under a starred ancestor", () => {
  const added = toggleAreaFocusRoot([], "otto/tangent");
  assert.deepEqual(added, { roots: ["otto/tangent"], change: "added", ancestor: "" });
  const inside = toggleAreaFocusRoot(added.roots, "otto/tangent/ui");
  assert.deepEqual(inside, { roots: ["otto/tangent"], change: "insideAncestor", ancestor: "otto/tangent" });
  const removed = toggleAreaFocusRoot(["neara", "otto/tangent"], "otto/tangent");
  assert.deepEqual(removed, { roots: ["neara"], change: "removed", ancestor: "" });
  assert.equal(toggleAreaFocusRoot(["neara"], "").change, "none");
});

test("only starred is stored beside the roots and never survives an empty scope", () => {
  const local = storage();
  writeAreaFocus(local, ["otto/tangent"], true);
  assert.deepEqual(JSON.parse(local.getItem(AREA_FOCUS_KEY)), { schema: "agent-shell.area-focus.v1", areas: ["otto/tangent"], only: true });
  assert.deepEqual(readAreaFocus(local), { areas: ["otto/tangent"], only: true, error: false });
  writeAreaFocus(local, ["otto/tangent"], false);
  assert.equal(readAreaFocus(local).only, false);
  local.setItem(AREA_FOCUS_KEY, JSON.stringify({ schema: "agent-shell.area-focus.v1", areas: [], only: true }));
  assert.equal(readAreaFocus(local).only, false);
});
