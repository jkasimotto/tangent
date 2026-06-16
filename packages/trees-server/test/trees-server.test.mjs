import assert from "node:assert/strict";
import test from "node:test";

import { createTreesUiApp } from "../dist/index.js";

test("creates a trees ui app descriptor", () => {
  const registration = createTreesUiApp();
  assert.deepEqual(registration.app, {
    id: "trees",
    label: "Trees",
    routePath: "/trees",
    modulePath: "/apps/trees/embedded.js",
    stylePaths: ["/apps/trees/embedded.css"]
  });
  assert.equal(registration.routes.length, 0);
  assert.equal(registration.assetMounts[0].pathPrefix, "/apps/trees");
});
