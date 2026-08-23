import assert from "node:assert/strict";
import test from "node:test";
import { createShellState } from "./public/shell-state.js";

/** Creates a local-storage double. */
function storage(values = {}) {
  return {
    /** Reads one stored value. */
    getItem(key) { return values[key] ?? null; },
  };
}

test("shell state restores URL navigation and durable browser choices", () => {
  const result = createShellState(storage({
    "agent-shell.current-goal": "otto/goal-one.md",
    "agent-shell.expanded-areas": '["otto"]',
    "agent-shell.work-filter": "active",
  }), "http://shell/?area=otto&document=otto/note.md");
  assert.equal(result.requestedDocument, "otto/note.md");
  assert.equal(result.state.view, "document");
  assert.equal(result.state.areaSelection, "otto");
  assert.equal(result.state.currentFile, "otto/goal-one.md");
  assert.deepEqual([...result.state.expandedAreas], ["otto"]);
  assert.equal(result.state.workFilter, "active");
});

test("shell state ignores damaged optional JSON", () => {
  const result = createShellState(storage({ "agent-shell.expanded-areas": "{" }), "http://shell/");
  assert.deepEqual([...result.state.expandedAreas], []);
  assert.equal(result.state.view, "work");
});
