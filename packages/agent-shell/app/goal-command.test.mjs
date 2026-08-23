import assert from "node:assert/strict";
import test from "node:test";

import { goalCreateRequest, runGoalCommand } from "./goal-command.mjs";

test("the Goal command converts explicit options into one canonical schema request", async () => {
  const argv = [
    "create",
    "--server", "http://127.0.0.1:4789",
    "--area", "otto/dnd",
    "--title", "Connect chosen ramp faces",
    "--done-when", "The chosen faces connect at the dragged width.",
    "--description", "Keep connection validity separate from mover capability.",
    "--source", "otto/dnd/ramp-connection-behavior.md",
    "--subgoal-title", "Freeze the fixture",
    "--subgoal-done-when", "The current scene has a stable test fixture.",
  ];
  assert.deepEqual(goalCreateRequest(argv), {
    server: new URL("http://127.0.0.1:4789"),
    payload: {
      area: "otto/dnd",
      description: "Keep connection validity separate from mover capability.",
      goal: {
        title: "Connect chosen ramp faces",
        doneWhen: "The chosen faces connect at the dragged width.",
        state: "Not started.",
      },
      subgoals: [{
        title: "Freeze the fixture",
        doneWhen: "The current scene has a stable test fixture.",
      }],
      sources: ["otto/dnd/ramp-connection-behavior.md"],
    },
  });

  const calls = [];
  const result = await runGoalCommand(argv, async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      /** Returns the fixture response body. */
      async json() { return { file: "otto/dnd/goal-connect-chosen-ramp-faces.md" }; },
    };
  });
  assert.equal(result.file, "otto/dnd/goal-connect-chosen-ramp-faces.md");
  assert.equal(calls[0].url, "http://127.0.0.1:4789/api/goals/create");
  assert.deepEqual(JSON.parse(calls[0].options.body), goalCreateRequest(argv).payload);
});

test("the Goal command rejects incomplete structures and non-local writers", () => {
  assert.throws(() => goalCreateRequest(["create", "--area", "otto/dnd", "--title", "Missing condition"]), /--done-when is required/);
  assert.throws(() => goalCreateRequest([
    "create", "--area", "otto/dnd", "--title", "Parent", "--done-when", "Done.", "--subgoal-title", "Child",
  ]), /Each --subgoal-title needs one --subgoal-done-when/);
  assert.throws(() => goalCreateRequest([
    "create", "--server", "https://example.com", "--area", "otto/dnd", "--title", "Parent", "--done-when", "Done.",
  ]), /local HTTP Agent Shell URL/);
});
