import assert from "node:assert/strict";
import test from "node:test";
import { createSourceChangeMonitor } from "./source-change-monitor.mjs";

test("source edits make a manual Tangent reload available", () => {
  let onChange;
  let closed = false;
  const monitor = createSourceChangeMonitor({
    root: "/repo",
    /** Captures the watcher callback without touching the filesystem. */
    watchFiles(root, options, listener) {
      assert.equal(root, "/repo");
      assert.deepEqual(options, { recursive: true });
      onChange = listener;
      return {
        /** Accepts the error listener used by the monitor. */
        on() {},
        /** Records cleanup. */
        close() { closed = true; },
      };
    },
  });

  assert.equal(monitor.changed, false);
  onChange("change", "node_modules/library/index.js");
  onChange("change", ".git/index");
  onChange("change", "notes.txt");
  assert.equal(monitor.changed, false);
  onChange("change", "packages/agent-shell/app/public/shell.js");
  assert.equal(monitor.changed, true);
  monitor.close();
  assert.equal(closed, true);
});
