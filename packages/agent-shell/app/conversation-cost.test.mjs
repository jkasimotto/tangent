import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { conversationCost, conversationUsage } from "./conversation-cost.mjs";
import { claudeProjectKey, findCodexThread, piProjectKey, resolveConversationFiles } from "./harness-transcripts.mjs";
import { totalTokens } from "./token-usage.mjs";

const CWD = "/Users/fixture/Projects/thing";
const STARTED = "2026-09-03T04:00:00.000Z";

/** A scratch transcripts root that no real harness ever writes to. */
async function transcriptsRoot() {
  return mkdtemp(path.join(os.tmpdir(), "conversation-cost-"));
}

/** Writes one JSONL transcript, creating the folders it needs. */
async function writeJsonl(file, rows) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
}

/** One Claude assistant row, in the shape Claude Code writes. */
function claudeRow(id, model, usage) {
  return { type: "assistant", message: { id, role: "assistant", model, usage } };
}

/** One Codex `token_count` event carrying a cumulative total. */
function codexTokenCount(total) {
  return { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: total } } };
}

/** One Codex rollout header. */
function codexMeta({ id, sessionId = id, model = "gpt-5.6-sol", provider = "openai", source = "cli", threadSource = "user" }) {
  return { type: "session_meta", timestamp: STARTED, payload: { id, session_id: sessionId, cwd: CWD, model, model_provider: provider, source, thread_source: threadSource, timestamp: STARTED } };
}

/** The day folder Codex writes a rollout started at {@link STARTED} into. */
function codexDayFolder() {
  const date = new Date(Date.parse(STARTED));
  /** Two-digit month or day. */
  const pad = (value) => String(value).padStart(2, "0");
  return path.join(String(date.getFullYear()), pad(date.getMonth() + 1), pad(date.getDate()));
}

test("Claude Code's own ledger is preferred over the tokens in the transcript", async () => {
  const root = await transcriptsRoot();
  const id = "11111111-1111-4111-8111-111111111111";
  await writeJsonl(path.join(root, claudeProjectKey(CWD), `${id}.jsonl`), [
    claudeRow("msg_a", "claude-opus-5", { input_tokens: 100, output_tokens: 200 }),
    // The ledger names a model the transcript never carried and a cost the
    // tokens above could not produce. It still wins.
    { type: "cost-state", totalCostUSD: 12.5, modelUsage: { "claude-opus-5[1m]": { inputTokens: 1, outputTokens: 1, costUSD: 12.5 } } },
  ]);
  const cost = await conversationCost({ harness: { id: "claude-otto", transcripts: root }, conversation: { harness: "claude-otto", id }, cwd: CWD });
  assert.equal(cost.amount, 12.5);
  assert.equal(cost.byModel[0].model, "claude-opus-5[1m]");
  assert.ok(cost.notes.some((note) => note.includes("ledger")));
});

test("a ledger with billed work after it is stale, so the tokens are priced instead", async () => {
  const root = await transcriptsRoot();
  const id = "22222222-2222-4222-8222-222222222222";
  await writeJsonl(path.join(root, claudeProjectKey(CWD), `${id}.jsonl`), [
    { type: "cost-state", totalCostUSD: 0.002, modelUsage: { "claude-opus-5": { inputTokens: 1, outputTokens: 1, costUSD: 0.002 } } },
    claudeRow("msg_late", "claude-opus-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 }),
  ]);
  const cost = await conversationCost({ harness: { id: "claude-otto", transcripts: root }, conversation: { harness: "claude-otto", id }, cwd: CWD });
  assert.equal(cost.amount, 30);
  assert.equal(cost.notes.some((note) => note.includes("ledger")), false);
});

test("a streamed Claude message is read from its last line, not its first", async () => {
  const root = await transcriptsRoot();
  const id = "33333333-3333-4333-8333-333333333333";
  await writeJsonl(path.join(root, claudeProjectKey(CWD), `${id}.jsonl`), [
    claudeRow("msg_stream", "claude-opus-5", { input_tokens: 10, output_tokens: 862 }),
    claudeRow("msg_stream", "claude-opus-5", { input_tokens: 10, output_tokens: 2423 }),
  ]);
  const usage = await conversationUsage({ harness: { id: "claude", transcripts: root }, conversation: { harness: "claude", id }, cwd: CWD });
  assert.equal(usage.byModel[0].usage.output, 2423);
});

test("Claude subagents are counted, and the id they share with the parent is counted once", async () => {
  const root = await transcriptsRoot();
  const id = "44444444-4444-4444-8444-444444444444";
  const folder = path.join(root, claudeProjectKey(CWD));
  await writeJsonl(path.join(folder, `${id}.jsonl`), [
    claudeRow("msg_fork", "claude-opus-5", { input_tokens: 0, output_tokens: 1000 }),
  ]);
  await writeJsonl(path.join(folder, id, "subagents", "agent-one.jsonl"), [
    // The fork point repeats the parent's message id and must not be paid for twice.
    claudeRow("msg_fork", "claude-opus-5", { input_tokens: 0, output_tokens: 1000 }),
    claudeRow("msg_sub", "claude-opus-5", { input_tokens: 0, output_tokens: 500 }),
  ]);
  const usage = await conversationUsage({ harness: { id: "claude", transcripts: root }, conversation: { harness: "claude", id }, cwd: CWD });
  assert.equal(usage.subagentFiles, 1);
  assert.equal(usage.byModel[0].usage.output, 1500);
});

test("Claude cache writes are split into the bucket each one was billed at", async () => {
  const root = await transcriptsRoot();
  const id = "55555555-5555-4555-8555-555555555555";
  await writeJsonl(path.join(root, claudeProjectKey(CWD), `${id}.jsonl`), [
    claudeRow("msg_cache", "claude-opus-5", {
      input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 300,
      cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 },
    }),
  ]);
  const usage = await conversationUsage({ harness: { id: "claude", transcripts: root }, conversation: { harness: "claude", id }, cwd: CWD });
  assert.equal(usage.byModel[0].usage.cacheWrite, 100);
  assert.equal(usage.byModel[0].usage.cacheWrite1h, 200);
});

test("a Codex thread counts cached tokens outside input, the way every other reader does", async () => {
  const root = await transcriptsRoot();
  const id = "01a00000-0000-7000-8000-000000000001";
  await writeJsonl(path.join(root, codexDayFolder(), `rollout-2026-09-03T04-00-00-${id}.jsonl`), [
    codexMeta({ id }),
    // Codex reports cached tokens inside input_tokens. 996 were charged at
    // the full rate and 208,128 at the cache rate.
    codexTokenCount({ input_tokens: 209_124, cached_input_tokens: 208_128, output_tokens: 5000, reasoning_output_tokens: 1200 }),
  ]);
  const usage = await conversationUsage({ harness: { id: "codex", transcripts: root }, conversation: { harness: "codex", id }, cwd: CWD, startedAt: STARTED });
  const part = usage.byModel[0];
  assert.equal(part.usage.input, 996);
  assert.equal(part.usage.cacheRead, 208_128);
  assert.equal(part.usage.output, 5000);
  // Reasoning is reported and sits inside output; it is never added again.
  assert.equal(part.usage.reasoning, 1200);
  assert.equal(totalTokens(part.usage), 996 + 208_128 + 5000);
});

test("a Codex thread is charged once for a cumulative total it repeats", async () => {
  const root = await transcriptsRoot();
  const id = "01a00000-0000-7000-8000-000000000002";
  await writeJsonl(path.join(root, codexDayFolder(), `rollout-2026-09-03T04-00-00-${id}.jsonl`), [
    codexMeta({ id }),
    codexTokenCount({ input_tokens: 1000, cached_input_tokens: 0, output_tokens: 100 }),
    codexTokenCount({ input_tokens: 1000, cached_input_tokens: 0, output_tokens: 100 }),
    codexTokenCount({ input_tokens: 3000, cached_input_tokens: 0, output_tokens: 400 }),
  ]);
  const usage = await conversationUsage({ harness: { id: "codex", transcripts: root }, conversation: { harness: "codex", id }, cwd: CWD, startedAt: STARTED });
  assert.equal(usage.byModel[0].usage.input, 3000);
  assert.equal(usage.byModel[0].usage.output, 400);
});

test("every Codex rollout descended from a thread is found, at any depth and under any label", async () => {
  const root = await transcriptsRoot();
  const folder = path.join(root, codexDayFolder());
  const parent = "01a00000-0000-7000-8000-00000000000a";
  const child = "01a00000-0000-7000-8000-00000000000b";
  const grandchild = "01a00000-0000-7000-8000-00000000000c";
  const guardian = "01a00000-0000-7000-8000-00000000000d";
  const stranger = "01a00000-0000-7000-8000-00000000000e";
  await writeJsonl(path.join(folder, `rollout-a-${parent}.jsonl`), [codexMeta({ id: parent }), codexTokenCount({ input_tokens: 100, output_tokens: 10 })]);
  // Depth 1: the spawn link and the session link agree.
  await writeJsonl(path.join(folder, `rollout-b-${child}.jsonl`), [
    codexMeta({ id: child, sessionId: parent, threadSource: "subagent", source: { subagent: { thread_spawn: { parent_thread_id: parent, depth: 1 } } } }),
    codexTokenCount({ input_tokens: 200, output_tokens: 20 }),
  ]);
  // Depth 2: the spawn link names the child, and session_id names the root.
  await writeJsonl(path.join(folder, `rollout-c-${grandchild}.jsonl`), [
    codexMeta({ id: grandchild, sessionId: parent, threadSource: "subagent", source: { subagent: { thread_spawn: { parent_thread_id: child, depth: 2 } } } }),
    codexTokenCount({ input_tokens: 400, output_tokens: 40 }),
  ]);
  // A guardian review carries no spawn link at all; only session_id reaches it.
  await writeJsonl(path.join(folder, `rollout-d-${guardian}.jsonl`), [
    codexMeta({ id: guardian, sessionId: parent, threadSource: "guardian_review", source: { subagent: { other: "guardian" } } }),
    codexTokenCount({ input_tokens: 800, output_tokens: 80 }),
  ]);
  await writeJsonl(path.join(folder, `rollout-e-${stranger}.jsonl`), [codexMeta({ id: stranger }), codexTokenCount({ input_tokens: 9999, output_tokens: 999 })]);

  const resolved = await resolveConversationFiles({ harness: { id: "codex", transcripts: root }, conversation: { harness: "codex", id: parent }, cwd: CWD, startedAt: STARTED });
  assert.equal(resolved.subagents.length, 3);
  const usage = await conversationUsage({ harness: { id: "codex", transcripts: root }, conversation: { harness: "codex", id: parent }, cwd: CWD, startedAt: STARTED });
  assert.equal(usage.byModel[0].usage.input, 1500);
  assert.equal(usage.byModel[0].usage.output, 150);
});

test("a Codex thread is discovered by folder and start time, and a subagent is never mistaken for one", async () => {
  const root = await transcriptsRoot();
  const folder = path.join(root, codexDayFolder());
  const parent = "01a00000-0000-7000-8000-0000000000f1";
  const child = "01a00000-0000-7000-8000-0000000000f2";
  await writeJsonl(path.join(folder, `rollout-a-${parent}.jsonl`), [codexMeta({ id: parent })]);
  await writeJsonl(path.join(folder, `rollout-b-${child}.jsonl`), [codexMeta({ id: child, sessionId: parent, threadSource: "subagent" })]);
  const found = await findCodexThread({ transcripts: root, cwd: CWD, startedAt: STARTED });
  assert.equal(found.id, parent);
});

test("a pi conversation resolves through the folder rule that pi actually uses", async () => {
  const root = await transcriptsRoot();
  const id = "66666666-6666-4666-8666-666666666666";
  // pi writes <slug>/<timestamp>_<id>.jsonl, not <id>.jsonl. Reading it at
  // the wrong path is why no pi conversation had ever resolved.
  await writeJsonl(path.join(root, piProjectKey(CWD), `2026-09-03T04-00-00_${id}.jsonl`), [
    { type: "session", cwd: CWD },
    { type: "message", message: { role: "assistant", provider: "resetdata-glm", model: "zai/glm-5.2", usage: { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 0 } } },
  ]);
  const cost = await conversationCost({ harness: { id: "pi-code", transcripts: root }, conversation: { harness: "pi-code", id }, cwd: CWD });
  assert.equal(cost.path.endsWith(`_${id}.jsonl`), true);
  // 1.58 input + 4.96 output + 0.16 cached, per million.
  assert.equal(Number(cost.amount.toFixed(4)), 6.7);
  assert.ok(cost.notes.some((note) => note.includes("pi records subagent work inside the conversation")));
});

test("a pi conversation whose attempt lost its cwd still resolves by scanning", async () => {
  const root = await transcriptsRoot();
  const id = "77777777-7777-4777-8777-777777777777";
  await writeJsonl(path.join(root, piProjectKey(CWD), `2026-09-03T04-00-00_${id}.jsonl`), [{ type: "session", cwd: CWD }]);
  const resolved = await resolveConversationFiles({ harness: { id: "pi-code", transcripts: root }, conversation: { harness: "pi-code", id }, cwd: null });
  assert.equal(resolved.path.endsWith(`_${id}.jsonl`), true);
});

test("a missing transcript says so rather than reading as no spend", async () => {
  const root = await transcriptsRoot();
  const usage = await conversationUsage({ harness: { id: "claude", transcripts: root }, conversation: { harness: "claude", id: "absent" }, cwd: CWD });
  assert.equal(usage.path, null);
  assert.deepEqual(usage.notes, ["the transcript for this conversation was not found"]);
});

test("a conversation record that still names its harness under the old key is read", async () => {
  const root = await transcriptsRoot();
  const id = "88888888-8888-4888-8888-888888888888";
  await writeJsonl(path.join(root, claudeProjectKey(CWD), `${id}.jsonl`), [claudeRow("msg", "claude-opus-5", { input_tokens: 0, output_tokens: 1_000_000 })]);
  const cost = await conversationCost({ harness: { id: "claude", transcripts: root }, conversation: { provider: "claude", id }, cwd: CWD });
  assert.equal(cost.amount, 25);
});

test("a reading is reused while the files are unchanged and redone when one grows", async () => {
  const root = await transcriptsRoot();
  const id = "99999999-9999-4999-8999-999999999999";
  const file = path.join(root, claudeProjectKey(CWD), `${id}.jsonl`);
  await writeJsonl(file, [claudeRow("msg_one", "claude-opus-5", { input_tokens: 0, output_tokens: 100 })]);
  const cache = new Map();
  const harness = { id: "claude", transcripts: root };
  const conversation = { harness: "claude", id };
  const first = await conversationUsage({ harness, conversation, cwd: CWD, cache });
  assert.equal(cache.size, 1);
  assert.equal((await conversationUsage({ harness, conversation, cwd: CWD, cache })).byModel[0].usage.output, first.byModel[0].usage.output);
  await writeJsonl(file, [
    claudeRow("msg_one", "claude-opus-5", { input_tokens: 0, output_tokens: 100 }),
    claudeRow("msg_two", "claude-opus-5", { input_tokens: 0, output_tokens: 900 }),
  ]);
  assert.equal((await conversationUsage({ harness, conversation, cwd: CWD, cache })).byModel[0].usage.output, 1000);
});
