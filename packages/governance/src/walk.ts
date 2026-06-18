import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "@tangent/core";
import type { GovernanceFinding, GovernanceLintGroup } from "./index.js";

export type PackageInfo = {
  dir: string;
  name: string;
  packageJsonPath: string;
  manifest: {
    bin?: Record<string, string> | string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    tangent?: unknown;
  };
};

/** Supports the package infos helper. */
export async function packageInfos(root: string): Promise<PackageInfo[]> {
  const packagesDir = path.join(root, "packages");
  const entries = await readdir(packagesDir, { withFileTypes: true }).catch(() => []);
  const packages: PackageInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(packagesDir, entry.name);
    const packageJsonPath = path.join(dir, "package.json");
    if (!(await pathExists(packageJsonPath))) continue;
    const manifest = JSON.parse(await readFile(packageJsonPath, "utf8")) as PackageInfo["manifest"] & { name?: string };
    if (!manifest.name) continue;
    packages.push({ dir, name: manifest.name, packageJsonPath, manifest });
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

/** Supports the require file helper. */
export async function requireFile(findings: GovernanceFinding[], root: string, filePath: string, rule: string, fix: string[]): Promise<void> {
  const fullPath = path.join(root, filePath);
  if (await pathExists(fullPath)) return;
  findings.push({
    rule,
    severity: "error",
    file: filePath.startsWith("/") ? filePath : relative(process.cwd(), fullPath),
    message: "required file is missing.",
    fix
  });
}

/** Supports the walk dirs helper. */
export async function walkDirs(root: string): Promise<string[]> {
  const dirs: string[] = [root];
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || ignoredDir(entry.name)) continue;
    dirs.push(...await walkDirs(path.join(root, entry.name)));
  }
  return dirs;
}

/** Supports the source files helper. */
export async function sourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const pkgDir of await walkPackageDirs(root)) {
    const srcDir = path.join(pkgDir, "src");
    if (await pathExists(srcDir)) files.push(...await findTsFiles(srcDir));
  }
  return files;
}

/** Supports the find files helper. */
export async function findFiles(root: string, basename: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (ignoredDir(entry.name)) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await findFiles(fullPath, basename));
    else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name === basename) files.push(fullPath);
  }
  return files;
}

/** Supports the import specifiers helper. */
export function importSpecifiers(text: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) specs.push(match[1]!);
  }
  return specs;
}

/** Supports the owner package helper. */
export function ownerPackage(file: string, packages: PackageInfo[]): PackageInfo | undefined {
  return packages.find((pkg) => file.startsWith(`${pkg.dir}${path.sep}`));
}

/** Supports the tangent package name helper. */
export function tangentPackageName(specifier: string): string | undefined {
  if (specifier === "@tangent/usage" || specifier.startsWith("@tangent/usage/")) return "@tangent/usage";
  if (!specifier.startsWith("@tangent/")) return undefined;
  const [, scope, name] = specifier.match(/^(@tangent)\/([^/]+)/) || [];
  return scope && name ? `${scope}/${name}` : undefined;
}

/** Supports the is tangent package helper. */
export function isTangentPackage(name: string): boolean {
  return name.startsWith("@tangent/") || name === "@tangent/usage";
}

/** Supports the has group helper. */
export function hasGroup(groups: Set<GovernanceLintGroup>, group: GovernanceLintGroup): boolean {
  return groups.has("all") || groups.has(group);
}

/** Supports the relative helper. */
export function relative(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

/** Supports the find ts files helper. */
async function findTsFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (ignoredDir(entry.name)) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await findTsFiles(fullPath));
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

/** Supports the walk package dirs helper. */
async function walkPackageDirs(root: string): Promise<string[]> {
  const packagesDir = path.join(root, "packages");
  const entries = await readdir(packagesDir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(packagesDir, entry.name));
}

/** Supports the ignored dir helper. */
function ignoredDir(name: string): boolean {
  return name === "node_modules" || name === "dist" || name === ".git";
}
