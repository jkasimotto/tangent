import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryUsageCoreClient } from "../dist/index.js";

test("memory usage core client returns sessions", async () => {
  const client = createMemoryUsageCoreClient([{ id: "s1", provider: "codex", metrics: {}, counts: {}, availability: { notes: [] } }]);
  assert.equal((await client.getSession("s1")).data.id, "s1");
});
