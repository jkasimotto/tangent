import { readFile } from "node:fs/promises";
import path from "node:path";

import { pathExists } from "@tangent/core";

import type { GovernanceFinding } from "./index.js";
import { isTangentPackage, relative, type PackageInfo } from "./walk.js";

type InstallabilityLintContext = {
  root: string;
  packages: PackageInfo[];
};

const standaloneAppBins: Record<string, string> = {
  "@tangent/usage": "tangent-usage",
  "@tangent/search": "tangent-search",
  "@tangent/rollup": "tangent-rollup",
  "@tangent/eval": "tangent-eval"
};

export async function lintPackageInstallability(ctx: InstallabilityLintContext): Promise<GovernanceFinding[]> {
  const findings: GovernanceFinding[] = [];
  for (const pkg of await packageDependencyInfos(ctx)) {
    for (const [section, deps] of dependencySections(pkg.manifest)) {
      for (const [dep, version] of Object.entries(deps)) {
        if (!isTangentPackage(dep)) continue;
        if (/^(file:|link:|workspace:)/.test(version)) {
          findings.push({
            rule: "deps/publishable-tangent-dependencies",
            severity: "error",
            file: relative(ctx.root, pkg.packageJsonPath),
            message: `${pkg.name} declares ${section}.${dep} as ${JSON.stringify(version)}, which is not publishable outside the workspace.`,
            fix: [
              "Use a normal semver range such as ^0.1.0 for Tangent package dependencies.",
              "Keep local development wiring in npm workspaces and package-lock, not package manifests.",
              "Use npm pack smoke tests to verify each standalone package installs without the monorepo."
            ]
          });
        }
      }
    }

    const expectedBin = standaloneAppBins[pkg.name];
    if (!expectedBin) continue;
    const bins = typeof pkg.manifest.bin === "string" ? { [pkg.name]: pkg.manifest.bin } : pkg.manifest.bin || {};
    if (bins[expectedBin] !== "./dist/cli/index.js") {
      findings.push({
        rule: "deps/standalone-app-bin",
        severity: "error",
        file: relative(ctx.root, pkg.packageJsonPath),
        message: `${pkg.name} must expose ${expectedBin} at ./dist/cli/index.js for standalone installs.`,
        fix: [
          `Add "bin": { "${expectedBin}": "./dist/cli/index.js" } to the package manifest.`,
          "Keep the root tangent subcommand as the short human-facing command."
        ]
      });
    }
  }
  return findings;
}

export async function packageDependencyInfos(ctx: InstallabilityLintContext): Promise<PackageInfo[]> {
  const rootPackageJson = path.join(ctx.root, "package.json");
  const rootPackage: PackageInfo[] = await pathExists(rootPackageJson)
    ? [{
      dir: ctx.root,
      name: "tangent",
      packageJsonPath: rootPackageJson,
      manifest: JSON.parse(await readFile(rootPackageJson, "utf8")) as PackageInfo["manifest"]
    }]
    : [];
  return [...rootPackage, ...ctx.packages];
}

function dependencySections(manifest: PackageInfo["manifest"]): Array<[string, Record<string, string>]> {
  return [
    ["dependencies", manifest.dependencies || {}],
    ["devDependencies", manifest.devDependencies || {}],
    ["optionalDependencies", manifest.optionalDependencies || {}],
    ["peerDependencies", manifest.peerDependencies || {}]
  ];
}
