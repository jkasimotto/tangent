import type { OpenUsageOptions, UsageClient } from "../core/index.js";
import { createUsageClient } from "../core/index.js";
import { eventsToProjections } from "../core/projections.js";
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
import { providerCapabilities } from "../providers/index.js";

export async function openUsageFromSqlite(options: OpenUsageOptions = {}): Promise<UsageClient> {
  const providers = options.providers?.filter((provider) => provider === "claude" || provider === "codex") as Array<"claude" | "codex"> | undefined;
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
    capabilities: (providers || ["claude", "codex"]).map(providerCapabilities),
    contentMode: options.contentMode || "metadata-with-excerpts",
    index: {
      kind: "sqlite",
      version: dataset.provenance.indexVersion
    }
  });
  return createUsageClient(projections);
}

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
  ResolvedConversationRef,
  UsageArchiveOptions,
  UsageArchiveResult,
  UsageDatasetQuery,
  UsageIndexOptions,
  UsageIndexResult,
  UsageIndexSource
};
