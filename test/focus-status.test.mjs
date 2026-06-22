import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, utimes, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { readAgentStatus } from "../dist/cli/focus.js";

/** G20 backing: agent status is derived from the newest transcript's freshness and tail. */
test("readAgentStatus derives running / done / waiting / unknown", async () => {
  const now = Date.parse("2026-06-22T12:00:00Z");
  const dir = await mkdtemp(path.join(tmpdir(), "focus-status-"));
  try {
    assert.equal(await readAgentStatus(path.join(dir, "missing"), now), "unknown");

    const file = path.join(dir, "session.jsonl");
    await writeFile(file, '{"type":"assistant","text":"working"}\n');

    // Fresh write -> running.
    const fresh = new Date(now - 5_000);
    await utimes(file, fresh, fresh);
    assert.equal(await readAgentStatus(dir, now), "running");

    // Stale write -> done.
    const stale = new Date(now - 120_000);
    await utimes(file, stale, stale);
    assert.equal(await readAgentStatus(dir, now), "done");

    // Trailing tool_use / permission marker -> waiting, regardless of freshness.
    await writeFile(file, '{"type":"assistant"}\n{"type":"tool_use","name":"Bash"}\n');
    await utimes(file, stale, stale);
    assert.equal(await readAgentStatus(dir, now), "waiting");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
