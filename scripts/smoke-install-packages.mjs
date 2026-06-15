#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const includeAllPackageManagers = process.argv.includes("--all-package-managers");

const packages = {
  core: "packages/core",
  repo: "packages/repo",
  "agent-runtime": "packages/agent-runtime",
  governance: "packages/governance",
  usage: "packages/usage",
  search: "packages/search",
  rollup: "packages/rollup",
  eval: "packages/eval",
  tangent: "."
};

const packageNames = {
  core: "@tangent/core",
  repo: "@tangent/repo",
  "agent-runtime": "@tangent/agent-runtime",
  governance: "@tangent/governance",
  usage: "@tangent/usage",
  search: "@tangent/search",
  rollup: "@tangent/rollup",
  eval: "@tangent/eval",
  tangent: "tangent"
};

const smokeTargets = [
  {
    name: "@tangent/usage",
    tarballs: ["core", "repo", "usage"],
    importName: "@tangent/usage",
    bin: "tangent-usage",
    absentPackages: ["search", "rollup", "eval"]
  },
  {
    name: "@tangent/search",
    tarballs: ["core", "repo", "search"],
    importName: "@tangent/search",
    bin: "tangent-search",
    absentPackages: ["usage", "rollup", "eval"]
  },
  {
    name: "@tangent/rollup",
    tarballs: ["core", "repo", "agent-runtime", "usage", "rollup"],
    importName: "@tangent/rollup",
    bin: "tangent-rollup",
    absentPackages: ["search", "eval"]
  },
  {
    name: "@tangent/eval",
    tarballs: ["core", "repo", "agent-runtime", "usage", "eval"],
    importName: "@tangent/eval",
    bin: "tangent-eval",
    absentPackages: ["search", "rollup"]
  },
  {
    name: "tangent",
    tarballs: ["core", "repo", "agent-runtime", "governance", "usage", "search", "rollup", "eval", "tangent"],
    bin: "tangent",
    absentPackages: []
  }
];

const tmp = mkdtempSync(path.join(tmpdir(), "tangent-install-smoke-"));
try {
  execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
  const packDir = path.join(tmp, "packs");
  mkdirSync(packDir, { recursive: true });
  const tarballs = packPackages(packDir);

  smokeWithManager("npm", tarballs, smokeTargets);
  if (includeAllPackageManagers) {
    for (const manager of ["pnpm", "yarn", "bun"]) {
      if (!commandAvailable(manager)) {
        console.log(`install smoke: skipping ${manager}; command not found`);
        continue;
      }
      smokeWithManager(manager, tarballs, [smokeTargets[0]]);
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

function packPackages(packDir) {
  const tarballs = {};
  for (const [name, packageDir] of Object.entries(packages)) {
    const output = execFileSync("npm", ["pack", "--pack-destination", packDir, "--silent"], {
      cwd: path.join(root, packageDir),
      encoding: "utf8"
    }).trim();
    const filename = output.split(/\r?\n/).filter(Boolean).at(-1);
    if (!filename) throw new Error(`npm pack did not report a tarball for ${name}`);
    tarballs[name] = path.join(packDir, filename);
  }
  return tarballs;
}

function smokeWithManager(manager, tarballs, targets) {
  for (const target of targets) {
    const projectDir = mkdtempSync(path.join(tmp, `${manager}-${target.name.replace(/[@/]/g, "-")}-`));
    writeSmokeManifest(projectDir, target.tarballs, tarballs);
    installTarballs(manager, projectDir);
    if (target.importName) {
      execFileSync("node", ["--input-type=module", "-e", `await import(${JSON.stringify(target.importName)});`], {
        cwd: projectDir,
        stdio: "inherit"
      });
    }
    execFileSync(path.join(projectDir, "node_modules", ".bin", target.bin), ["--help"], {
      cwd: projectDir,
      stdio: "ignore"
    });
    for (const packageName of target.absentPackages) {
      const installed = path.join(projectDir, "node_modules", "@tangent", packageName);
      if (existsSync(installed)) {
        throw new Error(`${target.name} installed unexpected package @tangent/${packageName}`);
      }
    }
    console.log(`install smoke: ${manager} ${target.name} ok`);
  }
}

function writeSmokeManifest(projectDir, packageKeys, tarballs) {
  const dependencies = Object.fromEntries(packageKeys.map((key) => [packageNames[key], `file:${tarballs[key]}`]));
  writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({
    private: true,
    type: "module",
    dependencies,
    resolutions: dependencies
  }, null, 2), "utf8");
}

function installTarballs(manager, cwd) {
  if (manager === "npm") {
    execFileSync("npm", ["install", "--no-audit", "--no-fund"], { cwd, stdio: "inherit" });
    return;
  }
  if (manager === "pnpm") {
    execFileSync("pnpm", ["install"], { cwd, stdio: "inherit" });
    return;
  }
  if (manager === "yarn") {
    execFileSync("yarn", ["install"], { cwd, stdio: "inherit" });
    return;
  }
  if (manager === "bun") {
    execFileSync("bun", ["install"], { cwd, stdio: "inherit" });
    return;
  }
  throw new Error(`Unsupported package manager: ${manager}`);
}

function commandAvailable(command) {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
