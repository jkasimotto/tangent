import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { firstUserMessageReceipt } from "./transcript-tail.mjs";

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
  await writeFile(path.join(root, "conversation.jsonl"), `${JSON.stringify({ role: "user", content: "different" })}\n`);
  const receipt = await firstUserMessageReceipt({ harness: { id: "pi", transcripts: root }, conversation: { provider: "pi", id: "conversation" }, ...expected("expected") });
  assert.equal(receipt.ok, false);
  assert.equal(receipt.reason, "prompt-mismatch");
});
