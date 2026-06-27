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
  launcher: "packages/launcher",
  "ui-tokens": "packages/ui-tokens",
  "ui-server": "packages/ui-server",
  "tangent-ui": "packages/tangent-ui",
  "usage-schema": "packages/usage-schema",
  "usage-core": "packages/usage-core",
  "usage-providers": "packages/usage-providers",
  "usage-index-sqlite": "packages/usage-index-sqlite",
  "usage-ui-data": "packages/usage-ui-data",
  "usage-ui": "packages/usage-ui",
  "trees-schema": "packages/trees-schema",
  "trees-core": "packages/trees-core",
  "trees-runtime": "packages/trees-runtime",
  "trees-ui": "packages/trees-ui",
  "trees-server": "packages/trees-server",
  "eval-ui": "packages/eval-ui",
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
  launcher: "@tangent/launcher",
  "ui-tokens": "@tangent/ui-tokens",
  "ui-server": "@tangent/ui-server",
  "tangent-ui": "@tangent/tangent-ui",
  "usage-schema": "@tangent/usage-schema",
  "usage-core": "@tangent/usage-core",
  "usage-providers": "@tangent/usage-providers",
  "usage-index-sqlite": "@tangent/usage-index-sqlite",
  "usage-ui-data": "@tangent/usage-ui-data",
  "usage-ui": "@tangent/usage-ui",
  "trees-schema": "@tangent/trees-schema",
  "trees-core": "@tangent/trees-core",
  "trees-runtime": "@tangent/trees-runtime",
  "trees-ui": "@tangent/trees-ui",
  "trees-server": "@tangent/trees-server",
  "eval-ui": "@tangent/eval-ui",
  governance: "@tangent/governance",
  usage: "@tangent/usage",
  search: "@tangent/search",
  rollup: "@tangent/rollup",
  eval: "@tangent/eval",
  tangent: "tangent"
};

// Tarball closure for a default `tangent` install: the shell plus the usage and eval
// apps that the root package now hard-depends on.
const DEFAULT_TANGENT = [
  "core", "repo", "agent-runtime", "launcher", "ui-tokens", "ui-server", "tangent-ui",
  "usage-schema", "usage-core", "usage-providers", "usage-index-sqlite", "usage-ui-data", "usage-ui", "usage",
  "eval-ui", "eval"
];

// Tarball closure for the opt-in trees app.
const TREES = ["trees-schema", "trees-core", "trees-runtime", "trees-ui", "trees-server"];

const smokeTargets = [
  {
    name: "@tangent/usage",
    tarballs: ["core", "repo", "usage-schema", "usage-core", "usage-providers", "usage-index-sqlite", "ui-tokens", "ui-server", "usage-ui-data", "usage-ui", "usage"],
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
    tarballs: ["core", "repo", "agent-runtime", "usage-schema", "usage-core", "usage-providers", "usage-index-sqlite", "rollup"],
    importName: "@tangent/rollup",
    bin: "tangent-rollup",
    absentPackages: ["usage", "usage-ui", "usage-ui-data", "search", "eval"]
  },
  {
    name: "@tangent/eval",
    tarballs: ["core", "repo", "agent-runtime", "usage-schema", "usage-core", "usage-providers", "usage-index-sqlite", "ui-tokens", "ui-server", "eval-ui", "eval"],
    importName: "@tangent/eval",
    bin: "tangent-eval",
    absentPackages: ["usage", "usage-ui", "usage-ui-data", "search", "rollup"]
  },
  {
    // Default `npm install -g tangent`: the root package hard-depends on usage and eval,
    // so a plain install must surface exactly those two apps and nothing else.
    name: "tangent (default: usage + eval)",
    tarballs: [...DEFAULT_TANGENT, "tangent"],
    // usage declares better-sqlite3 as an optional dependency; npm pulls it for a real
    // registry install but not for these file: tarballs, so supply it explicitly.
    registryDeps: { "better-sqlite3": "^11.10.0" },
    bin: "tangent",
    smokeArgs: ["ui", "--list-apps", "--json"],
    expectedStdouts: ["\"id\": \"usage\"", "\"id\": \"eval\""],
    absentPackages: ["search", "rollup", "trees-server", "trees-cli"]
  },
  {
    // Opt-in trees: installing the trees server on top of the default adds the Trees app
    // while usage and eval remain.
    name: "tangent + opt-in trees-server",
    tarballs: [...DEFAULT_TANGENT, ...TREES, "tangent"],
    registryDeps: { "better-sqlite3": "^11.10.0" },
    bin: "tangent",
    smokeArgs: ["ui", "--list-apps", "--json"],
    expectedStdouts: ["\"id\": \"usage\"", "\"id\": \"eval\"", "\"id\": \"trees\""],
    absentPackages: ["search", "rollup", "trees-cli"]
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

/** Packs workspace packages into local tarballs for smoke installs. */
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

/** Installs and verifies each smoke target with one package manager. */
function smokeWithManager(manager, tarballs, targets) {
  for (const target of targets) {
    // Keep the dir name free of spaces and shell-special characters; native prebuild
    // tooling (better-sqlite3) mishandles paths containing them and falls back to source builds.
    const safeName = target.name.replace(/[^a-z0-9]+/gi, "-");
    const projectDir = mkdtempSync(path.join(tmp, `${manager}-${safeName}-`));
    writeSmokeManifest(projectDir, target.tarballs, tarballs, target.registryDeps);
    installTarballs(manager, projectDir);
    if (target.importName) {
      execFileSync("node", ["--input-type=module", "-e", `await import(${JSON.stringify(target.importName)});`], {
        cwd: projectDir,
        stdio: "inherit"
      });
    }
    const smokeArgs = target.smokeArgs || ["--help"];
    const output = execFileSync(path.join(projectDir, "node_modules", ".bin", target.bin), smokeArgs, {
      cwd: projectDir,
      encoding: "utf8"
    });
    for (const expected of [...(target.expectedStdout ? [target.expectedStdout] : []), ...(target.expectedStdouts || [])]) {
      if (!output.includes(expected)) throw new Error(`${target.name} smoke output did not include ${expected}`);
    }
    for (const packageName of target.absentPackages) {
      const installed = path.join(projectDir, "node_modules", "@tangent", packageName);
      if (existsSync(installed)) {
        throw new Error(`${target.name} installed unexpected package @tangent/${packageName}`);
      }
    }
    console.log(`install smoke: ${manager} ${target.name} ok`);
  }
}

/** Writes the temporary package manifest for one smoke target. */
function writeSmokeManifest(projectDir, packageKeys, tarballs, registryDeps = {}) {
  const tarballDeps = Object.fromEntries(packageKeys.map((key) => [packageNames[key], `file:${tarballs[key]}`]));
  const dependencies = { ...tarballDeps, ...registryDeps };
  writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({
    private: true,
    type: "module",
    dependencies,
    resolutions: tarballDeps
  }, null, 2), "utf8");
}

/** Runs the package-manager install command for a smoke project. */
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

/** Tests whether a command is available on PATH. */
function commandAvailable(command) {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
