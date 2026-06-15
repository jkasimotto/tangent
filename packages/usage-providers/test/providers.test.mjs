import assert from "node:assert/strict";
import test from "node:test";

import { builtInUsageProviders } from "../dist/index.js";

test("lists built-in providers", () => {
  assert.deepEqual(builtInUsageProviders.map((provider) => provider.id), ["claude", "codex"]);
});
