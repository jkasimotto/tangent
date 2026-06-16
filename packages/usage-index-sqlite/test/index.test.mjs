import assert from "node:assert/strict";
import test from "node:test";

import { ensureUsageIndex, openUsage, openUsageFromSqlite } from "../dist/index.js";

test("usage index sqlite exports compatibility and client loaders", () => {
  assert.equal(typeof ensureUsageIndex, "function");
  assert.equal(typeof openUsage, "function");
  assert.equal(typeof openUsageFromSqlite, "function");
});
