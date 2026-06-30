import type { OpenUsageOptions, UsageClient } from "@tangent/usage-core/core/index";
import { createUsageClient } from "@tangent/usage-core/core/index";
import { eventsToProjections } from "@tangent/usage-core/core/projections";
import { loadUsageDatasetFromIndex, ensureUsageIndex, resolveConversationRef, archiveUsageTelemetry } from "../sdk/indexStore.js";
import type {
  ResolvedConversationRef,
  UsageArchiveOptions,
  UsageArchiveResult,
  UsageDatasetQuery,
  UsageIndexOptions,
  UsageIndexResult,
  UsageIndexSource
} from "../sdk/indexStore.js";
import { providerCapabilities } from "@tangent/usage-providers/providers/index";
import { isUsageProvider, usageProviders } from "@tangent/usage-core/core/schema/usage-jsonl-v1";
export { openUsageUiFromSqlite, type UsageSessionWithSparkline } from "./uiClient.js";

/** Opens a Usage client backed by the SQLite index, ensuring it is current and loading the windowed dataset into a projection. */
export async function openUsageFromSqlite(options: OpenUsageOptions = {}): Promise<UsageClient> {
  const providers = options.providers?.filter(isUsageProvider);
  const dataset = await loadUsageDatasetFromIndex({
    repo: options.repo || ".",
    scope: options.scope,
    providers,
    sources: sqliteSources(options.sources),
    since: options.from ? new Date(options.from) : undefined,
    until: options.to ? new Date(options.to) : undefined,
    now: options.now
  });
  const projections = eventsToProjections({
    events: dataset.events,
    warnings: dataset.warnings,
    sources: dataset.provenance.sourceFiles.map((file) => ({ id: file, kind: "native", path: file })),
    capabilities: (providers || usageProviders).map(providerCapabilities),
    contentMode: options.contentMode || "metadata-with-excerpts",
    index: {
      kind: "sqlite",
      version: dataset.provenance.indexVersion
    }
  });
  return createUsageClient(projections);
}

/**
 * Builds an empty Usage client without touching the index, for instant non-blocking startup.
 * The server serves this while the real snapshot loads in the background, then swaps it in.
 */
export function emptyUsageFromSqlite(options: OpenUsageOptions = {}): UsageClient {
  const providers = options.providers?.filter(isUsageProvider);
  const projections = eventsToProjections({
    events: [],
    warnings: [],
    sources: [],
    capabilities: (providers || usageProviders).map(providerCapabilities),
    contentMode: options.contentMode || "metadata-with-excerpts",
    index: { kind: "sqlite", version: "usage.index.v2" }
  });
  return createUsageClient(projections);
}

/** Maps requested source names to the SQLite index source kinds. */
function sqliteSources(sources: Array<string> | undefined): UsageIndexSource[] | undefined {
  if (!sources?.length) return undefined;
  const mapped = sources.flatMap((source) => {
    if (source === "native") return ["native" as const];
    if (source === "usage-jsonl" || source === "hook") return ["usage-jsonl" as const];
    return [];
  });
  return mapped.length ? mapped : undefined;
}

export {
  archiveUsageTelemetry,
  ensureUsageIndex,
  loadUsageDatasetFromIndex,
  resolveConversationRef
};

export type {
  OpenUsageOptions,
  ResolvedConversationRef,
  UsageClient,
  UsageArchiveOptions,
  UsageArchiveResult,
  UsageDatasetQuery,
  UsageIndexOptions,
  UsageIndexResult,
  UsageIndexSource
};
