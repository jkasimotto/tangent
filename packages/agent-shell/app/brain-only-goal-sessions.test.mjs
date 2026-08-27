// Everything starts through the brain (D8, ADR-0041). The collaborate start
// (`POST /api/goals/agent`, the Goal row Start agent button, the reader start
// command) was deleted on Julian's word on 2026-08-28. This test pins the
// remaining creators of a Goal session (tmux kind `goal`) to the brain-gated
// paths, so a new direct start cannot come back unnoticed.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The name of the top-level function that encloses one character offset. */
function enclosingFunction(source, offset) {
  const heads = [...source.matchAll(/^(?:async )?function (\w+)\(/gm)];
  let name = "";
  for (const head of heads) {
    if (head.index > offset) break;
    name = head[1];
  }
  return name;
}

test("only brain-gated paths create a Goal session", async () => {
  const server = await readFile(path.join(here, "server.mjs"), "utf8");
  const routes = await readFile(path.join(here, "launch-routes.mjs"), "utf8");

  // The one spawner, and the paths that reach it: the queue start behind
  // `POST /api/goals/start` and `tangent goal create --start`, both refused for
  // a caller that is not a live brain, and the exact-attempt replacement,
  // refused the same way.
  const spawnCallers = [...server.matchAll(/spawnGoalSession\(/g)]
    .map((hit) => enclosingFunction(server, hit.index))
    .filter((name) => name !== "spawnGoalSession");
  assert.deepEqual([...new Set(spawnCallers)].sort(), ["replaceGoalAttemptUnlocked", "startPipelineStep"]);
  assert.match(server.slice(server.indexOf("async function replaceGoalAttemptUnlocked("), server.indexOf("async function replaceGoalAttemptUnlocked(") + 800), /liveCallingBrain\(options\.caller\)/, "a replacement needs a live brain caller");
  assert.match(server.slice(server.indexOf("async start(body)"), server.indexOf("async start(body)") + 1200), /liveCallingBrain\(caller\)/, "a start needs a live brain caller");

  // Every tmux session labeled kind `goal` is created inside the spawner or
  // relabeled from an owned work-definition session; nothing else labels one.
  const kindWriters = [...server.matchAll(/@tangent_kind", "goal"/g)].map((hit) => enclosingFunction(server, hit.index));
  assert.deepEqual([...new Set(kindWriters)].sort(), ["adoptGoalSession", "spawnGoalSession"]);

  // The collaborate start is gone end to end.
  assert.doesNotMatch(routes, /goals\/agent|collaborate/);
  assert.doesNotMatch(server, /collaborationPrompt|"collaborate"|api\/goals\/agent/);
});
