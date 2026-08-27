import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { contextReminderText, contextRepeatText } from "./context-handover.mjs";

test("context reminders tell the worker to send the brain a note and never to replace itself", async () => {
  const reminder = contextReminderText({ usedTokens: 310_000, windowTokens: 400_000, subject: "assignment" });
  const repeat = contextRepeatText({ usedTokens: 340_000, thresholdTokens: 300_000, subject: "assignment" });
  assert.match(reminder, /tangent send brain "<facts>"/);
  assert.match(reminder, /Do not replace yourself/);
  assert.match(repeat, /tangent send brain "<facts>"/);
  assert.doesNotMatch(`${reminder}\n${repeat}`, /--continue|context-risk|tangent handover/);

  const routes = await readFile(new URL("./pipeline-routes.mjs", import.meta.url), "utf8");
  const server = await readFile(new URL("./server.mjs", import.meta.url), "utf8");
  assert.match(routes, /Workers cannot replace themselves/);
  assert.doesNotMatch(server, /continueWorker: continueWorkerSession/);
});
