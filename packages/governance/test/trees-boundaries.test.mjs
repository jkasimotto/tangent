import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { lintGovernance } from "../dist/index.js";

test("Trees boundary lint catches forbidden imports and sidecar references", async () => {
  const cases = [
    {
      pkg: "trees-core",
      name: "@tangent/trees-core",
      source: "import { TreesApp } from '@tangent/trees-ui';\nexport const value = TreesApp;\n",
      message: "trees-core imports trees-ui"
    },
    {
      pkg: "trees-schema",
      name: "@tangent/trees-schema",
      source: "import { spawn } from 'node:child_process';\nexport const value = spawn;\n",
      message: "trees-schema imports forbidden runtime dependency"
    },
    {
      pkg: "trees-core",
      name: "@tangent/trees-core",
      source: "export const value = 'tmux';\n",
      message: "trees-core references tmux implementation details"
    },
    {
      pkg: "trees-ui",
      name: "@tangent/trees-ui",
      source: "export const value = 'current_pulse.conf';\n",
      message: "trees-ui references old pa code"
    },
    {
      pkg: "trees-cli",
      name: "@tangent/trees-cli",
      source: "import React from 'react';\nexport const value = React;\n",
      message: "trees-cli imports React"
    }
  ];

  for (const item of cases) {
    const root = await tempRepo(item.pkg, item.name, item.source);
    const result = await lintGovernance({ root, groups: ["deps"] });
    assert.ok(result.findings.some((finding) => finding.rule === "deps/trees-boundaries" && finding.message.includes(item.message)), item.message);
  }
});

/** Documents the tempRepo helper. */
async function tempRepo(pkgDir, packageName, source) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-trees-boundary-"));
  const dir = path.join(root, "packages", pkgDir);
  await mkdir(path.join(dir, "src"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "tmp", version: "0.0.0" }), "utf8");
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: packageName, version: "0.0.0", type: "module" }), "utf8");
  await writeFile(path.join(dir, "src", "index.ts"), source, "utf8");
  return root;
}
