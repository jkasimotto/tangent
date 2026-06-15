import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { lintGovernance } from "../dist/index.js";

test("dependency lint flags disallowed vertical package dependencies", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tangent-governance-"));
  try {
    const usageDir = path.join(root, "packages", "usage");
    await mkdir(usageDir, { recursive: true });
    await writeFile(path.join(usageDir, "package.json"), JSON.stringify({
      name: "@tangent/usage",
      version: "0.0.0",
      type: "module",
      bin: {
        "tangent-usage": "./dist/cli/index.js"
      },
      dependencies: {
        "@tangent/rollup": "^0.1.0"
      }
    }), "utf8");

    const result = await lintGovernance({ root, groups: ["deps"] });
    assert.equal(result.errors, 1);
    assert.equal(result.findings[0].rule, "deps/package-boundaries");
    assert.equal(result.findings[0].message.includes("@tangent/usage depends on @tangent/rollup"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dependency lint flags local-only Tangent dependency specs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tangent-governance-"));
  try {
    const usageDir = path.join(root, "packages", "usage");
    await mkdir(usageDir, { recursive: true });
    await writeFile(path.join(usageDir, "package.json"), JSON.stringify({
      name: "@tangent/usage",
      version: "0.0.0",
      type: "module",
      bin: {
        "tangent-usage": "./dist/cli/index.js"
      },
      dependencies: {
        "@tangent/core": "file:../core"
      }
    }), "utf8");

    const result = await lintGovernance({ root, groups: ["deps"] });
    assert.equal(result.errors, 1);
    assert.equal(result.findings[0].rule, "deps/publishable-tangent-dependencies");
    assert.equal(result.findings[0].message.includes("@tangent/usage declares dependencies.@tangent/core"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dependency lint requires standalone app binaries", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tangent-governance-"));
  try {
    const searchDir = path.join(root, "packages", "search");
    await mkdir(searchDir, { recursive: true });
    await writeFile(path.join(searchDir, "package.json"), JSON.stringify({
      name: "@tangent/search",
      version: "0.0.0",
      type: "module",
      dependencies: {
        "@tangent/core": "^0.1.0"
      }
    }), "utf8");

    const result = await lintGovernance({ root, groups: ["deps"] });
    assert.equal(result.errors, 1);
    assert.equal(result.findings[0].rule, "deps/standalone-app-bin");
    assert.equal(result.findings[0].message.includes("@tangent/search must expose tangent-search"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
