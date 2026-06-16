import { readdir, readFile } from "node:fs/promises";
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

const rootProductPackages = new Set([
  "@tangent/usage",
  "@tangent/trees-cli",
  "@tangent/trees-server",
  "@tangent/governance",
  "@tangent/rollup",
  "@tangent/eval",
  "@tangent/search"
]);

const uiAppPackages = new Map([
  ["@tangent/usage", "usage"],
  ["@tangent/trees-server", "trees"],
  ["@tangent/eval", "eval"]
]);

/** Lints publishable package installability and optional root product composition. */
export async function lintPackageInstallability(ctx: InstallabilityLintContext): Promise<GovernanceFinding[]> {
  const findings: GovernanceFinding[] = [];
  for (const pkg of await packageDependencyInfos(ctx)) {
    if (pkg.name === "tangent") {
      findings.push(...lintRootOptionalProducts(ctx.root, pkg));
      findings.push(...await lintRootStaticProductImports(ctx.root));
    }
    const expectedUiApp = uiAppPackages.get(pkg.name);
    if (expectedUiApp && uiAppId(pkg.manifest) !== expectedUiApp) {
      findings.push({
        rule: "deps/ui-apps-declare-manifest",
        severity: "error",
        file: relative(ctx.root, pkg.packageJsonPath),
        message: `${pkg.name} must declare tangent.uiApp metadata for root UI discovery.`,
        fix: [
          "Add tangent.uiApp with id, label, serverExport, factory, and order.",
          "Keep root UI discovery driven by package metadata instead of hard-coded imports."
        ]
      });
    }

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

/** Flags product packages that root installs as hard dependencies. */
function lintRootOptionalProducts(root: string, pkg: PackageInfo): GovernanceFinding[] {
  const findings: GovernanceFinding[] = [];
  const dependencies = pkg.manifest.dependencies || {};
  for (const dep of Object.keys(dependencies)) {
    if (!rootProductPackages.has(dep)) continue;
    findings.push({
      rule: "deps/root-products-optional",
      severity: "error",
      file: relative(root, pkg.packageJsonPath),
      message: `root tangent depends on product package ${dep}.`,
      fix: [
        "Keep root dependencies to platform packages only.",
        "Represent known first-party products as optional peers or discover them from installed package manifests."
      ]
    });
  }
  return findings;
}

/** Flags static product imports in root source files. */
async function lintRootStaticProductImports(root: string): Promise<GovernanceFinding[]> {
  const findings: GovernanceFinding[] = [];
  for (const file of await rootSourceFiles(path.join(root, "src"))) {
    const text = await readFile(file, "utf8");
    for (const dep of rootProductPackages) {
      const escaped = dep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`\\bfrom\\s+["']${escaped}(?:/[^"']*)?["']`);
      if (!pattern.test(text)) continue;
      findings.push({
        rule: "deps/root-no-static-product-imports",
        severity: "error",
        file: relative(root, file),
        message: `root source statically imports product package ${dep}.`,
        fix: [
          "Use lazy dynamic imports inside the selected command branch.",
          "Keep help/completion as root-owned stubs or descriptor discovery."
        ]
      });
    }
  }
  return findings;
}

/** Lists TypeScript source files under the root package source tree. */
async function rootSourceFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await rootSourceFiles(full));
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) files.push(full);
  }
  return files;
}

/** Reads the Tangent UI app id from a package manifest. */
function uiAppId(manifest: PackageInfo["manifest"]): string | undefined {
  const tangent = manifest.tangent;
  if (!tangent || typeof tangent !== "object") return undefined;
  const uiApp = (tangent as { uiApp?: unknown }).uiApp;
  if (!uiApp || typeof uiApp !== "object") return undefined;
  const id = (uiApp as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

/** Returns root and workspace package manifests for dependency linting. */
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

/** Returns all dependency sections that may contain Tangent package specs. */
function dependencySections(manifest: PackageInfo["manifest"]): Array<[string, Record<string, string>]> {
  return [
    ["dependencies", manifest.dependencies || {}],
    ["devDependencies", manifest.devDependencies || {}],
    ["optionalDependencies", manifest.optionalDependencies || {}],
    ["peerDependencies", manifest.peerDependencies || {}]
  ];
}
