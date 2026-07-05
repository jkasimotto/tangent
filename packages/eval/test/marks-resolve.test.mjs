import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { claudeProjectKey } from "@tangent/usage-index-sqlite";
import { resolveAnchorForSession, resolveCurrentSessionAnchor } from "../dist/marks/resolve.js";

/** Points CLAUDE_HOME at a fresh temp dir for the duration of a test, and restores it afterward. */
async function withClaudeHome(run) {
  const home = await mkdtemp(path.join(tmpdir(), "tangent-claude-home-"));
  const previous = process.env.CLAUDE_HOME;
  process.env.CLAUDE_HOME = home;
  try {
    await run(home);
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_HOME;
    else process.env.CLAUDE_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
}

/** Writes a fake Claude transcript file under a fabricated ~/.claude/projects layout, with a given mtime. */
async function writeFixtureTranscript(home, repoRoot, sessionId, mtime) {
  const projectDir = path.join(home, "projects", claudeProjectKey(repoRoot));
  await mkdir(projectDir, { recursive: true });
  const file = path.join(projectDir, `${sessionId}.jsonl`);
  await writeFile(file, "{}\n", "utf8");
  await utimes(file, mtime, mtime);
  return file;
}

test("resolveCurrentSessionAnchor picks the newest transcript for a cwd, not just any transcript", async () => {
  await withClaudeHome(async (home) => {
    const repoRoot = "/tmp/example-repo";
    const older = await writeFixtureTranscript(home, repoRoot, "session-old", new Date("2026-07-01T00:00:00Z"));
    const newer = await writeFixtureTranscript(home, repoRoot, "session-new", new Date("2026-07-05T00:00:00Z"));

    const anchor = await resolveCurrentSessionAnchor(repoRoot);
    assert.equal(anchor.provider, "claude");
    assert.equal(anchor.sessionId, "session-new");
    assert.equal(anchor.conversationId, "claude:session-new");
    assert.equal(anchor.transcriptPath, newer);
    assert.equal(anchor.ordinal, undefined, "ordinal resolves lazily, not at capture time");
    assert.notEqual(anchor.transcriptPath, older);
  });
});

test("resolveCurrentSessionAnchor returns undefined when the cwd has no transcripts", async () => {
  await withClaudeHome(async () => {
    assert.equal(await resolveCurrentSessionAnchor("/tmp/never-visited-repo"), undefined);
  });
});

test("resolveAnchorForSession finds a session by id across profiles regardless of cwd", async () => {
  await withClaudeHome(async (home) => {
    const file = await writeFixtureTranscript(home, "/tmp/some-other-repo", "session-abc", new Date());
    const anchor = await resolveAnchorForSession("session-abc");
    assert.equal(anchor.sessionId, "session-abc");
    assert.equal(anchor.transcriptPath, file);
  });
});

test("resolveAnchorForSession returns undefined for an unknown session id", async () => {
  await withClaudeHome(async (home) => {
    await writeFixtureTranscript(home, "/tmp/some-repo", "session-known", new Date());
    assert.equal(await resolveAnchorForSession("session-unknown"), undefined);
  });
});

test("resolveCurrentSessionAnchor unions transcripts across multiple CLAUDE_HOME profiles", async () => {
  const homeA = await mkdtemp(path.join(tmpdir(), "tangent-claude-a-"));
  const homeB = await mkdtemp(path.join(tmpdir(), "tangent-claude-b-"));
  const previous = process.env.CLAUDE_HOME;
  process.env.CLAUDE_HOME = [homeA, homeB].join(path.delimiter);
  try {
    const repoRoot = "/tmp/example-repo-multi-profile";
    await writeFixtureTranscript(homeA, repoRoot, "session-a", new Date("2026-07-01T00:00:00Z"));
    const newest = await writeFixtureTranscript(homeB, repoRoot, "session-b", new Date("2026-07-06T00:00:00Z"));

    const anchor = await resolveCurrentSessionAnchor(repoRoot);
    assert.equal(anchor.sessionId, "session-b");
    assert.equal(anchor.transcriptPath, newest);
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_HOME;
    else process.env.CLAUDE_HOME = previous;
    await rm(homeA, { recursive: true, force: true });
    await rm(homeB, { recursive: true, force: true });
  }
});
