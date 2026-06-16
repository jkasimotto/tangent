import assert from "node:assert/strict";
import test from "node:test";

import { builtInProviderAdapters } from "../dist/index.js";

test("lists built-in providers", () => {
  assert.deepEqual(builtInProviderAdapters.map((provider) => provider.id), ["claude", "codex"]);
});
