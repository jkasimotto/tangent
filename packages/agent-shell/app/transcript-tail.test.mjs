import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { observeTranscript, parseTranscriptTail } from "./transcript-tail.mjs";

test("the Claude reader returns the last event and output tokens", () => {
  const text = JSON.stringify({ type: "assistant", timestamp: "2026-08-28T12:00:00.000Z", message: { role: "assistant", usage: { output_tokens: 42 } } });
  assert.deepEqual(parseTranscriptTail("claude", text), { lastEventAt: Date.parse("2026-08-28T12:00:00.000Z"), lastEventKind: "assistant", outputTokens: 42 });
});

test("the pi reader returns tokens and Codex rejects an unknown shape", () => {
  const text = JSON.stringify({ timestamp: "2026-08-28T12:00:00.000Z", type: "message", usage: { output: 9 } });
  assert.equal(parseTranscriptTail("pi-code", text).outputTokens, 9);
  assert.equal(parseTranscriptTail("codex", JSON.stringify({ type: "unknown" })), null);
});

test("a Claude observation comes from the recorded conversation, not pane paint", async () => {
  const transcripts = await mkdtemp(path.join(os.tmpdir(), "tangent-transcript-"));
  const cwd = "/work/a.b";
  const folder = path.join(transcripts, "-work-a-b");
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, "session-1.jsonl"), JSON.stringify({ type: "assistant", timestamp: "2026-08-28T12:00:00.000Z", message: { role: "assistant", usage: { output_tokens: 12 } } }) + "\n");
  const result = await observeTranscript({ harness: { id: "claude-otto", transcripts }, conversation: { provider: "claude-otto", id: "session-1" }, cwd, startedAt: "2026-08-28T11:59:00.000Z" });
  assert.equal(result.lastEventKind, "assistant");
  assert.equal(result.outputTokens, 12);
});
