// What the capture surface says after one Journal capture.
//
// Capture writes the file first, so the words are never in doubt. The commit
// and the brain wake can still fail, and each failure looks exactly like
// success until Julian opens the Area. The toast is the only place that tells
// him, so every route it can receive must say something different and true.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { journalCaptureNeedsRetry, journalCaptureToast } from "./public/journal-capture-core.js";

const here = path.dirname(fileURLToPath(import.meta.url));

test("an uncommitted capture never claims the vault saved it or the brain heard it", () => {
  const toast = journalCaptureToast({ route: "not-committed", commitError: "the vault refused this commit" });
  assert.match(toast, /the vault did not save it/);
  assert.match(toast, /the Area brain was not told/);
  assert.match(toast, /the vault refused this commit/);
  assert.match(toast, /Retry keeps the same Journal entry/);
  assert.doesNotMatch(toast, /^Saved to the Journal\.$/);
  assert.equal(journalCaptureNeedsRetry({ route: "not-committed" }), true);
  assert.equal(journalCaptureNeedsRetry({ route: "duplicate" }), false);
});

test("each delivery route says what really happened", () => {
  assert.match(journalCaptureToast({ route: "brain-opened" }), /sent to the Area brain/);
  assert.match(journalCaptureToast({ route: "brain-resumed" }), /woke the Area brain/);
  assert.match(journalCaptureToast({ route: "brain-started" }), /woke the Area brain/);
  assert.match(journalCaptureToast({ route: "not-started", brainError: "tmux is gone" }), /did not start: tmux is gone/);
  assert.match(journalCaptureToast({ route: "no-brain" }), /waits for this Area's first brain/);
  assert.equal(journalCaptureToast({ route: "duplicate" }), "Saved to the Journal.");
});

test("both capture surfaces keep one key until a refused commit recovers", async () => {
  const work = await readFile(path.join(here, "public", "work-desk-view.js"), "utf8");
  const events = await readFile(path.join(here, "public", "shell-event-bindings.js"), "utf8");
  const composer = work.match(/function openAreaCapture\(area\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
  const areaForm = events.match(/if \(event\.target\.matches\("\[data-area-journal-form\]"\)\) \{[\s\S]*?\n    \}/)?.[0] ?? "";

  assert.match(composer, /const idempotencyKey = crypto\.randomUUID\(\);[\s\S]*post\([^\n]+idempotencyKey,[\s\S]*journalCaptureNeedsRetry\(saved\)\) return false/, "the Work composer reuses its key and stays open");
  assert.match(areaForm, /form\.dataset\.journalIdempotencyKey \|\| crypto\.randomUUID\(\)[\s\S]*form\.dataset\.journalIdempotencyKey = idempotencyKey[\s\S]*journalCaptureNeedsRetry\(saved\)\) return[\s\S]*delete form\.dataset\.journalIdempotencyKey/, "the Area form keeps its key until success");
});
