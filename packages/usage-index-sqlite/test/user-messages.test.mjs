import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { claudeProjectKey, ensureUsageIndex, readConversationsUserMessages } from "../dist/index.js";

test("readConversationsUserMessages carries each user message's per-session ordinal, counted across every role", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "usage-index-sqlite-user-messages-"));
  const previousUsageHome = process.env.USAGE_HOME;
  const previousClaudeHome = process.env.CLAUDE_HOME;
  const claudeHome = path.join(dir, "claude-home");
  const repo = path.join(dir, "repo");
  process.env.USAGE_HOME = path.join(dir, "home");
  process.env.CLAUDE_HOME = claudeHome;
  try {
    await mkdir(repo, { recursive: true });
    const sessionId = "session-ordinal-test";
    const nativePath = path.join(claudeHome, "projects", claudeProjectKey(repo), `${sessionId}.jsonl`);
    await writeJsonl(nativePath, twoUserMessageSession({ repo, sessionId }));

    await ensureUsageIndex({ repo, scope: "all", providers: ["claude"], now: new Date("2026-07-06T00:00:00.000Z") });
    const [conversation] = await readConversationsUserMessages({
      conversationIds: [`claude:${sessionId}`],
      repo,
      scope: "all",
      providers: ["claude"]
    });

    assert.deepEqual(conversation.userMessages.map((message) => ({ ordinal: message.ordinal, text: message.text })), [
      { ordinal: 1, text: "please read the docs index first" },
      { ordinal: 3, text: "actually check config.json instead" }
    ]);
  } finally {
    if (previousUsageHome === undefined) delete process.env.USAGE_HOME;
    else process.env.USAGE_HOME = previousUsageHome;
    if (previousClaudeHome === undefined) delete process.env.CLAUDE_HOME;
    else process.env.CLAUDE_HOME = previousClaudeHome;
    await rm(dir, { recursive: true, force: true });
  }
});

/** Writes JSONL fixture records to disk, one per line, for a native transcript index test. */
async function writeJsonl(filePath, records) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

/**
 * Builds a minimal Claude native fixture with two user messages around one plain-text assistant
 * reply, so the middle message's ordinal (2) is skipped by `userMessages` and the two user
 * messages land on ordinals 1 and 3, the session-wide count across every role.
 */
function twoUserMessageSession({ repo, sessionId }) {
  return [
    {
      type: "user",
      uuid: "user1",
      promptId: "turn1",
      sessionId,
      timestamp: "2026-07-06T08:00:00.000Z",
      cwd: repo,
      gitBranch: "main",
      version: "2.1.168",
      message: { role: "user", content: "please read the docs index first" }
    },
    {
      type: "assistant",
      uuid: "assistant1",
      sessionId,
      timestamp: "2026-07-06T08:00:05.000Z",
      cwd: repo,
      gitBranch: "main",
      version: "2.1.168",
      message: {
        id: "msg1",
        type: "message",
        role: "assistant",
        model: "claude-sonnet",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "ok, reading it now" }],
        usage: { input_tokens: 10, output_tokens: 4 }
      }
    },
    {
      type: "user",
      uuid: "user2",
      promptId: "turn2",
      sessionId,
      timestamp: "2026-07-06T08:00:10.000Z",
      cwd: repo,
      gitBranch: "main",
      version: "2.1.168",
      message: { role: "user", content: "actually check config.json instead" }
    }
  ];
}
