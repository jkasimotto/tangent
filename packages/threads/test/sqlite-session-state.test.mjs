import assert from "node:assert/strict";
import test from "node:test";

import { selectSessionIdByCwd } from "../dist/core/sqlite-session-state.js";

const worktree = "/tmp/otto-clearances-structure-tab";
const registeredAt = "2026-07-16T10:00:00.000Z";

test("selectSessionIdByCwd picks the session started after registeredAt, not an earlier one matching the same cwd", () => {
  const sessions = [
    // Pre-sorted lastActivityAt desc, as resolveSessionIdByCwd's query returns.
    { id: "sess-after", cwd: worktree, startedAt: "2026-07-16T10:05:00.000Z", lastActivityAt: "2026-07-16T10:06:00.000Z" },
    { id: "sess-before", cwd: worktree, startedAt: "2026-07-16T08:00:00.000Z", lastActivityAt: "2026-07-16T08:05:00.000Z" }
  ];
  assert.equal(selectSessionIdByCwd(sessions, worktree, registeredAt), "sess-after");
});

test("selectSessionIdByCwd finds no match when only the earlier (pre-registeredAt) session matches the cwd", () => {
  const sessions = [
    { id: "sess-before", cwd: worktree, startedAt: "2026-07-16T08:00:00.000Z", lastActivityAt: "2026-07-16T08:05:00.000Z" }
  ];
  assert.equal(selectSessionIdByCwd(sessions, worktree, registeredAt), undefined);
});

test("selectSessionIdByCwd allows a session that started within the 2-minute slack before registeredAt", () => {
  const sessions = [
    { id: "sess-just-before", cwd: worktree, startedAt: "2026-07-16T09:59:00.000Z", lastActivityAt: "2026-07-16T09:59:30.000Z" }
  ];
  assert.equal(selectSessionIdByCwd(sessions, worktree, registeredAt), "sess-just-before");
});

test("selectSessionIdByCwd rejects a session that started more than the 2-minute slack before registeredAt", () => {
  const sessions = [
    { id: "sess-too-early", cwd: worktree, startedAt: "2026-07-16T09:57:00.000Z", lastActivityAt: "2026-07-16T09:57:30.000Z" }
  ];
  assert.equal(selectSessionIdByCwd(sessions, worktree, registeredAt), undefined);
});

test("selectSessionIdByCwd falls back to lastActivityAt when startedAt is missing", () => {
  const sessions = [
    { id: "sess-no-start", cwd: worktree, lastActivityAt: "2026-07-16T10:05:00.000Z" }
  ];
  assert.equal(selectSessionIdByCwd(sessions, worktree, registeredAt), "sess-no-start");
});

test("selectSessionIdByCwd with no notBefore matches regardless of when the session started (back-compat)", () => {
  const sessions = [
    { id: "sess-ancient", cwd: worktree, startedAt: "2020-01-01T00:00:00.000Z" }
  ];
  assert.equal(selectSessionIdByCwd(sessions, worktree), "sess-ancient");
});

test("selectSessionIdByCwd still requires a cwd match", () => {
  const sessions = [
    { id: "sess-other-cwd", cwd: "/tmp/some-other-repo", startedAt: "2026-07-16T10:05:00.000Z" }
  ];
  assert.equal(selectSessionIdByCwd(sessions, worktree, registeredAt), undefined);
});
