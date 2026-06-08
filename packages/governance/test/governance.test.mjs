import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { lintGovernance } from "../dist/index.js";

test("dependency lint flags disallowed vertical package dependencies", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tangent-governance-"));
  try {
    const convosDir = path.join(root, "packages", "convos");
    await mkdir(convosDir, { recursive: true });
    await writeFile(path.join(convosDir, "package.json"), JSON.stringify({
      name: "@convos/convos",
      version: "0.0.0",
      type: "module",
      dependencies: {
        "@tangent/daily": "file:../daily"
      }
    }), "utf8");

    const result = await lintGovernance({ root, groups: ["deps"] });
    assert.equal(result.errors, 1);
    assert.equal(result.findings[0].rule, "deps/package-boundaries");
    assert.equal(result.findings[0].message.includes("@convos/convos depends on @tangent/daily"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
