import type { UsageEventV3, UsageSourceRef } from "../schema/index.js";

/** Builds unique source references from projected events. */
export function sourceRefs(events: UsageEventV3[]): UsageSourceRef[] {
  const rows = new Map<string, UsageSourceRef>();
  for (const event of events) {
    rows.set(event.source.id, {
      id: event.source.id,
      provider: event.provider,
      kind: event.source.kind,
      path: event.source.path,
      rawHash: event.source.rawHash
    });
  }
  return [...rows.values()];
}
