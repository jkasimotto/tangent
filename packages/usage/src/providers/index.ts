import { repoInfo } from "@tangent/repo";

import { listJsonlFiles, readJsonl } from "../core/append-jsonl.js";
import { repoEventDir } from "../core/paths.js";
import type { UsageJsonlLineV1, UsageProvider as LegacyUsageProvider } from "../core/schema/usage-jsonl-v1.js";
import { capabilitiesForProvider } from "../core/schema/capabilities.js";
import type { OpenUsageOptions } from "../core/index.js";
import { toUsageEventV3 } from "../core/event-v3.js";
import {
  UsageError,
  type UsageEventV3,
  type UsageProviderAdapter,
  type UsageProviderCapabilities,
  type UsageSourceFile,
  type UsageSourceRef,
  type UsageWarning
} from "../schema/index.js";
import { loadNativeSourceFiles } from "./native/load.js";

export type LoadedProviderEvents = {
  events: UsageEventV3[];
  warnings: UsageWarning[];
  sources: UsageSourceRef[];
  capabilities: UsageProviderCapabilities[];
};

const builtInProviderIds = ["claude", "codex"] as const;
type BuiltInProviderId = typeof builtInProviderIds[number];

export const builtInProviderAdapters: UsageProviderAdapter[] = builtInProviderIds.map((provider) => ({
  id: provider,
  displayName: provider === "claude" ? "Claude Code" : "Codex",
  async *discover(ctx) {
    if (!ctx.repo) return;
    const repo = await repoInfo(ctx.repo);
    const native = await loadNativeSourceFiles({ repoRoot: repo.root || repo.cwd, providers: [provider], now: ctx.now });
    for (const file of native.files) {
      yield {
        id: file.path,
        provider,
        kind: "native",
        path: file.path,
        mtimeMs: file.mtimeMs,
        size: file.size,
        events: file.events.map((event, index) => toUsageEventV3(event, index))
      };
    }
  },
  async *normalize(source) {
    for (const event of source.events || []) yield event;
  },
  capabilities: () => providerCapabilities(provider)
}));

export async function loadProviderEvents(options: OpenUsageOptions = {}): Promise<LoadedProviderEvents> {
  const repo = await repoInfo(options.repo || ".");
  const root = repo.root || repo.cwd;
  const requestedProviders = options.providers?.length ? options.providers : [...builtInProviderIds];
  const sources = options.sources?.length ? options.sources : ["native"];
  const builtIns = requestedProviders.filter(isBuiltInProvider);
  const unsupported = requestedProviders.filter((provider) => !isBuiltInProvider(provider));
  const events: UsageEventV3[] = [];
  const warnings: UsageWarning[] = unsupported.map((provider) => ({
    code: "unsupported-provider",
    message: `Provider ${provider} is not registered. Pass an adapter to openUsage({ adapters }) to load it.`
  }));
  const sourceRefs: UsageSourceRef[] = [];
  const capabilities = [
    ...builtIns.map(providerCapabilities),
    ...unsupported.map(unsupportedCapabilities),
    ...(options.adapters || []).map((adapter) => adapter.capabilities())
  ];

  if (sources.includes("native") && builtIns.length) {
    const native = await loadNativeSourceFiles({ repoRoot: root, providers: builtIns, now: options.now });
    warnings.push(...native.warnings);
    for (const file of native.files) {
      sourceRefs.push({ id: file.path, provider: file.provider, kind: "native", path: file.path });
      events.push(...file.events.map((event, index) => toUsageEventV3(event, index, options.contentMode || "metadata-with-excerpts")));
    }
  }

  if (sources.includes("usage-jsonl") || sources.includes("hook")) {
    for (const provider of builtIns) {
      for (const file of await listJsonlFiles(repoEventDir(root, provider))) {
        try {
          const rows = await readJsonl<UsageJsonlLineV1>(file);
          sourceRefs.push({ id: file, provider, kind: "usage-jsonl", path: file });
          events.push(...rows.map((event, index) => toUsageEventV3(event, index, options.contentMode || "metadata-with-excerpts")));
        } catch (error) {
          warnings.push({ code: "invalid-jsonl", message: (error as Error).message, path: file });
        }
      }
    }
  }

  for (const adapter of options.adapters || []) {
    if (requestedProviders.length && !requestedProviders.includes(adapter.id)) continue;
    if (!adapter.discover) {
      warnings.push({ code: "adapter-discovery-unavailable", message: `Provider adapter ${adapter.id} does not implement discover().` });
      continue;
    }
    for await (const source of adapter.discover({ repo: root, workspace: options.workspace, from: options.from, to: options.to, now: options.now })) {
      sourceRefs.push({ id: source.id, provider: source.provider, kind: source.kind, path: source.path, rawHash: source.rawHash });
      try {
        for await (const event of adapter.normalize(source, {
          contentMode: options.contentMode || "metadata-with-excerpts",
          includeRaw: options.includeRaw,
          now: options.now
        })) {
          events.push(event);
        }
      } catch (error) {
        warnings.push({ code: "adapter-normalize-failed", message: (error as Error).message, path: source.path });
      }
    }
  }

  const filtered = events.filter((event) => {
    const at = event.observedAt || event.recordedAt;
    if (options.from && at < iso(options.from)) return false;
    if (options.to && at > iso(options.to)) return false;
    return true;
  });

  return {
    events: filtered,
    warnings,
    sources: dedupeSources(sourceRefs),
    capabilities
  };
}

export function getBuiltInProviderAdapter(id: string): UsageProviderAdapter {
  const adapter = builtInProviderAdapters.find((candidate) => candidate.id === id);
  if (!adapter) throw new UsageError("USAGE_UNSUPPORTED_PROVIDER", `Unsupported usage provider: ${id}`, { details: { provider: id }, retryable: false });
  return adapter;
}

export function providerCapabilities(provider: BuiltInProviderId): UsageProviderCapabilities {
  const legacy = capabilitiesForProvider(provider as LegacyUsageProvider);
  return {
    provider,
    sourceKinds: ["native", "usage-jsonl"],
    fields: Object.fromEntries(Object.entries(legacy).map(([field, support]) => [field, {
      status: support.status,
      source: support.source === "best-effort" ? "derived" : support.source,
      confidence: support.status === "supported" ? "provider-reported" : support.status === "partial" ? "partial" : "unsupported",
      notes: support.notes
    }]))
  };
}

function unsupportedCapabilities(provider: string): UsageProviderCapabilities {
  return {
    provider,
    sourceKinds: [],
    fields: {
      provider: {
        status: "unsupported",
        source: "none",
        confidence: "unsupported",
        notes: ["No provider adapter is registered."]
      }
    }
  };
}

function isBuiltInProvider(provider: string): provider is BuiltInProviderId {
  return (builtInProviderIds as readonly string[]).includes(provider);
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function dedupeSources(sources: UsageSourceRef[]): UsageSourceRef[] {
  return [...new Map(sources.map((source) => [source.id, source])).values()];
}

export type { UsageProviderAdapter, UsageProviderCapabilities, UsageSourceFile } from "../schema/index.js";
