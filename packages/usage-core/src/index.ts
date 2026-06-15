import type { UsageResult, UsageSessionSummary } from "@tangent/usage-schema";

export type UsageCoreClient = {
  listSessions(): Promise<UsageResult<UsageSessionSummary[]>>;
  getSession(id: string): Promise<UsageResult<UsageSessionSummary | undefined>>;
};

/** Creates create memory usage core client. */
export function createMemoryUsageCoreClient(sessions: UsageSessionSummary[]): UsageCoreClient {
  /** Supports the result helper. */
  const result = <T>(data: T): UsageResult<T> => ({ data, meta: { schema: "tangent.usage.core.v1", warnings: [] } });
  return {
    /** Lists sessions. */
    async listSessions() {
      return result(sessions);
    },
    /** Gets session. */
    async getSession(id) {
      return result(sessions.find((session) => session.id === id));
    }
  };
}
