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
      tangent: {
        uiApp: {
          id: "usage"
        }
      },
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
      tangent: {
        uiApp: {
          id: "usage"
        }
      },
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

test("dependency lint keeps root product dependencies optional", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tangent-governance-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      name: "tangent",
      version: "0.0.0",
      type: "module",
      dependencies: {
        "@tangent/usage": "^0.1.0"
      }
    }), "utf8");

    const result = await lintGovernance({ root, groups: ["deps"] });
    assert.ok(result.findings.some((finding) => finding.rule === "deps/root-products-optional"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dependency lint flags root static product imports", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tangent-governance-"));
  try {
    await mkdir(path.join(root, "src", "cli"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "tangent", version: "0.0.0", type: "module" }), "utf8");
    await writeFile(path.join(root, "src", "cli", "index.ts"), "import { runUsageCli } from '@tangent/usage/cli';\n", "utf8");

    const result = await lintGovernance({ root, groups: ["deps"] });
    assert.ok(result.findings.some((finding) => finding.rule === "deps/root-no-static-product-imports"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dependency lint requires UI app manifest metadata", async () => {
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
        "@tangent/core": "^0.1.0"
      }
    }), "utf8");

    const result = await lintGovernance({ root, groups: ["deps"] });
    assert.ok(result.findings.some((finding) => finding.rule === "deps/ui-apps-declare-manifest"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
