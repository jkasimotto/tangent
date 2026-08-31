import assert from "node:assert/strict";
import test from "node:test";

import * as cli from "../dist/cli/index.js";

test("retired worker handover commands are not public CLI surfaces", async () => {
  assert.equal("runHandoverCli" in cli, false);
  await assert.rejects(
    () => cli.runGoalCli(["handover", "Finished the assignment."]),
    /Unknown goal command: handover/,
  );
});
