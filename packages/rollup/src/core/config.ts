import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathExists, resolveRepo as resolveTangentRepo, type ResolvedRepoInfo as RollupRepoInfo } from "@tangent/repo";

import type { RollupConfig, RollupOutputMode } from "../types/config.js";
import type { SummaryProviderConfig } from "../types/provider.js";
import { ensureOutputDirs, resolveOutputPaths, resolveUserPath, type RollupOutputPaths } from "./paths.js";

export type LoadedRollupConfig = {
  config: RollupConfig;
  repo: RollupRepoInfo;
  paths: RollupOutputPaths;
  sources: string[];
};

export type InitRollupOptions = {
  repo: string;
  output?: RollupOutputMode;
  summaryProvider?: SummaryProviderConfig["kind"];
  model?: string;
  codexSandbox?: "read-only" | "workspace-write" | "danger-full-access";
  baseDir?: string;
  notesDir?: string;
  artifactsDir?: string;
};

/** Creates the default rollup configuration for a repository. */
export function defaultConfig(repo?: RollupRepoInfo): RollupConfig {
  return {
    schema: "rollup.config.v1",
    repo: {
      root: repo?.root,
      displayName: repo?.displayName
    },
    output: {
      mode: "user-global"
    },
    processing: {
      timezone: localTimezone(),
      dateBucket: "turnEndedAt",
      reprocessWhenConversationChanges: true,
      maxTurnDurationMinutesForRollup: 180
    },
    input: {
      providers: ["claude", "codex"],
      includeVisibleMessages: true,
      includeInternalMessages: false,
      includeToolInputs: true,
      includeToolResults: true,
      includeFilePaths: true,
      includeTokenUsage: true,
      maxUserMessageChars: 8000,
      maxTurnInputChars: 48000,
      maxToolResultChars: 4000
    },
    privacy: {
      redactSecrets: true,
      contentMode: "metadata-with-excerpts",
      maxQuoteChars: 240,
      excludePathGlobs: []
    },
    examples: {
      enabled: true,
      maxExamples: 5,
      includePreviousNotes: true
    },
    summary: {
      provider: {
        kind: "claude-cli",
        command: "claude",
        model: "sonnet",
        timeoutMs: 120000,
        maxTurns: 2
      }
    },
    note: {
      titleTemplate: "Rollup note - {{repo}} - {{date}}"
    }
  };
}

/** Loads and merges global, shared, and private rollup config for a repo. */
export async function loadConfig(options: { repo: string }): Promise<LoadedRollupConfig> {
  const repo = await resolveTangentRepo(options.repo, { markers: false });
  const sources: string[] = [];
  let config: RollupConfig = defaultConfig(repo);

  const defaultPaths = resolveOutputPaths(repo, config);
  const globalConfig = await readConfigFile(defaultPaths.globalConfigPath);
  if (globalConfig) {
    config = mergeConfig(config, globalConfig);
    sources.push(defaultPaths.globalConfigPath);
  }

  const repoSharedConfig = await readConfigFile(defaultPaths.repoSharedConfigPath);
  if (repoSharedConfig) {
    config = mergeConfig(config, repoSharedConfig);
    sources.push(defaultPaths.repoSharedConfigPath);
  }

  let paths = resolveOutputPaths(repo, config);
  const privateConfig = await readConfigFile(paths.privateConfigPath);
  if (privateConfig) {
    config = mergeConfig(config, privateConfig);
    sources.push(paths.privateConfigPath);
    paths = resolveOutputPaths(repo, config);
  }

  return { config, repo, paths, sources };
}

/** Initializes a private rollup config and output directory set for a repo. */
export async function initConfig(options: InitRollupOptions): Promise<LoadedRollupConfig> {
  const repo = await resolveTangentRepo(options.repo, { markers: false });
  let config = defaultConfig(repo);
  if (options.output) config.output.mode = options.output;
  if (options.baseDir) config.output.baseDir = resolveUserPath(options.baseDir);
  if (options.notesDir) config.output.notesDir = resolveUserPath(options.notesDir);
  if (options.artifactsDir) config.output.artifactsDir = resolveUserPath(options.artifactsDir);
  if (options.summaryProvider) config.summary.provider = providerConfig(options.summaryProvider, options.model, options.codexSandbox);
  else if (options.model) config.summary.provider = providerConfig(config.summary.provider.kind, options.model, options.codexSandbox);

  const paths = resolveOutputPaths(repo, config);
  await ensureOutputDirs(paths);
  await mkdir(path.dirname(paths.privateConfigPath), { recursive: true });
  await writeFile(paths.privateConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  if (config.output.mode === "repo-local-private") await excludeRepoLocalRollup(repo.root);

  return { config, repo, paths, sources: [paths.privateConfigPath] };
}

/** Writes a rollup config object to disk as formatted JSON. */
export async function writeConfigFile(filePath: string, config: RollupConfig): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/** Applies a dotted-path config assignment parsed from the CLI. */
export function setConfigValue(config: RollupConfig, dottedPath: string, rawValue: string): RollupConfig {
  const next = structuredClone(config) as RollupConfig;
  const segments = dottedPath.split(".").filter(Boolean);
  if (!segments.length) throw new Error("Config path is required.");

  let cursor: Record<string, unknown> = next as unknown as Record<string, unknown>;
  for (const segment of segments.slice(0, -1)) {
    const existing = cursor[segment];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments.at(-1)!] = parseConfigValue(rawValue);
  return next;
}

/** Reads a rollup config file if it exists. */
async function readConfigFile(filePath: string): Promise<Partial<RollupConfig> | undefined> {
  if (!(await pathExists(filePath))) return undefined;
  const text = await readFile(filePath, "utf8");
  return normalizeConfigSchema(JSON.parse(text) as Record<string, unknown>);
}

/** Deep-merges a config override while preserving provider defaults. */
function mergeConfig(base: RollupConfig, override: Partial<RollupConfig>): RollupConfig {
  const merged = deepMerge(base, override) as RollupConfig;
  const overrideProvider = override.summary?.provider;
  if (overrideProvider?.kind) {
    merged.summary.provider = deepMerge(providerConfig(overrideProvider.kind), overrideProvider) as SummaryProviderConfig;
  }
  return merged;
}

/** Normalizes legacy config schema names into the current rollup schema. */
function normalizeConfigSchema(config: Record<string, unknown>): Partial<RollupConfig> {
  const normalized = config.schema === "logs.config.v1" ? { ...config, schema: "rollup.config.v1" } : config;
  return normalized as Partial<RollupConfig>;
}

/** Recursively merges object values without merging arrays. */
function deepMerge(base: unknown, override: unknown): unknown {
  if (override === undefined) return base;
  if (Array.isArray(base) || Array.isArray(override)) return override;
  if (isObject(base) && isObject(override)) {
    const result: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(override)) result[key] = deepMerge(result[key], value);
    return result;
  }
  return override;
}

/** Checks whether a value is a plain object suitable for config merging. */
function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Parses a CLI config value as boolean, null, number, JSON, or string. */
function parseConfigValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/** Builds provider-specific defaults for the requested summary runner kind. */
function providerConfig(kind: SummaryProviderConfig["kind"], model = kind === "codex-cli" ? "gpt-5.4-mini" : "sonnet", sandbox: "read-only" | "workspace-write" | "danger-full-access" = "read-only"): SummaryProviderConfig {
  if (kind === "codex-cli") return { kind, command: "codex", model, sandbox, reasoningEffort: "low", timeoutMs: 300000 };
  if (kind === "claude-sdk") return { kind, model, timeoutMs: 120000 };
  return { kind, command: "claude", model, timeoutMs: 120000, maxTurns: 2 };
}

/** Adds the repo-local rollup directory to git exclude when present. */
async function excludeRepoLocalRollup(repoRoot: string): Promise<void> {
  const gitDir = path.join(repoRoot, ".git");
  if (!(await pathExists(gitDir))) return;
  const excludePath = path.join(gitDir, "info", "exclude");
  const existing = (await pathExists(excludePath)) ? await readFile(excludePath, "utf8") : "";
  if (existing.split(/\r?\n/).includes(".tangent/rollup/")) return;
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  await writeFile(excludePath, `${existing}${prefix}.tangent/rollup/\n`, "utf8");
}

/** Returns the local IANA timezone, falling back to UTC. */
function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
