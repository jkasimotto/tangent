import assert from "node:assert/strict";
import test from "node:test";

import { goalCommandSpec, runGoalCli } from "../dist/cli/index.js";

/** Runs one goal CLI call against a fetch stub and returns the printed lines. */
async function runWithDetail(argv, detail, seen) {
  const printed = [];
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  console.log = (...parts) => printed.push(parts.join(" "));
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    seen.push(url.pathname + url.search);
    if (url.pathname === "/api/goals/show") return Response.json({ goal: { slug: "resume", file: "otto/test/goal-resume.md", area: "otto/test", status: "done", title: "Resume it" } });
    if (url.pathname === "/api/goals/detail") return Response.json(detail);
    return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
  };
  try {
    await runGoalCli(argv);
  } finally {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
  }
  return printed;
}

test("tangent goal show has a --conversations lookup option", () => {
  const show = goalCommandSpec.subcommands.find((entry) => entry.name === "show");
  assert.deepEqual(show.options.map((entry) => entry.name), ["conversations", "server", "json"]);
});

test("tangent goal show prints session, cwd, harness, conversation, resume command, and context per attempt", async () => {
  const detail = {
    goal: { slug: "resume", file: "otto/test/goal-resume.md", area: "otto/test", status: "done", title: "Resume it", doneWhen: "It resumes." },
    queue: { status: "complete", revision: 4, currentAssignmentId: null, assignments: [{ id: "a1", status: "complete", attempts: [] }] },
    attempts: [
      {
        id: "attempt-1", session: "test--resume-s1", cwd: "/work/one",
        resolvedLaunch: { ref: { harness: "claude-otto", model: "opus-5", effort: "high" }, command: "claude-otto --model claude-opus-5 --effort high" },
        resume: { live: false, conversationId: "abc-123", command: "claude-otto --model claude-opus-5 --effort high --resume abc-123", contextFill: { usedTokens: 158400, windowTokens: 1000000 } },
      },
      {
        id: "attempt-2", session: "test--resume-s2", cwd: "/work/two",
        resolvedLaunch: { ref: { harness: "codex", model: "sol", effort: null }, command: "codex --model gpt-5.6-sol" },
        resume: { live: true, conversationId: null, command: null, found: [{ id: "main-id" }, { id: "guardian-id" }], contextFill: null },
      },
    ],
  };
  const seen = [];
  const lines = await runWithDetail(["show", "resume", "--conversations"], detail, seen);
  assert.ok(seen.some((request) => request === "/api/goals/detail?goal=otto%2Ftest%2Fgoal-resume.md&conversations=1"), seen.join("\n"));
  const text = lines.join("\n");
  assert.match(text, /^attempts:$/m);
  assert.match(text, /^  1\. session test--resume-s1$/m);
  assert.match(text, /^     cwd: \/work\/one$/m);
  assert.match(text, /^     harness: claude-otto\/opus-5\/high$/m);
  assert.match(text, /^     conversation: abc-123$/m);
  assert.match(text, /^     resume: claude-otto --model claude-opus-5 --effort high --resume abc-123$/m);
  assert.match(text, /^     context: 158k of 1000k$/m);
  assert.match(text, /^  2\. session test--resume-s2 \(live\)$/m);
  assert.match(text, /^     harness: codex\/sol$/m);
  assert.match(text, /^     conversation: not recorded$/m);
  assert.match(text, /^     found: main-id, guardian-id \(two match, pass one to resume\)$/m);
  assert.match(text, /^     resume: none$/m);
  assert.match(text, /^     context: not seen$/m);

  const plain = await runWithDetail(["show", "resume"], detail, seen);
  assert.ok(seen.some((request) => request === "/api/goals/detail?goal=otto%2Ftest%2Fgoal-resume.md"));
  assert.match(plain.join("\n"), /^attempts:$/m);
});
