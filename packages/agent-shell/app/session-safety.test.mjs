import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

test("background Goal reconciliation cannot stop an agent session", async () => {
  const [source, controls] = await Promise.all([
    readFile(path.join(here, "server.mjs"), "utf8"),
    readFile(path.join(here, "shell-control-routes.mjs"), "utf8"),
  ]);
  const reconcile = source.match(/async function reconcileGoals\(sessions\) \{[\s\S]*?\n\}\n\nconst goalInfoCache/)?.[0] ?? "";
  assert.match(reconcile, /preserved session/);
  assert.doesNotMatch(reconcile, /kill-session|cascadeGoalDone/);
  assert.match(controls, /url\.pathname\.startsWith\("\/api\/kill\/"\)/);
  assert.match(source, /"kill-session", "-t", "=" \+ name/);
});

test("the pane observer owns context parsing and session enrichment", async () => {
  const source = await readFile(path.join(here, "pane-observer.mjs"), "utf8");
  assert.match(source, /parseContextFill\(text\)/);
  assert.match(source, /context: observed\.context \?\? null/);
  assert.match(source, /context: null/);
});

test("a context-handover swap kills the old session directly, never through endPipelineForSession", async () => {
  const source = await readFile(path.join(here, "server.mjs"), "utf8");
  const swap = source.match(/async function continueWorkerSession\([\s\S]*?\n\}\n\n(?=(?:\/\*\*[\s\S]*?\*\/\n)?async function completePipelineStep)/)?.[0] ?? "";
  assert.match(swap, /"kill-session"/);
  assert.doesNotMatch(swap, /endPipelineForSession/);
});
