import type { TreeEvent } from "@tangent/trees-schema";

export type TreeEventQuery = {
  type?: string | string[];
  entityId?: string;
  workSessionId?: string;
  agentRunId?: string;
  terminalSessionId?: string;
  attentionItemId?: string;
  captureId?: string;
  checkpointId?: string;
  since?: string;
  until?: string;
};

export interface TreeEventStore {
  append(event: TreeEvent): Promise<TreeEvent>;
  query(query?: TreeEventQuery): Promise<TreeEvent[]>;
}

/** Documents the createMemoryTreeEventStore helper. */
export function createMemoryTreeEventStore(seed: TreeEvent[] = []): TreeEventStore {
  const events = [...seed].sort(compareEvents);
  return {
    /** Documents the append helper. */
    async append(event) {
      events.push(event);
      events.sort(compareEvents);
      return event;
    },
    /** Documents the query helper. */
    async query(query = {}) {
      return events.filter((event) => matchesEventQuery(event, query)).sort(compareEvents);
    }
  };
}

/** Documents the matchesEventQuery helper. */
export function matchesEventQuery(event: TreeEvent, query: TreeEventQuery): boolean {
  if (query.type) {
    const types = Array.isArray(query.type) ? query.type : [query.type];
    if (!types.includes(event.type)) return false;
  }
  if (query.entityId && event.entityId !== query.entityId) return false;
  if (query.workSessionId && event.workSessionId !== query.workSessionId) return false;
  if (query.agentRunId && event.agentRunId !== query.agentRunId) return false;
  if (query.terminalSessionId && event.terminalSessionId !== query.terminalSessionId) return false;
  if (query.attentionItemId && event.attentionItemId !== query.attentionItemId) return false;
  if (query.captureId && event.captureId !== query.captureId) return false;
  if (query.checkpointId && event.checkpointId !== query.checkpointId) return false;
  if (query.since && event.at < query.since) return false;
  if (query.until && event.at > query.until) return false;
  return true;
}

/** Documents the compareEvents helper. */
export function compareEvents(a: TreeEvent, b: TreeEvent): number {
  return a.at.localeCompare(b.at);
}
