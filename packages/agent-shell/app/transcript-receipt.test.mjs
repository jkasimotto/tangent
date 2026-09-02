import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { firstUserMessageReceipt } from "./transcript-tail.mjs";
import { piProjectKey } from "./harness-transcripts.mjs";

/** Returns the expected receipt facts for one prompt. */
const expected = (text) => ({ expectedSha256: createHash("sha256").update(text).digest("hex"), expectedBytes: Buffer.byteLength(text) });

test("Claude exact receipt hashes the complete first native user message", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-claude-receipt-"));
  const cwd = "/work/repo";
  const project = cwd.replace(/[/.]/g, "-");
  await mkdir(path.join(root, project), { recursive: true });
  const prompt = "handover α\n\ncomplete notice";
  await writeFile(path.join(root, project, "conversation.jsonl"), `${JSON.stringify({ message: { role: "user", content: [{ type: "text", text: prompt }] } })}\n`);
  const receipt = await firstUserMessageReceipt({ harness: { id: "claude", transcripts: root }, conversation: { provider: "claude", id: "conversation" }, cwd, ...expected(prompt) });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.bytes, Buffer.byteLength(prompt));
});

test("pi exact receipt rejects one-byte message changes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-pi-receipt-"));
  // pi writes `<transcripts>/<cwd slug>/<timestamp>_<id>.jsonl`. This fixture
  // used to write `<transcripts>/<id>.jsonl`, which is where the reader used
  // to look and is nowhere pi has ever written.
  const cwd = "/work/repo";
  const folder = path.join(root, piProjectKey(cwd));
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, "2026-09-03T04-00-00_conversation.jsonl"), `${JSON.stringify({ role: "user", content: "different" })}\n`);
  const receipt = await firstUserMessageReceipt({ harness: { id: "pi", transcripts: root }, conversation: { harness: "pi", id: "conversation" }, cwd, ...expected("expected") });
  assert.equal(receipt.ok, false);
  assert.equal(receipt.reason, "prompt-mismatch");
});

test("a pi receipt at the path the reader used to look in is not found", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-pi-receipt-legacy-"));
  await writeFile(path.join(root, "conversation.jsonl"), `${JSON.stringify({ role: "user", content: "different" })}\n`);
  const receipt = await firstUserMessageReceipt({ harness: { id: "pi", transcripts: root }, conversation: { harness: "pi", id: "conversation" }, cwd: "/work/repo", ...expected("expected") });
  assert.equal(receipt.reason, "unsupported-or-missing-transcript");
});
