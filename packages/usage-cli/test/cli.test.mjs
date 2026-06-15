import assert from "node:assert/strict";
import test from "node:test";

import { usageCliPackage } from "../dist/index.js";

test("exports cli package marker", () => {
  assert.equal(usageCliPackage, "@tangent/usage-cli");
});
