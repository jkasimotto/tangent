import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { inputPreview, projectConversation, variantConversationsView } from "../dist/server/conversation-view.js";

test("inputPreview pulls the identifying field and collapses whitespace", () => {
  assert.equal(inputPreview("git   status\n"), "git status");
  assert.equal(inputPreview({ command: "npm run test" }), "npm run test");
  assert.equal(inputPreview({ file_path: "/a/SKILL.md" }), "/a/SKILL.md");
  assert.equal(inputPreview({ skill: "expression-functions", args: "" }), "expression-functions");
  assert.equal(inputPreview({ unrelated: "x" }), undefined);
  assert.equal(inputPreview(undefined), undefined);
  assert.equal(inputPreview({ command: "x".repeat(200) }).length, 160);
});

test("projectConversation flattens turns and tool calls into the compact view", () => {
  const normalized = {
    schema: "usage.conversation.v1",
    provider: "claude",
    conversationId: "claude:abc",
    startedAt: "2026-06-29T00:00:00.000Z",
    endedAt: "2026-06-29T00:05:00.000Z",
    messages: [
      { id: "u1", role: "user", at: "2026-06-29T00:00:00.000Z", text: "do it", confidence: "exact" },
      {
        id: "a1",
        role: "assistant",
        at: "2026-06-29T00:01:00.000Z",
        model: "claude-opus",
        text: "reading the skill",
        thinking: "let me check",
        tokens: { source: "x", confidence: "unknown" },
        confidence: "exact",
        toolCalls: [
          { id: "t1", name: "Read", category: "file", input: { file_path: "/repo/.claude/skills/x/SKILL.md" }, result: { status: "success", durationMs: 12 }, targetPaths: ["/repo/.claude/skills/x/SKILL.md"], evidenceEventIds: [] }
        ]
      }
    ],
    totals: { userMessages: 1, assistantMessages: 1, toolCalls: 1 },
    caveats: []
  };
  const view = projectConversation(normalized);
  assert.equal(view.id, "claude:abc");
  assert.equal(view.provider, "claude");
  assert.equal(view.messages.length, 2);
  assert.deepEqual(view.messages[0].toolCalls, []);
  assert.equal(view.messages[0].model, undefined);
  assert.equal(view.messages[1].model, "claude-opus");
  assert.equal(view.messages[1].thinking, "let me check");
  assert.equal(view.messages[1].toolCalls[0].name, "Read");
  assert.equal(view.messages[1].toolCalls[0].status, "success");
  assert.equal(view.messages[1].toolCalls[0].inputPreview, "/repo/.claude/skills/x/SKILL.md");
  assert.deepEqual(view.messages[1].toolCalls[0].targetPaths, ["/repo/.claude/skills/x/SKILL.md"]);
});

test("projectConversation relativizes tool paths and commands against the worktree", () => {
  // A realistic full worktree, so the strip-before-clip case below is genuine (a long grep pattern
  // pushes the worktree prefix across the 160-char clip boundary, truncating it mid-path).
  const wt = "/Users/me/.tangent/eval/runs/20260629T031727Z-context/variants/debug-log-haiku-no-ctx/work/acme";
  const normalized = {
    schema: "usage.conversation.v1",
    provider: "claude",
    conversationId: "claude:rel",
    messages: [
      {
        id: "a1",
        role: "assistant",
        model: "claude-haiku",
        text: "",
        toolCalls: [
          { id: "t1", name: "Bash", category: "command", input: { command: `find ${wt}/client -name '*.dart'` }, result: { status: "success" }, targetPaths: [], evidenceEventIds: [] },
          { id: "t2", name: "Read", category: "file", input: { file_path: `${wt}/lib/a.dart` }, result: { status: "success" }, targetPaths: [`${wt}/lib/a.dart`, "/outside/b.dart"], evidenceEventIds: [] },
          { id: "t3", name: "Bash", category: "command", input: { command: `grep -r "${"needle ".repeat(10)}" ${wt}/client/lib` }, result: { status: "success" }, targetPaths: [], evidenceEventIds: [] },
          { id: "t4", name: "Bash", category: "command", input: { command: `cd ${wt} && git status` }, result: { status: "success" }, targetPaths: [], evidenceEventIds: [] }
        ]
      }
    ],
    totals: { userMessages: 0, assistantMessages: 1, toolCalls: 3 },
    caveats: []
  };
  const view = projectConversation(normalized, wt);
  assert.equal(view.messages[0].toolCalls[0].inputPreview, "find client -name '*.dart'");
  assert.equal(view.messages[0].toolCalls[1].inputPreview, "lib/a.dart");
  assert.deepEqual(view.messages[0].toolCalls[1].targetPaths, ["lib/a.dart", "/outside/b.dart"]);
  // Strip must happen before clip: the prefix lands past char 160, so stripping after clip would leave
  // a truncated, unmatchable fragment behind.
  const longGrep = view.messages[0].toolCalls[2].inputPreview;
  assert.ok(!longGrep.includes("/Users/me/"), `worktree prefix should be gone: ${longGrep}`);
  assert.ok(longGrep.includes("client/lib"), `relative path should survive: ${longGrep}`);
  // A bare `cd <worktree>` (no trailing slash) collapses to the current directory.
  assert.equal(view.messages[0].toolCalls[3].inputPreview, "cd . && git status");
});

test("variantConversationsView returns a note when the variant has no metrics", async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), "eval-convo-"));
  const manifest = { runDir };
  const variant = { caseId: "c1", variantId: "v1", worktree: runDir };
  const view = await variantConversationsView(manifest, "c1", variant);
  assert.equal(view.schema, "eval.conversations.v1");
  assert.equal(view.variantId, "v1");
  assert.deepEqual(view.conversations, []);
  assert.equal(view.notes.length, 1);
  assert.match(view.notes[0], /No metrics captured/);
});
