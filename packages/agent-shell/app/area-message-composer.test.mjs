import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("both Area-message composers keep one UUID until delivery succeeds", async () => {
  const work = await readFile(new URL("./public/work-desk-view.js", import.meta.url), "utf8");
  const events = await readFile(new URL("./public/shell-event-bindings.js", import.meta.url), "utf8");
  const modal = work.match(/function openAreaCapture\(area\)[\s\S]*?\n  }/)?.[0] ?? "";
  const form = events.match(/if \(event\.target\.matches\("\[data-area-message-form\]"\)\) \{[\s\S]*?\n    }/)?.[0] ?? "";

  assert.match(modal, /const idempotencyKey = crypto\.randomUUID\(\);[\s\S]*post\("\/api\/agents\/send", \{ to: area, text, from: "Agent Shell", idempotencyKey }\)/);
  assert.match(form, /form\.dataset\.messageIdempotencyKey \|\| crypto\.randomUUID\(\)[\s\S]*form\.dataset\.messageIdempotencyKey = idempotencyKey[\s\S]*await post\("\/api\/agents\/send"[\s\S]*delete form\.dataset\.messageIdempotencyKey[\s\S]*form\.reset\(\)/);
});

test("the Goal launch view has no alternate save action", async () => {
  const view = await readFile(new URL("./public/goal-launch-view.js", import.meta.url), "utf8");
  assert.equal(view.includes(`data-save-${["id", "ea"].join("")}`), false);
});
