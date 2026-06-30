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
  "@tangent/rollup": "tangent-rollup",
  "@tangent/eval": "tangent-eval"
};

const rootProductPackages = new Set([
  "@tangent/usage",
  "@tangent/governance",
  "@tangent/rollup",
  "@tangent/eval"
]);

const uiAppPackages = new Map([
  ["@tangent/usage", "usage"],
  ["@tangent/eval", "eval"]
]);

/** Lints publishable package installability and optional root product composition. */
export async function lintPackageInstallability(ctx: InstallabilityLintContext): Promise<GovernanceFinding[]> {
  const findings: GovernanceFinding[] = [];
  const packages = await packageDependencyInfos(ctx);
  findings.push(...lintNoUiTransitiveForDataConsumers(ctx.root, packages));
  for (const pkg of packages) {
    if (pkg.name === "tangent") {
      findings.push(...lintRootPackageMode(ctx.root, pkg));
      findings.push(...lintRootOptionalProducts(ctx.root, pkg));
      findings.push(...await lintRootStaticProductImports(ctx.root));
    }
    const expectedUiApp = uiAppPackages.get(pkg.name);
    if (expectedUiApp && uiAppMetadataError(pkg.manifest, expectedUiApp)) {
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

/** Prevents data consumers from pulling the full Usage app or Usage UI packages. */
function lintNoUiTransitiveForDataConsumers(root: string, packages: PackageInfo[]): GovernanceFinding[] {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const consumers = new Set(["@tangent/rollup", "@tangent/eval"]);
  const forbidden = new Set(["@tangent/usage", "@tangent/usage-ui", "@tangent/usage-ui-data"]);
  const findings: GovernanceFinding[] = [];
  for (const consumer of consumers) {
    const pkg = byName.get(consumer);
    if (!pkg) continue;
    const path = dependencyPath(pkg.name, forbidden, byName);
    if (!path) continue;
    findings.push({
      rule: "deps/no-ui-transitive-for-data-consumers",
      severity: "error",
      file: relative(root, pkg.packageJsonPath),
      message: `${consumer} pulls Usage UI/full app dependency path: ${path.join(" -> ")}.`,
      fix: [
        "Depend on @tangent/usage-index-sqlite and @tangent/usage-core for telemetry data.",
        "Do not depend on @tangent/usage unless serving the Usage app UI."
      ]
    });
  }
  return findings;
}

/** Finds the first Tangent dependency path from a package to a forbidden target. */
function dependencyPath(start: string, forbidden: Set<string>, packages: Map<string, PackageInfo>): string[] | undefined {
  const queue: string[][] = [[start]];
  const seen = new Set([start]);
  while (queue.length) {
    const path = queue.shift()!;
    const current = packages.get(path.at(-1)!);
    if (!current) continue;
    for (const dep of Object.keys(current.manifest.dependencies || {})) {
      if (!isTangentPackage(dep) || seen.has(dep)) continue;
      const next = [...path, dep];
      if (forbidden.has(dep)) return next;
      seen.add(dep);
      queue.push(next);
    }
  }
  return undefined;
}

/** Requires the root package to declare its install/composition contract. */
function lintRootPackageMode(root: string, pkg: PackageInfo): GovernanceFinding[] {
  const tangent = pkg.manifest.tangent;
  const mode = tangent && typeof tangent === "object" ? (tangent as { packageMode?: unknown }).packageMode : undefined;
  if (mode === "thin-shell") return [];
  return [{
    rule: "deps/root-package-mode",
    severity: "error",
    file: relative(root, pkg.packageJsonPath),
    message: "root tangent must declare tangent.packageMode as thin-shell.",
    fix: [
      "Add tangent.packageMode = \"thin-shell\" to the root package manifest.",
      "Keep product packages as optional peers or separate installs."
    ]
  }];
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

/** Validates Tangent UI app metadata in a package manifest. */
function uiAppMetadataError(manifest: PackageInfo["manifest"], expectedId: string): boolean {
  const tangent = manifest.tangent;
  if (!tangent || typeof tangent !== "object") return true;
  const uiApp = (tangent as { uiApp?: unknown }).uiApp;
  if (!uiApp || typeof uiApp !== "object") return true;
  const raw = uiApp as { id?: unknown; label?: unknown; serverExport?: unknown; factory?: unknown; order?: unknown };
  return raw.id !== expectedId ||
    typeof raw.label !== "string" ||
    typeof raw.serverExport !== "string" ||
    typeof raw.factory !== "string" ||
    typeof raw.order !== "number";
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
