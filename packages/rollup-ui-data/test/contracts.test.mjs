import assert from "node:assert/strict";
import test from "node:test";

import { emptyRollupPreview } from "../dist/index.js";

test("empty rollup preview includes trade-off stats", () => {
  const preview = emptyRollupPreview();
  assert.equal(preview.tokensIncluded, 0);
  assert.equal(preview.tokensExcluded, 0);
  assert.deepEqual(preview.coverageByRole, {});
});
