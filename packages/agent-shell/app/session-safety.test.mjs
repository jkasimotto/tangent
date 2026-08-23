import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

test("background Goal reconciliation cannot stop an agent session", async () => {
  const source = await readFile(path.join(here, "server.mjs"), "utf8");
  const reconcile = source.match(/async function reconcileGoals\(sessions\) \{[\s\S]*?\n\}\n\nconst goalInfoCache/)?.[0] ?? "";
  assert.match(reconcile, /preserved session/);
  assert.doesNotMatch(reconcile, /kill-session|cascadeGoalDone/);
  assert.match(source, /url\.pathname\.startsWith\("\/api\/kill\/"\)/);
  assert.match(source, /"kill-session", "-t", "=" \+ name/);
});

test("classifyState reads context fill from the pane and withAgentStates carries it", async () => {
  const source = await readFile(path.join(here, "server.mjs"), "utf8");
  const classifyState = source.match(/async function classifyState\([\s\S]*?\n\}\n/)?.[0] ?? "";
  assert.match(classifyState, /parseContextFill\(text\)/);
  const withAgentStates = source.match(/async function withAgentStates\([\s\S]*?\n\}\n/)?.[0] ?? "";
  assert.match(withAgentStates, /context: context \?\? null/);
  assert.match(withAgentStates, /context: null/);
});

test("a context-handover swap kills the old session directly, never through endPipelineForSession", async () => {
  const source = await readFile(path.join(here, "server.mjs"), "utf8");
  const swap = source.match(/async function continueWorkerSession\([\s\S]*?\n\}\n\n(?=(?:\/\*\*[\s\S]*?\*\/\n)?async function completePipelineStep)/)?.[0] ?? "";
  assert.match(swap, /"kill-session"/);
  assert.doesNotMatch(swap, /endPipelineForSession/);
});
