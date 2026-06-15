import assert from "node:assert/strict";
import test from "node:test";

import { sqliteIndex } from "../dist/index.js";

test("describes sqlite index", () => {
  assert.deepEqual(sqliteIndex("usage.db"), { kind: "sqlite", path: "usage.db" });
});
