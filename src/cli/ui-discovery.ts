import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LocalUiApp, StaticAssetMount, UiRoute, UiModePreference } from "@tangent/ui-server";
import { optionalModule, type ImportModule, type ResolveModule } from "./module-loader.js";

export type UiAppRegistration = {
  app: LocalUiApp;
  routes: UiRoute[];
  assetMounts: StaticAssetMount[];
  close?: () => Promise<void>;
};

export type DiscoverUiAppsOptions = {
  requestedApp?: string;
  repo: string;
  scope: "repo" | "all";
  /** Usage view window in days; forwarded to the usage app factory. Other apps ignore it. */
  windowDays?: number;
  mode: UiModePreference;
  providers: string[];
  sources: string[];
  startDir?: string;
  resolveModule?: ResolveModule;
  importModule?: ImportModule;
  readPackageJson?: (file: string) => Promise<unknown>;
  listNodeModulesPackages?: (dir: string) => Promise<string[]>;
};

type UiAppCandidate = {
  id: string;
  label?: string;
  serverExport: string;
  factory: string;
  order?: number;
};

/** Discovers installed Tangent UI apps and creates their registrations. */
export async function discoverUiApps(options: DiscoverUiAppsOptions): Promise<UiAppRegistration[]> {
  const candidates = await discoverUiAppCandidates(options);
  const selected = options.requestedApp
    ? candidates.filter((candidate) => candidate.id === options.requestedApp)
    : candidates;
  if (options.requestedApp && !selected.length) throw new Error(`Unknown UI app: ${options.requestedApp}`);

  const registrations = await Promise.all(selected.map((candidate) => loadUiApp(candidate, options)));
  return registrations.filter((registration): registration is UiAppRegistration => Boolean(registration));
}

/** Discovers UI app factory descriptors from package manifests plus transitional first-party fallbacks. */
export async function discoverUiAppCandidates(options: Pick<DiscoverUiAppsOptions, "startDir" | "readPackageJson" | "listNodeModulesPackages"> = {}): Promise<UiAppCandidate[]> {
  const byId = new Map<string, UiAppCandidate>();
  for (const candidate of await manifestCandidates(options)) byId.set(candidate.id, candidate);
  return [...byId.values()].sort((left, right) => (left.order ?? 100) - (right.order ?? 100) || left.id.localeCompare(right.id));
}

/** Imports a UI app factory and creates its registration. */
async function loadUiApp(candidate: UiAppCandidate, options: DiscoverUiAppsOptions): Promise<UiAppRegistration | undefined> {
  try {
    const module = await optionalModule<Record<string, unknown>>(candidate.serverExport, options);
    if (!module) return undefined;
    const factory = module[candidate.factory];
    if (typeof factory !== "function") throw new Error(`${candidate.serverExport} does not export ${candidate.factory}.`);
    return await factory({
      repo: options.repo,
      scope: options.scope,
      windowDays: options.windowDays,
      mode: options.mode,
      providers: options.providers,
      sources: options.sources
    }) as UiAppRegistration | undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Installed UI app '${candidate.id}' is broken: ${message}`);
  }
}

/** Reads installed package manifests and extracts UI app candidates. */
async function manifestCandidates(options: Pick<DiscoverUiAppsOptions, "startDir" | "readPackageJson" | "listNodeModulesPackages">): Promise<UiAppCandidate[]> {
  const candidates: UiAppCandidate[] = [];
  const seen = new Set<string>();
  for (const nodeModules of nodeModulesDirs(options.startDir || process.cwd())) {
    for (const packageJson of await listPackageJsonFiles(nodeModules, options.listNodeModulesPackages)) {
      if (seen.has(packageJson)) continue;
      seen.add(packageJson);
      const manifest = await readManifest(packageJson, options.readPackageJson);
      const candidate = parseManifestCandidate(manifest);
      if (candidate) candidates.push(candidate);
    }
  }
  return candidates;
}

/** Returns node_modules directories visible from a starting directory. */
function nodeModulesDirs(startDir: string): string[] {
  const dirs: string[] = [];
  let current = path.resolve(startDir);
  const tangentRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
  for (;;) {
    dirs.push(path.join(current, "node_modules"));
    if (current === tangentRoot) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs;
}

/** Lists package.json files inside one node_modules directory. */
async function listPackageJsonFiles(nodeModules: string, injected?: (dir: string) => Promise<string[]>): Promise<string[]> {
  if (injected) return injected(nodeModules);
  const entries = await readdir(nodeModules, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    if (!isPackageDir(entry) || entry.name.startsWith(".")) continue;
    const full = path.join(nodeModules, entry.name);
    if (entry.name.startsWith("@")) {
      const scoped = await readdir(full, { withFileTypes: true }).catch(() => []);
      files.push(...scoped.filter((pkg) => isPackageDir(pkg) && !pkg.name.startsWith(".")).map((pkg) => path.join(full, pkg.name, "package.json")));
    } else {
      files.push(path.join(full, "package.json"));
    }
  }
  return files;
}

/** Tests whether a node_modules entry can contain a package manifest. */
function isPackageDir(entry: { isDirectory(): boolean; isSymbolicLink(): boolean }): boolean {
  return entry.isDirectory() || entry.isSymbolicLink();
}

/** Reads and parses one package manifest. */
async function readManifest(file: string, injected?: (file: string) => Promise<unknown>): Promise<unknown> {
  if (injected) return injected(file);
  return JSON.parse(await readFile(file, "utf8").catch(() => "{}")) as unknown;
}

/** Converts package metadata into a UI app candidate. */
function parseManifestCandidate(manifest: unknown): UiAppCandidate | undefined {
  if (!manifest || typeof manifest !== "object") return undefined;
  const tangent = (manifest as { tangent?: unknown }).tangent;
  if (!tangent || typeof tangent !== "object") return undefined;
  const uiApp = (tangent as { uiApp?: unknown }).uiApp;
  if (!uiApp || typeof uiApp !== "object") return undefined;
  const raw = uiApp as Partial<UiAppCandidate>;
  if (!raw.id || !raw.label || !raw.serverExport || !raw.factory || typeof raw.order !== "number") return undefined;
  return {
    id: String(raw.id),
    label: String(raw.label),
    serverExport: String(raw.serverExport),
    factory: String(raw.factory),
    order: raw.order
  };
}
