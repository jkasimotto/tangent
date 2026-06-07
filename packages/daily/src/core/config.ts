import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DailyConfig, DailyOutputMode } from "../types/config.js";
import type { SummaryProviderConfig } from "../types/provider.js";
import { ensureOutputDirs, resolveOutputPaths, resolveUserPath, type DailyOutputPaths } from "./paths.js";
import { pathExists, resolveRepo, type DailyRepoInfo } from "./repo.js";

export type LoadedDailyConfig = {
  config: DailyConfig;
  repo: DailyRepoInfo;
  paths: DailyOutputPaths;
  sources: string[];
};

export type InitDailyOptions = {
  repo: string;
  output?: DailyOutputMode;
  summaryProvider?: SummaryProviderConfig["kind"];
  model?: string;
  codexSandbox?: "read-only" | "workspace-write" | "danger-full-access";
  baseDir?: string;
  notesDir?: string;
  artifactsDir?: string;
};

export function defaultConfig(repo?: DailyRepoInfo): DailyConfig {
  return {
    schema: "daily.config.v1",
    repo: {
      root: repo?.root,
      displayName: repo?.displayName
    },
    output: {
      mode: "user-global"
    },
    processing: {
      timezone: localTimezone(),
      dateBucket: "endedAt",
      includeActiveConversations: false,
      activeQuietMinutes: 30,
      workSessionIdleGapMinutes: 45,
      reprocessWhenConversationChanges: true,
      grouping: "branch-and-paths"
    },
    input: {
      providers: ["claude", "codex"],
      includeVisibleMessages: true,
      includeInternalMessages: false,
      includeToolInputs: true,
      includeToolResults: true,
      includeFilePaths: true,
      includeTokenUsage: true,
      maxConversationChars: 120000,
      maxToolResultChars: 4000
    },
    privacy: {
      redactSecrets: true,
      contentMode: "metadata-with-excerpts",
      maxQuoteChars: 240,
      excludePathGlobs: []
    },
    summary: {
      provider: {
        kind: "claude-cli",
        command: "claude",
        model: "sonnet",
        timeoutMs: 120000,
        maxTurns: 1
      },
      sessionDigestSchemaVersion: "session-digest.v1",
      dailyNoteSchemaVersion: "daily-note.v1",
      writeDigestCache: true
    },
    note: {
      titleTemplate: "Daily note - {{repo}} - {{date}}",
      sections: [
        "standup",
        "daySummary",
        "workSessions",
        "decisions",
        "experiments",
        "designSeeds",
        "followUps",
        "risks",
        "metrics",
        "sourceCaveats"
      ],
      includeStandupSnippet: true,
      includeDesignSeeds: true,
      includeFollowUps: true,
      includeMetrics: true
    }
  };
}

export async function loadConfig(options: { repo: string }): Promise<LoadedDailyConfig> {
  const repo = await resolveRepo(options.repo);
  const sources: string[] = [];
  let config: DailyConfig = defaultConfig(repo);

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

export async function initConfig(options: InitDailyOptions): Promise<LoadedDailyConfig> {
  const repo = await resolveRepo(options.repo);
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

  if (config.output.mode === "repo-local-private") await excludeRepoLocalDaily(repo.root);

  return { config, repo, paths, sources: [paths.privateConfigPath] };
}

export async function writeConfigFile(filePath: string, config: DailyConfig): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function setConfigValue(config: DailyConfig, dottedPath: string, rawValue: string): DailyConfig {
  const next = structuredClone(config) as DailyConfig;
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

async function readConfigFile(filePath: string): Promise<Partial<DailyConfig> | undefined> {
  if (!(await pathExists(filePath))) return undefined;
  const text = await readFile(filePath, "utf8");
  return normalizeConfigSchema(JSON.parse(text) as Record<string, unknown>);
}

function mergeConfig(base: DailyConfig, override: Partial<DailyConfig>): DailyConfig {
  const merged = deepMerge(base, override) as DailyConfig;
  const overrideProvider = override.summary?.provider;
  if (overrideProvider?.kind) {
    merged.summary.provider = deepMerge(providerConfig(overrideProvider.kind), overrideProvider) as SummaryProviderConfig;
  }
  return merged;
}

function normalizeConfigSchema(config: Record<string, unknown>): Partial<DailyConfig> {
  const normalized = config.schema === "logs.config.v1" ? { ...config, schema: "daily.config.v1" } : config;
  return normalized as Partial<DailyConfig>;
}

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

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

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

function providerConfig(kind: SummaryProviderConfig["kind"], model = kind === "codex-cli" ? "gpt-5.4" : "sonnet", sandbox: "read-only" | "workspace-write" | "danger-full-access" = "read-only"): SummaryProviderConfig {
  if (kind === "codex-cli") return { kind, command: "codex", model, sandbox, timeoutMs: 120000 };
  if (kind === "claude-sdk") return { kind, model, timeoutMs: 120000 };
  return { kind, command: "claude", model, timeoutMs: 120000, maxTurns: 1 };
}

async function excludeRepoLocalDaily(repoRoot: string): Promise<void> {
  const gitDir = path.join(repoRoot, ".git");
  if (!(await pathExists(gitDir))) return;
  const excludePath = path.join(gitDir, "info", "exclude");
  const existing = (await pathExists(excludePath)) ? await readFile(excludePath, "utf8") : "";
  if (existing.split(/\r?\n/).includes(".tangent/daily/")) return;
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  await writeFile(excludePath, `${existing}${prefix}.tangent/daily/\n`, "utf8");
}

function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
