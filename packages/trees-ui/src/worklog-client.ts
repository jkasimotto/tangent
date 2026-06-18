export interface WorklogEntry {
  id: string;
  entityPath?: string;
  cwd: string;
  name: string;
  description?: string;
  estimateMinutes: number;
  startedAt: string;
  actualMinutes: number | null;
}

export type WorklogClient = {
  list(): Promise<WorklogEntry[]>;
  setActual(id: string, minutes: number): Promise<void>;
};

/** Creates a browser client backed by the local worklog HTTP API. */
export function createWorklogApiClient(basePath = "/api/worklog"): WorklogClient {
  return {
    /** Returns all worklog entries; returns an empty array on error. */
    async list() {
      const response = await fetch(basePath);
      if (!response.ok) return [];
      const value = await response.json() as unknown;
      return Array.isArray(value) ? (value as WorklogEntry[]) : [];
    },
    /** Records the user-confirmed actual minutes for an entry. */
    async setActual(id, minutes) {
      const response = await fetch(`${basePath}/actual`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, minutes })
      });
      if (!response.ok) throw new Error(`Worklog API error (${response.status}).`);
    }
  };
}
