import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { lintGovernance } from "../dist/index.js";

test("agent lint requires CLAUDE.md next to AGENTS.md", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tangent-governance-"));
  try {
    await writeMinimalRootAgentDocs(root);

    const result = await lintGovernance({ root, groups: ["agents"] });
    const finding = result.findings.find((candidate) => candidate.rule === "agent-docs/claude-symlink");
    assert.ok(finding);
    assert.equal(finding.file, "CLAUDE.md");
    assert.equal(finding.message, "CLAUDE.md symlink is missing for AGENTS.md.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent lint accepts CLAUDE.md symlinked to AGENTS.md", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tangent-governance-"));
  try {
    await writeMinimalRootAgentDocs(root);
    await symlink("AGENTS.md", path.join(root, "CLAUDE.md"));

    const result = await lintGovernance({ root, groups: ["agents"] });
    assert.equal(result.errors, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent lint rejects plain CLAUDE.md files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tangent-governance-"));
  try {
    await writeMinimalRootAgentDocs(root);
    await writeFile(path.join(root, "CLAUDE.md"), "# Agent Notes\n", "utf8");

    const result = await lintGovernance({ root, groups: ["agents"] });
    const finding = result.findings.find((candidate) => candidate.rule === "agent-docs/claude-symlink");
    assert.ok(finding);
    assert.equal(finding.file, "CLAUDE.md");
    assert.equal(finding.message, "CLAUDE.md must be a symlink to sibling AGENTS.md.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent lint requires AGENTS.md in every repo directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tangent-governance-"));
  try {
    await writeMinimalRootAgentDocs(root);
    await symlink("AGENTS.md", path.join(root, "CLAUDE.md"));
    await mkdir(path.join(root, "scripts"), { recursive: true });

    const result = await lintGovernance({ root, groups: ["agents"] });
    const finding = result.findings.find((candidate) => candidate.rule === "agent-docs/required" && candidate.file === "scripts/AGENTS.md");
    assert.ok(finding);
    assert.equal(finding.message, "required AGENTS.md file is missing.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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
          id: "usage",
          label: "Usage",
          serverExport: "@tangent/usage/server",
          factory: "createUsageUiApp",
          order: 10
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
          id: "usage",
          label: "Usage",
          serverExport: "@tangent/usage/server",
          factory: "createUsageUiApp",
          order: 10
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
    const rollupDir = path.join(root, "packages", "rollup");
    await mkdir(rollupDir, { recursive: true });
    await writeFile(path.join(rollupDir, "package.json"), JSON.stringify({
      name: "@tangent/rollup",
      version: "0.0.0",
      type: "module",
      dependencies: {
        "@tangent/core": "^0.1.0"
      }
    }), "utf8");

    const result = await lintGovernance({ root, groups: ["deps"] });
    assert.equal(result.errors, 1);
    assert.equal(result.findings[0].rule, "deps/standalone-app-bin");
    assert.equal(result.findings[0].message.includes("@tangent/rollup must expose tangent-rollup"), true);
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
      tangent: {
        packageMode: "thin-shell"
      },
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
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "tangent", version: "0.0.0", type: "module", tangent: { packageMode: "thin-shell" } }), "utf8");
    await writeFile(path.join(root, "src", "cli", "index.ts"), "import { runUsageCli } from '@tangent/usage/cli';\n", "utf8");

    const result = await lintGovernance({ root, groups: ["deps"] });
    assert.ok(result.findings.some((finding) => finding.rule === "deps/root-no-static-product-imports"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dependency lint requires root package mode", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tangent-governance-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      name: "tangent",
      version: "0.0.0",
      type: "module"
    }), "utf8");

    const result = await lintGovernance({ root, groups: ["deps"] });
    assert.ok(result.findings.some((finding) => finding.rule === "deps/root-package-mode"));
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

test("dependency lint prevents Rollup and Eval from pulling Usage UI transitively", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tangent-governance-"));
  try {
    const rollupDir = path.join(root, "packages", "rollup");
    const usageDir = path.join(root, "packages", "usage");
    await mkdir(rollupDir, { recursive: true });
    await mkdir(usageDir, { recursive: true });
    await writeFile(path.join(rollupDir, "package.json"), JSON.stringify({
      name: "@tangent/rollup",
      version: "0.0.0",
      type: "module",
      dependencies: {
        "@tangent/usage": "^0.1.0"
      }
    }), "utf8");
    await writeFile(path.join(usageDir, "package.json"), JSON.stringify({
      name: "@tangent/usage",
      version: "0.0.0",
      type: "module",
      tangent: {
        uiApp: {
          id: "usage",
          label: "Usage",
          serverExport: "@tangent/usage/server",
          factory: "createUsageUiApp",
          order: 10
        }
      },
      bin: {
        "tangent-usage": "./dist/cli/index.js"
      },
      dependencies: {
        "@tangent/usage-ui": "^0.1.0"
      }
    }), "utf8");

    const result = await lintGovernance({ root, groups: ["deps"] });
    assert.ok(result.findings.some((finding) => finding.rule === "deps/no-ui-transitive-for-data-consumers"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/** Writes the minimal root agent docs required by the agent lint tests. */
async function writeMinimalRootAgentDocs(root) {
  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, "AGENTS.md"), "# Agent Notes\n\nRead next:\n- docs/index.md\n", "utf8");
  await writeFile(path.join(root, "ARCHITECTURE.md"), "# Architecture\n", "utf8");
  await writeFile(path.join(root, "docs", "index.md"), "# Docs\n", "utf8");
  await writeFile(path.join(root, "docs", "AGENTS.md"), "# Agent Notes\n\nRead next:\n- docs/index.md\n", "utf8");
  await symlink("AGENTS.md", path.join(root, "docs", "CLAUDE.md"));
}
