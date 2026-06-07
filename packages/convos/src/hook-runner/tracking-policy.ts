import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { globalConfigPath } from "../core/paths.js";
import { pathExists } from "../core/repo.js";
import type { ConvosProvider, ContentMode, TrackingSource } from "../core/schema/convos-jsonl-v1.js";

export type ConvosGlobalConfig = {
  schema: "convos.config.v1";
  tracking: {
    default: "on" | "off";
    repos: Record<string, { tracked: boolean; providers: Array<ConvosProvider | "all"> }>;
  };
  capture: {
    contentMode: ContentMode;
    redactSecrets: boolean;
    maxToolResponseBytes: number;
  };
};

export type TrackingDecision = {
  enabled: boolean;
  source: TrackingSource;
  configPath?: string;
};

export function defaultGlobalConfig(): ConvosGlobalConfig {
  return {
    schema: "convos.config.v1",
    tracking: { default: "off", repos: {} },
    capture: {
      contentMode: "metadata-with-preview",
      redactSecrets: true,
      maxToolResponseBytes: 20000
    }
  };
}

export async function readGlobalConfig(): Promise<ConvosGlobalConfig> {
  const filePath = globalConfigPath();
  if (!(await pathExists(filePath))) return defaultGlobalConfig();
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as ConvosGlobalConfig;
  return {
    ...defaultGlobalConfig(),
    ...parsed,
    tracking: {
      ...defaultGlobalConfig().tracking,
      ...(parsed.tracking || {}),
      repos: parsed.tracking?.repos || {}
    },
    capture: {
      ...defaultGlobalConfig().capture,
      ...(parsed.capture || {})
    }
  };
}

export async function writeGlobalConfig(config: ConvosGlobalConfig): Promise<void> {
  const filePath = globalConfigPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function setGlobalTrackingDefault(value: "on" | "off"): Promise<void> {
  const config = await readGlobalConfig();
  config.tracking.default = value;
  await writeGlobalConfig(config);
}

export async function setRepoTracked(repoRoot: string, tracked: boolean, providers: Array<ConvosProvider | "all">): Promise<void> {
  const config = await readGlobalConfig();
  const key = path.resolve(repoRoot);
  config.tracking.repos[key] = mergeRepoTracking(config.tracking.repos[key], tracked, providers);
  await writeGlobalConfig(config);
}

export async function trackingDecision(repoRoot: string | undefined, provider: ConvosProvider): Promise<TrackingDecision> {
  if (process.env.CONVOS_TRACKING === "off") return { enabled: false, source: "env" };
  if (process.env.CONVOS_TRACKING === "on") return { enabled: true, source: "env" };

  const config = await readGlobalConfig();
  if (repoRoot) {
    const entry = config.tracking.repos[path.resolve(repoRoot)];
    if (entry && providerMatches(entry.providers, provider)) {
      return {
        enabled: entry.tracked,
        source: entry.tracked ? "global-allowlist" : "global-denylist",
        configPath: globalConfigPath()
      };
    }
  }

  return {
    enabled: config.tracking.default === "on",
    source: "global-default",
    configPath: globalConfigPath()
  };
}

function providerMatches(providers: Array<ConvosProvider | "all">, provider: ConvosProvider): boolean {
  return providers.includes("all") || providers.includes(provider);
}

function mergeRepoTracking(
  existing: { tracked: boolean; providers: Array<ConvosProvider | "all"> } | undefined,
  tracked: boolean,
  providers: Array<ConvosProvider | "all">
): { tracked: boolean; providers: Array<ConvosProvider | "all"> } {
  if (providers.includes("all")) return { tracked, providers: ["all"] };

  const concreteProviders: ConvosProvider[] = ["claude", "codex"];
  const requested = new Set(providers.filter((provider): provider is ConvosProvider => provider !== "all"));

  if (!existing) return { tracked, providers: [...requested] };

  if (tracked) {
    if (existing.tracked && existing.providers.includes("all")) return existing;
    const current = new Set(existing.tracked ? existing.providers.filter((provider): provider is ConvosProvider => provider !== "all") : []);
    for (const provider of requested) current.add(provider);
    return { tracked: true, providers: [...current] };
  }

  if (existing.tracked) {
    const current = new Set(
      existing.providers.includes("all")
        ? concreteProviders
        : existing.providers.filter((provider): provider is ConvosProvider => provider !== "all")
    );
    for (const provider of requested) current.delete(provider);
    if (current.size > 0) return { tracked: true, providers: [...current] };
  }

  return { tracked: false, providers: [...requested] };
}
