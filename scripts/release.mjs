#!/usr/bin/env node
// Release tooling for the tangent monorepo.
//
// Why this exists: cross-package references use literal `^x.y.z` ranges (not the
// `workspace:` protocol), and `npm version --workspaces` bumps each package's own
// version without rewriting those sibling ranges. Under 0.x semver `^0.1.0` excludes
// 0.2.0, so a naive bump would publish packages that cannot resolve each other. This
// script keeps every workspace version and every internal cross-ref in lockstep, and
// publishes in dependency order so a partial failure leaves a self-consistent registry.
//
// Subcommands:
//   version <newver|major|minor|patch> [--no-git]  bump all packages + rewrite cross-refs
//   publish [--dry-run] [--otp <code>] [--provenance]  publish non-private packages, deps first
//   check                                          assert versions and cross-refs are consistent
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Reads and parses a JSON file. */
function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Writes a JSON object with the repo's 2-space + trailing-newline convention. */
function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

/** Loads every workspace plus the root as release packages with their manifests. */
function loadPackages() {
  const rootManifest = readJson(path.join(root, "package.json"));
  const dirs = [".", ...rootManifest.workspaces];
  const packages = dirs.map((dir) => {
    const file = path.join(root, dir, "package.json");
    const manifest = readJson(file);
    return { dir, file, manifest, name: manifest.name, private: manifest.private === true };
  });
  const internalNames = new Set(packages.map((pkg) => pkg.name));
  return { packages, internalNames };
}

const DEP_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"];

/** Returns the internal package names a manifest depends on, across all dep fields. */
function internalDeps(manifest, internalNames) {
  const deps = new Set();
  for (const field of DEP_FIELDS) {
    for (const name of Object.keys(manifest[field] || {})) {
      if (internalNames.has(name)) deps.add(name);
    }
  }
  return deps;
}

/** Orders publishable packages so that every package follows its internal dependencies. */
function topoOrder(packages, internalNames) {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const ordered = [];
  const visited = new Set();
  const visiting = new Set();
  /** Depth-first visit that appends a package after its internal dependencies. */
  const visit = (pkg) => {
    if (visited.has(pkg.name)) return;
    if (visiting.has(pkg.name)) throw new Error(`Dependency cycle through ${pkg.name}`);
    visiting.add(pkg.name);
    for (const depName of internalDeps(pkg.manifest, internalNames)) {
      const dep = byName.get(depName);
      if (dep) visit(dep);
    }
    visiting.delete(pkg.name);
    visited.add(pkg.name);
    ordered.push(pkg);
  };
  for (const pkg of packages) visit(pkg);
  return ordered;
}

/** Computes the next version from a literal value or a major/minor/patch bump. */
function nextVersion(current, arg) {
  if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(arg)) return arg;
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(current);
  if (!match) throw new Error(`Cannot bump non-semver current version: ${current}`);
  let [major, minor, patch] = match.slice(1).map(Number);
  if (arg === "major") return `${major + 1}.0.0`;
  if (arg === "minor") return `${major}.${minor + 1}.0`;
  if (arg === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown version argument: ${arg} (use major|minor|patch or x.y.z)`);
}

/** Sets every package version and rewrites internal cross-refs to ^newver. */
function runVersion(args) {
  const newver = args[0];
  if (!newver) throw new Error("usage: release.mjs version <newver|major|minor|patch> [--no-git]");
  const noGit = args.includes("--no-git");
  const { packages, internalNames } = loadPackages();
  const rootPkg = packages.find((pkg) => pkg.dir === ".");
  const target = nextVersion(rootPkg.manifest.version, newver);
  for (const pkg of packages) {
    pkg.manifest.version = target;
    for (const field of DEP_FIELDS) {
      const block = pkg.manifest[field];
      if (!block) continue;
      for (const name of Object.keys(block)) {
        if (internalNames.has(name)) block[name] = `^${target}`;
      }
    }
    writeJson(pkg.file, pkg.manifest);
  }
  console.log(`Set ${packages.length} packages to ${target}`);
  execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts"], { cwd: root, stdio: "inherit" });
  if (noGit) return;
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "inherit" });
  execFileSync("git", ["commit", "-m", `release: v${target}`], { cwd: root, stdio: "inherit" });
  execFileSync("git", ["tag", `v${target}`], { cwd: root, stdio: "inherit" });
  console.log(`Committed and tagged v${target}`);
}

/** Returns true when a package version is already on the npm registry. */
function isPublished(name, version) {
  try {
    const out = execFileSync("npm", ["view", `${name}@${version}`, "version"], { encoding: "utf8" }).trim();
    return out === version;
  } catch {
    return false;
  }
}

/** Publishes every non-private package in dependency order, skipping versions already live. */
function runPublish(args) {
  const dryRun = args.includes("--dry-run");
  const provenance = args.includes("--provenance");
  const otpIndex = args.indexOf("--otp");
  const otp = otpIndex >= 0 ? args[otpIndex + 1] : undefined;
  const { packages, internalNames } = loadPackages();
  const publishable = packages.filter((pkg) => !pkg.private);
  for (const pkg of publishable) {
    for (const depName of internalDeps(pkg.manifest, internalNames)) {
      const dep = packages.find((other) => other.name === depName);
      if (dep && dep.private) {
        throw new Error(`${pkg.name} depends on private package ${depName}; it cannot be published.`);
      }
    }
  }
  const ordered = topoOrder(publishable, internalNames);
  for (const pkg of ordered) {
    const version = pkg.manifest.version;
    if (!dryRun && isPublished(pkg.name, version)) {
      console.log(`skip   ${pkg.name}@${version} (already published)`);
      continue;
    }
    const publishArgs = ["publish", "--access", "public"];
    if (dryRun) publishArgs.push("--dry-run");
    if (provenance) publishArgs.push("--provenance");
    if (otp) publishArgs.push("--otp", otp);
    console.log(`publish ${pkg.name}@${version}${dryRun ? " (dry-run)" : ""}`);
    execFileSync("npm", publishArgs, { cwd: path.join(root, pkg.dir), stdio: "inherit" });
  }
  console.log(`${dryRun ? "Dry-run" : "Publish"} complete: ${ordered.length} packages`);
}

/** Asserts all versions match and all internal cross-refs point at the shared version. */
function runCheck() {
  const { packages, internalNames } = loadPackages();
  const versions = new Set(packages.map((pkg) => pkg.manifest.version));
  const errors = [];
  if (versions.size !== 1) errors.push(`Mixed versions across workspaces: ${[...versions].join(", ")}`);
  const target = packages.find((pkg) => pkg.dir === ".").manifest.version;
  for (const pkg of packages) {
    for (const field of DEP_FIELDS) {
      const block = pkg.manifest[field] || {};
      for (const [name, range] of Object.entries(block)) {
        if (internalNames.has(name) && range !== `^${target}`) {
          errors.push(`${pkg.name} ${field}.${name} is ${range}, expected ^${target}`);
        }
      }
    }
  }
  if (errors.length) {
    for (const error of errors) console.error(`✗ ${error}`);
    process.exit(1);
  }
  console.log(`✓ ${packages.length} packages consistent at ${target}`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === "version") runVersion(rest);
else if (command === "publish") runPublish(rest);
else if (command === "check") runCheck();
else {
  console.error("usage: release.mjs <version|publish|check> [options]");
  process.exit(1);
}
