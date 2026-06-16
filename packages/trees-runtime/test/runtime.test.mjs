import assert from "node:assert/strict";
import test from "node:test";

import { defaultTreesHome } from "../dist/fs/index.js";
import { treesSqliteProjectionTables } from "../dist/sqlite/index.js";

test("runtime exports filesystem and sqlite helpers", () => {
  assert.match(defaultTreesHome(), /trees$/);
  assert.ok(treesSqliteProjectionTables.includes("tree_events"));
});
