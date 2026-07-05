import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { claudeProjectKey } from "@tangent/usage-index-sqlite";
import { draftFromFlags, draftFromStdinInput, markCommand } from "../dist/cli/commands/mark.js";
import { readMark } from "../dist/marks/store.js";

const anchor = {
  provider: "claude",
  sessionId: "session-1",
  conversationId: "claude:session-1",
  transcriptPath: "/home/user/.claude/projects/repo/session-1.jsonl"
};
const repo = { root: "/Users/me/Projects/example", branch: "main" };

// --- Pure argument/input parsing: no filesystem or environment needed. ---

test("draftFromFlags uses the bare note as observed", () => {
  const draft = draftFromFlags({ _: ["you should have read the docs first"] }, anchor, repo);
  assert.equal(draft.observed, "you should have read the docs first");
  assert.equal(draft.kind, "failure");
  assert.deepEqual(draft.anchor, anchor);
  assert.deepEqual(draft.repo, repo);
});

test("draftFromFlags lets --observed override the bare note, and reads --expected/--hypothesis/--kind", () => {
  const draft = draftFromFlags({
    _: ["ignored note"],
    observed: "explicit observed text",
    expected: "should have done x",
    hypothesis: "missing skill",
    kind: "candidate"
  }, anchor, repo);
  assert.equal(draft.observed, "explicit observed text");
  assert.equal(draft.expected, "should have done x");
  assert.equal(draft.hypothesis, "missing skill");
  assert.equal(draft.kind, "candidate");
});

test("draftFromFlags requires a note or --observed", () => {
  assert.throws(() => draftFromFlags({ _: [] }, anchor, repo), /note or --observed/);
});

test("draftFromFlags rejects an unknown --kind value", () => {
  assert.throws(() => draftFromFlags({ _: ["note"], kind: "bogus" }, anchor, repo), /--kind must be/);
});

test("draftFromStdinInput uses the input's own anchor and repo when both are present", () => {
  const inputAnchor = { sessionId: "s2", transcriptPath: "/x/s2.jsonl" };
  const inputRepo = { root: "/Users/me/Projects/other" };
  const draft = draftFromStdinInput({ observed: "note", anchor: inputAnchor, repo: inputRepo }, anchor, repo);
  assert.equal(draft.anchor.sessionId, "s2");
  assert.equal(draft.anchor.conversationId, "claude:s2", "conversationId defaults from sessionId when absent");
  assert.equal(draft.repo.root, "/Users/me/Projects/other");
});

test("draftFromStdinInput falls back to the resolved anchor/repo when the input omits them", () => {
  const draft = draftFromStdinInput({ observed: "note" }, anchor, repo);
  assert.deepEqual(draft.anchor, anchor);
  assert.deepEqual(draft.repo, repo);
});

test("draftFromStdinInput passes through id/at/status/quote/links when present", () => {
  const draft = draftFromStdinInput({
    observed: "note",
    id: "custom-id",
    at: "2026-07-05T00:00:00.000Z",
    status: "triaged",
    quote: "verbatim excerpt",
    links: { eval: "my-eval" }
  }, anchor, repo);
  assert.equal(draft.id, "custom-id");
  assert.equal(draft.at, "2026-07-05T00:00:00.000Z");
  assert.equal(draft.status, "triaged");
  assert.equal(draft.quote, "verbatim excerpt");
  assert.deepEqual(draft.links, { eval: "my-eval" });
});

test("draftFromStdinInput requires a non-empty observed field", () => {
  assert.throws(() => draftFromStdinInput({}, anchor, repo), /requires a non-empty "observed"/);
});

// --- CLI integration: exercises argument parsing, session resolution, and the store together. ---

/** Captures console.log lines for the duration of a run, restoring the real console.log after. */
async function captureLog(run) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.map(String).join(" "));
  try {
    await run();
  } finally {
    console.log = original;
  }
  return lines;
}

test("tangent mark end to end: bare capture, list, show, and update round-trip through the CLI", async () => {
  const claudeHome = await mkdtemp(path.join(tmpdir(), "tangent-claude-home-"));
  const marksHome = await mkdtemp(path.join(tmpdir(), "tangent-marks-home-"));
  const previousClaudeHome = process.env.CLAUDE_HOME;
  const previousMarksHome = process.env.TANGENT_MARKS_HOME;
  process.env.CLAUDE_HOME = claudeHome;
  process.env.TANGENT_MARKS_HOME = marksHome;
  try {
    const cwd = process.cwd();
    const projectDir = path.join(claudeHome, "projects", claudeProjectKey(cwd));
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, "cli-test-session.jsonl"), "{}\n", "utf8");

    const captureLines = await captureLog(() => markCommand({ _: ["you should have read the docs index first"], kind: "candidate" }));
    assert.match(captureLines[0], /^mark: \d{8}T\d{6}-you-should-have-read-the-docs$/);
    const id = captureLines[0].split("mark: ")[1];

    const mark = await readMark(id, marksHome);
    assert.equal(mark.kind, "candidate");
    assert.equal(mark.observed, "you should have read the docs index first");
    assert.equal(mark.anchor.sessionId, "cli-test-session");
    assert.equal(mark.status, "new");

    const listLines = await captureLog(() => markCommand({ _: ["list"], kind: "candidate" }));
    assert.ok(listLines.some((line) => line.startsWith(id)), "list should include the captured mark");

    // `--json` on `list` must keep its ordinary meaning ("print as JSON"), not be misrouted into the
    // bare-capture stdin path, which shares the same flag name for a different purpose.
    const listJsonLines = await captureLog(() => markCommand({ _: ["list"], json: true }));
    const listedMarks = JSON.parse(listJsonLines.join("\n"));
    assert.ok(Array.isArray(listedMarks) && listedMarks.some((entry) => entry.id === id));

    const showLines = await captureLog(() => markCommand({ _: ["show", id] }));
    const shown = JSON.parse(showLines.join("\n"));
    assert.deepEqual(shown, mark);

    await captureLog(() => markCommand({ _: ["update", id], status: "triaged", "link-eval": "docs-index-eval" }));
    const updated = await readMark(id, marksHome);
    assert.equal(updated.status, "triaged");
    assert.deepEqual(updated.links, { eval: "docs-index-eval", fix: null });
  } finally {
    if (previousClaudeHome === undefined) delete process.env.CLAUDE_HOME;
    else process.env.CLAUDE_HOME = previousClaudeHome;
    if (previousMarksHome === undefined) delete process.env.TANGENT_MARKS_HOME;
    else process.env.TANGENT_MARKS_HOME = previousMarksHome;
    await rm(claudeHome, { recursive: true, force: true });
    await rm(marksHome, { recursive: true, force: true });
  }
});

test("tangent mark without a note or --observed, and with no current session, reports a clear error", async () => {
  const claudeHome = await mkdtemp(path.join(tmpdir(), "tangent-claude-home-empty-"));
  const previousClaudeHome = process.env.CLAUDE_HOME;
  process.env.CLAUDE_HOME = claudeHome;
  try {
    await assert.rejects(markCommand({ _: [] }), /No Claude transcript found for this directory/);
  } finally {
    if (previousClaudeHome === undefined) delete process.env.CLAUDE_HOME;
    else process.env.CLAUDE_HOME = previousClaudeHome;
    await rm(claudeHome, { recursive: true, force: true });
  }
});
