import assert from "node:assert/strict";
import test from "node:test";

import { usageSchemaPackage } from "../dist/index.js";

test("exports schema package marker", () => {
  assert.equal(usageSchemaPackage, "@tangent/usage-schema");
});
