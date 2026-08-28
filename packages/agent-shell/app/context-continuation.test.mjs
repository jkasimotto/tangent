import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("high context cannot create a worker notice, attention state, handover, or replacement", async () => {
  const routes = await readFile(new URL("./pipeline-routes.mjs", import.meta.url), "utf8");
  const server = await readFile(new URL("./server.mjs", import.meta.url), "utf8");
  const bestiary = await readFile(new URL("./public/prompt-bestiary.js", import.meta.url), "utf8");
  assert.match(routes, /Workers cannot replace themselves/);
  assert.doesNotMatch(server, /CONTEXT_HANDOVER_TOKENS|reconcileContextHandovers|context-reminder|contextHandoverTokens/);
  assert.doesNotMatch(server, /Your context is (?:nearly full|well past)/);
  assert.doesNotMatch(bestiary, /contextRisk|continueWorker|Context risk|configured threshold/);
});
