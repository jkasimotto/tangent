import assert from "node:assert/strict";
import test from "node:test";

import { createUsageClient, UsageDataset } from "../dist/index.js";

test("usage core exports dataset and in-memory client APIs", async () => {
  const dataset = new UsageDataset([]);
  assert.deepEqual(dataset.conversations.all().data, []);
  const client = createUsageClient({ events: [] });
  assert.deepEqual((await client.sessions.list()).data, []);
});
