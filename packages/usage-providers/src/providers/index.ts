import { repoInfo } from "@tangent/repo";

import { listJsonlFiles, readJsonl } from "@tangent/usage-core/core/append-jsonl";
import { globalEventRoot, repoEventDir } from "@tangent/usage-core/core/paths";
import type { UsageJsonlLineV1, UsageProvider as LegacyUsageProvider } from "@tangent/usage-core/core/schema/usage-jsonl-v1";
import { capabilitiesForProvider } from "@tangent/usage-core/core/schema/capabilities";
import type { OpenUsageOptions } from "@tangent/usage-core/core/index";
import { toUsageEventV3 } from "@tangent/usage-core/core/event-v3";
import {
  UsageError,
  type UsageEventV3,
  type UsageProviderAdapter,
  type UsageProviderCapabilities,
  type UsageSourceFile,
  type UsageSourceRef,
  type UsageWarning
} from "@tangent/usage-core/schema/index";
import { loadNativeSourceFiles } from "./native/load.js";
import { claudeHomes } from "./claude/native/discover.js";
import { codexHome } from "./codex/native/discover.js";
import { geminiHome } from "./gemini/native/discover.js";
import nodePath from "node:path";

export type LoadedProviderEvents = {
  events: UsageEventV3[];
  warnings: UsageWarning[];
  sources: UsageSourceRef[];
  capabilities: UsageProviderCapabilities[];
};

const builtInProviderIds = ["claude", "codex", "gemini"] as const;
type BuiltInProviderId = typeof builtInProviderIds[number];

const providerDisplayNames: Record<BuiltInProviderId, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI"
};

export const builtInProviderAdapters: UsageProviderAdapter[] = builtInProviderIds.map((provider) => ({
  id: provider,
  displayName: providerDisplayNames[provider],
  /** Yields one native source file per transcript discovered for this provider, scoped to the context's repo. */
  async *discover(ctx) {
    const repo = ctx.repo ? await repoInfo(ctx.repo) : undefined;
    const native = await loadNativeSourceFiles({ repoRoot: repo ? repo.root || repo.cwd : undefined, providers: [provider], now: ctx.now });
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
  /** Re-emits a source's pre-parsed events; native sources arrive already normalized, so this is a pass-through. */
  async *normalize(source) {
    for (const event of source.events || []) yield event;
  },
  /** Reports this provider's field support so the UI can show what is and isn't measurable. */
  capabilities: () => providerCapabilities(provider)
}));

/** Loads and merges usage events from the requested providers and sources (native transcripts, usage-jsonl, custom adapters), filtered to the requested time window. The single entry point Usage uses to read a session corpus. */
export async function loadProviderEvents(options: OpenUsageOptions = {}): Promise<LoadedProviderEvents> {
  const repo = options.scope === "all" ? undefined : await repoInfo(options.repo || ".");
  const root = repo ? repo.root || repo.cwd : undefined;
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
      const eventRoot = root ? repoEventDir(root, provider) : globalEventRoot(provider);
      for (const file of await listJsonlFiles(eventRoot)) {
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

/**
 * Returns the base directories that hold native transcripts for the given providers,
 * so a caller can watch them for live updates. These are the provider homes the
 * discovery walkers scan (`~/.claude/projects`, `~/.codex/sessions`, `~/.gemini/tmp`),
 * watched recursively rather than per repo-key so newly created session files and project
 * subdirectories are caught without re-resolving the repo on every filesystem event.
 */
export function nativeWatchRoots(providers?: string[]): string[] {
  const requested = providers?.length ? providers.filter(isBuiltInProvider) : [...builtInProviderIds];
  const roots: string[] = [];
  for (const provider of requested) {
    if (provider === "claude") for (const home of claudeHomes()) roots.push(nodePath.join(home, "projects"));
    if (provider === "codex") roots.push(nodePath.join(codexHome(), "sessions"));
    if (provider === "gemini") roots.push(nodePath.join(geminiHome(), "tmp"));
  }
  return [...new Set(roots)];
}

/** Returns the built-in adapter for a provider id, throwing a typed UsageError when the id is unknown. */
export function getBuiltInProviderAdapter(id: string): UsageProviderAdapter {
  const adapter = builtInProviderAdapters.find((candidate) => candidate.id === id);
  if (!adapter) throw new UsageError("USAGE_UNSUPPORTED_PROVIDER", `Unsupported usage provider: ${id}`, { details: { provider: id }, retryable: false });
  return adapter;
}

/** Maps a built-in provider's legacy field-support table into the public capabilities shape the UI and SDK consume. */
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

/** Builds a capabilities record for a provider with no registered adapter, so the UI can show it as known-but-unsupported. */
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

/** Type guard narrowing an arbitrary provider id to a built-in one. */
function isBuiltInProvider(provider: string): provider is BuiltInProviderId {
  return (builtInProviderIds as readonly string[]).includes(provider);
}

/** Normalizes a Date or string to an ISO string for time-window comparisons. */
function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Collapses source refs to one entry per id, keeping the last seen, so a source discovered twice is reported once. */
function dedupeSources(sources: UsageSourceRef[]): UsageSourceRef[] {
  return [...new Map(sources.map((source) => [source.id, source])).values()];
}

export type { UsageProviderAdapter, UsageProviderCapabilities, UsageSourceFile } from "@tangent/usage-core/schema/index";
