import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { notify, defaultNotifyConfig } from "../dist/notify.js";

test("custom driver substitutes {title}/{body} and runs the template", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "notify-"));
  const out = path.join(dir, "ping.txt");
  await notify(
    { title: "Agent done", body: "all green" },
    { driver: { type: "custom", template: `printf '%s|%s' "{title}" "{body}" > ${out}` }, pollSeconds: 5, events: { done: true, needsInput: true, failed: false } }
  );
  // The custom driver detaches; poll briefly for the file to appear.
  for (let i = 0; i < 50 && !existsSync(out); i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(readFileSync(out, "utf8"), "Agent done|all green");
});

test("none driver is a no-op and never throws", async () => {
  await notify({ title: "x", body: "y" }, { driver: "none", pollSeconds: 5, events: { done: true, needsInput: true, failed: false } });
});

test("default config notifies on done and needs-input, not failed", () => {
  assert.deepEqual(defaultNotifyConfig(), { driver: "auto", pollSeconds: 5, events: { done: true, needsInput: true, failed: false } });
});
