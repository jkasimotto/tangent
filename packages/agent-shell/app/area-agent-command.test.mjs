import assert from "node:assert/strict";
import test from "node:test";

import { areaAncestors } from "./area-agent-command.mjs";

test("walks area paths from the nearest area to the root", () => {
  assert.deepEqual(areaAncestors("otto/dnd/campaign"), ["otto/dnd/campaign", "otto/dnd", "otto"]);
});
