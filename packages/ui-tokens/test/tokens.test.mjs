import assert from "node:assert/strict";
import test from "node:test";

import { tangentTokens } from "../dist/index.js";

test("exports semantic token groups", () => {
  assert.equal(tangentTokens.color.accent, "var(--tangent-color-accent)");
  assert.deepEqual(Object.keys(tangentTokens.density), ["compact", "comfortable", "spacious"]);
});
