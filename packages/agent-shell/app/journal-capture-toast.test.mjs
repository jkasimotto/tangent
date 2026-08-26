// What the capture surface says after one Journal capture.
//
// Capture writes the file first, so the words are never in doubt. The commit
// and the brain wake can still fail, and each failure looks exactly like
// success until Julian opens the Area. The toast is the only place that tells
// him, so every route it can receive must say something different and true.

import test from "node:test";
import assert from "node:assert/strict";
import { journalCaptureToast } from "./public/journal-capture-core.js";

test("an uncommitted capture never claims the vault saved it or the brain heard it", () => {
  const toast = journalCaptureToast({ route: "not-committed", commitError: "the vault refused this commit" });
  assert.match(toast, /the vault did not save it/);
  assert.match(toast, /the Area brain was not told/);
  assert.match(toast, /the vault refused this commit/);
  assert.doesNotMatch(toast, /^Saved to the Journal\.$/);
});

test("each delivery route says what really happened", () => {
  assert.match(journalCaptureToast({ route: "brain-opened" }), /sent to the Area brain/);
  assert.match(journalCaptureToast({ route: "brain-resumed" }), /woke the Area brain/);
  assert.match(journalCaptureToast({ route: "brain-started" }), /woke the Area brain/);
  assert.match(journalCaptureToast({ route: "not-started", brainError: "tmux is gone" }), /did not start: tmux is gone/);
  assert.match(journalCaptureToast({ route: "no-brain" }), /waits for this Area's first brain/);
  assert.equal(journalCaptureToast({ route: "duplicate" }), "Saved to the Journal.");
});
