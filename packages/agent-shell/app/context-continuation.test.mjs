import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { contextReminderText, contextRepeatText } from "./context-handover.mjs";

test("context risk returns to the queue controller and workers cannot replace themselves", async () => {
  const reminder = contextReminderText({ usedTokens: 310_000, windowTokens: 400_000, subject: "assignment" });
  const repeat = contextRepeatText({ usedTokens: 340_000, thresholdTokens: 300_000, subject: "assignment" });
  assert.match(reminder, /typed context-risk report/);
  assert.match(reminder, /exact Area brain chooses and starts any fresh attempt/);
  assert.match(repeat, /typed context-risk report now/);
  assert.doesNotMatch(`${reminder}\n${repeat}`, /--continue/);

  const routes = await readFile(new URL("./pipeline-routes.mjs", import.meta.url), "utf8");
  const server = await readFile(new URL("./server.mjs", import.meta.url), "utf8");
  assert.match(routes, /Workers cannot replace themselves/);
  assert.doesNotMatch(server, /continueWorker: continueWorkerSession/);
});
