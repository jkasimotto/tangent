import assert from "node:assert/strict";
import test from "node:test";
import { projectGoalDetail } from "./goal-detail.mjs";

test("Goal detail combines narrative, blockers, Documents, queue, sessions, and attempt history", () => {
  const queue = {
    revision: 7,
    currentAssignmentId: "assignment-2",
    steps: [
      { id: "assignment-1", index: 1, instruction: "Design.", status: "complete", attempts: [{ id: "attempt-1", session: "designer", endedAt: "then", resolvedLaunch: { harness: "codex", model: "sol", effort: "high" } }] },
      { id: "assignment-2", index: 2, instruction: "Implement.", status: "running", session: "worker", attempts: [{ id: "attempt-2", session: "worker", endedAt: null, resolvedLaunch: { harness: "claude", model: "fable-5", effort: null } }] },
    ],
  };
  const detail = projectGoalDetail({
    goal: {
      file: "otto/test/goal-ship.md", slug: "ship", title: "Ship", status: "active", session: "worker", doneWhen: "The change ships.",
      stateText: "Working.", documents: [{ file: "otto/test/design.md", title: "Design" }],
      dependsOn: [{ file: "goal-api.md", title: "API", status: "deferred" }, { file: "goal-schema.md", title: "Schema", status: "done" }],
      requiredBy: [{ file: "goal-release.md", title: "Release", status: "open" }], unresolvedDependencies: ["missing"],
    },
    markdown: "# Ship\n\n## State\n\nWorking.\n",
    queue,
    sessions: [{ name: "worker", goal: "otto/test/goal-ship.md", state: "working" }, { name: "unrelated", goal: "other.md" }],
  });
  assert.equal(detail.markdown.startsWith("# Ship"), true);
  assert.equal(detail.dependencies.blocked, true);
  assert.deepEqual(detail.dependencies.blockers.map((item) => item.status), ["parked", "missing"]);
  assert.deepEqual(detail.relatedDocuments.map((item) => item.file), ["otto/test/design.md"]);
  assert.deepEqual(detail.sessions.map((item) => item.name), ["worker"]);
  assert.deepEqual(detail.attempts.map((attempt) => [attempt.id, attempt.current]), [["attempt-1", false], ["attempt-2", true]]);
  assert.deepEqual(detail.current, { assignmentId: "assignment-2", attemptId: "attempt-2", session: "worker" });
  assert.equal(detail.commands.find((command) => command.id === "start"), undefined, "no start command: only the brain starts an agent (D8)");
  assert.equal(detail.commands.find((command) => command.id === "change-agent").enabled, true);
});

test("Goal detail exposes explicit server command reasons unchanged", () => {
  const detail = projectGoalDetail({
    goal: { file: "otto/test/goal-ready.md", status: "open" },
    commands: [
      { id: "start", label: "Start agent", enabled: false, reason: "Another live owner holds this Goal." },
      { id: "read", label: "Read Goal" },
    ],
  });
  assert.deepEqual(detail.commands, [
    { id: "start", label: "Start agent", enabled: false, reason: "Another live owner holds this Goal." },
    { id: "read", label: "Read Goal", enabled: true, reason: null },
  ]);
});

test("legacy Deferred never escapes the Goal detail read model", () => {
  const detail = projectGoalDetail({ goal: { file: "otto/test/goal-later.md", status: "deferred" } });
  assert.equal(detail.goal.status, "parked");
  assert.equal(detail.commands.find((command) => command.id === "change-agent").reason, "This Goal has no current attempt.");
});

test("Goal detail says how each attempt is resumed", () => {
  const registry = { harnesses: [
    { id: "claude-otto", command: "claude-otto", resume: "{command} --resume {id}", sessionIdArg: "--session-id {id}" },
    { id: "codex", command: "codex", resume: "codex resume {id}", transcripts: "~/.codex/sessions" },
    { id: "agy", command: "agy" },
  ] };
  const queue = {
    revision: 3,
    currentAssignmentId: "assignment-3",
    steps: [
      { id: "assignment-1", index: 1, instruction: "Design.", status: "complete", attempts: [{
        id: "attempt-1", session: "designer", cwd: "/work/design", startedAt: "2026-08-27T01:00:00.000Z", endedAt: "2026-08-27T02:00:00.000Z",
        resolvedLaunch: { ref: { harness: "claude-otto", model: "opus-5", effort: null }, command: "claude-otto --model claude-opus-5" },
        providerSession: { provider: "claude-otto", id: "conv-1" }, contextFill: { usedTokens: 158000, windowTokens: 1000000 },
      }] },
      { id: "assignment-2", index: 2, instruction: "Build.", status: "complete", attempts: [{
        id: "attempt-2", session: "builder", cwd: "/work/build", startedAt: "2026-08-27T02:00:00.000Z", endedAt: "2026-08-27T03:00:00.000Z",
        resolvedLaunch: { ref: { harness: "codex", model: "sol", effort: "high" }, command: "codex --model gpt-5.6-sol" }, providerSession: null,
      }] },
      { id: "assignment-3", index: 3, instruction: "Review.", status: "running", session: "reviewer", attempts: [{
        id: "attempt-3", session: "reviewer", cwd: "/work/review", startedAt: "2026-08-27T03:00:00.000Z", endedAt: null,
        resolvedLaunch: { ref: { harness: "agy", model: null, effort: null }, command: "agy" }, providerSession: null,
      }] },
    ],
  };
  const detail = projectGoalDetail({
    goal: { file: "otto/test/goal-resume.md", slug: "resume", status: "active", session: "reviewer" },
    queue,
    sessions: [{ name: "reviewer", goal: "otto/test/goal-resume.md", state: "working" }],
    registry,
  });
  const [first, second, third] = detail.attempts.map((attempt) => attempt.resume);
  assert.deepEqual(first, { live: false, session: "designer", cwd: "/work/design", harness: "claude-otto", conversationId: "conv-1", command: "claude-otto --model claude-opus-5 --resume conv-1", contextFill: { usedTokens: 158000, windowTokens: 1000000 } });
  assert.equal(second.command, null, "codex has no id at launch, so no command until one is found");
  assert.equal(second.conversationId, null);
  assert.equal(third.live, true, "a live attempt is attached, not resumed");
  assert.equal(third.command, null, "a harness without resume has no Resume verb");
});
