import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { expandHome, findCodexRollouts, launchWithConversation, newConversation, resumeCommand } from "./harness-conversation.mjs";

const claude = { id: "claude-otto", command: "claude-otto", resume: "{command} --resume {id}", sessionIdArg: "--session-id {id}" };
const pi = { id: "pi-code", command: "pi-code", resume: "{command} --session {id}", sessionIdArg: "--session-id {id}" };
const codex = { id: "codex", command: "codex", resume: "codex resume {id}", transcripts: "~/.codex/sessions" };
const codexOtto = { id: "codex-otto", command: "codex --approve-for-me", resume: "{command} resume {id}", transcripts: "~/.codex/sessions" };
const agy = { id: "agy", command: "agy" };

test("claude and pi get a fresh uuid at launch, codex does not", () => {
  /** A fixed id so the test can read the appended flag. */
  const makeId = () => "11111111-2222-4333-8444-555555555555";
  const claudeConversation = newConversation(claude, makeId);
  // `harness` and `provider` both hold the harness id: `provider` was
  // always a harness id here, and it stays so records already on disk keep
  // working now that the word also names the account a model was served by.
  assert.deepEqual(claudeConversation, { harness: "claude-otto", provider: "claude-otto", id: "11111111-2222-4333-8444-555555555555" });
  assert.equal(launchWithConversation(claude, "claude-otto --model claude-opus-5", claudeConversation), "claude-otto --model claude-opus-5 --session-id 11111111-2222-4333-8444-555555555555");
  const piConversation = newConversation(pi, makeId);
  assert.equal(launchWithConversation(pi, "pi-code --thinking high", piConversation), "pi-code --thinking high --session-id 11111111-2222-4333-8444-555555555555");
  assert.equal(newConversation(codex, makeId), null);
  assert.equal(launchWithConversation(codex, "codex --model gpt-5.6-sol", null), "codex --model gpt-5.6-sol");
  assert.equal(newConversation(agy, makeId), null);
});

test("the resume command keeps the launch line and the harness syntax", () => {
  assert.equal(resumeCommand(claude, { command: "claude-otto --model claude-opus-5 --effort high", id: "abc" }), "claude-otto --model claude-opus-5 --effort high --resume abc");
  assert.equal(resumeCommand(codex, { command: "codex --model gpt-5.6-sol", id: "abc" }), "codex resume abc");
  assert.equal(resumeCommand(codexOtto, { command: "codex --approve-for-me --model gpt-5.6-sol -c model_reasoning_effort=high", id: "abc" }), "codex --approve-for-me --model gpt-5.6-sol -c model_reasoning_effort=high resume abc");
  assert.equal(resumeCommand(pi, { command: "pi-code", id: "abc" }), "pi-code --session abc");
  assert.equal(resumeCommand(agy, { command: "agy", id: "abc" }), null, "a harness without resume has no Resume verb");
  assert.equal(resumeCommand(claude, { command: "claude-otto", id: "" }), null, "no id, no command");
});

test("expandHome reads a registry path the way the shell writes it", () => {
  assert.equal(expandHome("~/.codex/sessions"), path.join(os.homedir(), ".codex/sessions"));
  assert.equal(expandHome("/abs/path"), "/abs/path");
});

test("codex rollouts are found by folder and start time, and both of two matches are shown", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-sessions-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const startedAt = "2026-08-26T20:29:24.072Z";
  const day = new Date(startedAt);
  /** Two-digit month or day. */
  const pad = (n) => String(n).padStart(2, "0");
  const folder = path.join(root, String(day.getFullYear()), pad(day.getMonth() + 1), pad(day.getDate()));
  await mkdir(folder, { recursive: true });
  /** Writes one rollout whose first line is the session_meta record. */
  const rollout = async (name, id, cwd, timestamp, threadSource = "user") => writeFile(path.join(folder, name), [
    JSON.stringify({ timestamp, type: "session_meta", payload: { id, session_id: id, cwd, timestamp, thread_source: threadSource } }),
    JSON.stringify({ type: "event_msg", payload: { text: "x".repeat(20000) } }),
  ].join("\n") + "\n", "utf8");
  await rollout("rollout-a.jsonl", "main-id", "/work/here", "2026-08-26T20:29:24.203Z");
  await rollout("rollout-b.jsonl", "guardian-id", "/work/here", "2026-08-26T20:29:24.403Z", "subagent");
  await rollout("rollout-c.jsonl", "other-cwd", "/work/elsewhere", "2026-08-26T20:29:24.300Z");
  await rollout("rollout-d.jsonl", "too-late", "/work/here", "2026-08-26T20:31:24.300Z");
  await writeFile(path.join(folder, "rollout-broken.jsonl"), "not json\n", "utf8");
  const found = await findCodexRollouts({ transcripts: root, cwd: "/work/here", startedAt });
  assert.deepEqual(found.map((item) => item.id), ["main-id", "guardian-id"]);
  assert.equal(found[0].transcriptPath, path.join(folder, "rollout-a.jsonl"));
  assert.equal(found[1].threadSource, "subagent");
  assert.deepEqual(await findCodexRollouts({ transcripts: root, cwd: "/nowhere", startedAt }), []);
  assert.deepEqual(await findCodexRollouts({ transcripts: path.join(root, "missing"), cwd: "/work/here", startedAt }), []);
});
