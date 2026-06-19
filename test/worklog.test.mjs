import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// The worklog store reads ~/.tangent/worklog.jsonl; point HOME at a temp dir so
// the real worklog is never touched.
test("worklog round-trips entries and records actuals", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "tangent-worklog-"));
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const { appendWorklogEntry, listWorklogEntries, setWorklogActual } = await import("../dist/cli/worklog.js");

    const a = await appendWorklogEntry({ cwd: "/repo", entityPath: "foo/bar", name: "Task A", estimateMinutes: 30, startedAt: "2026-06-19T10:00:00.000Z" });
    const b = await appendWorklogEntry({ cwd: "/repo", name: "Task B", estimateMinutes: 60, startedAt: "2026-06-19T11:00:00.000Z" });

    assert.equal(a.actualMinutes, null);
    assert.notEqual(a.id, b.id);

    let entries = await listWorklogEntries();
    assert.deepEqual(entries.map((entry) => entry.name), ["Task A", "Task B"]);

    await setWorklogActual(a.id, 45);
    entries = await listWorklogEntries();
    assert.equal(entries.find((entry) => entry.id === a.id).actualMinutes, 45);
    assert.equal(entries.find((entry) => entry.id === b.id).actualMinutes, null);

    // Non-agent work logs its actual up front and needs no cwd.
    const meeting = await appendWorklogEntry({ entityPath: "foo/bar", name: "Planning meeting", estimateMinutes: 60, startedAt: "2026-06-19T12:00:00.000Z", actualMinutes: 80 });
    assert.equal(meeting.actualMinutes, 80);
    assert.equal(meeting.cwd, undefined);
    entries = await listWorklogEntries();
    assert.equal(entries.find((entry) => entry.id === meeting.id).actualMinutes, 80);

    // One JSON object per line.
    const raw = await readFile(path.join(home, ".tangent", "worklog.jsonl"), "utf8");
    assert.equal(raw.trim().split("\n").length, 3);
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    await rm(home, { recursive: true, force: true });
  }
});
