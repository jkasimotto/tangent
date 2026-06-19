export interface WorklogEntry {
  id: string;
  entityPath?: string;
  cwd?: string;
  name: string;
  description?: string;
  estimateMinutes: number;
  startedAt: string;
  actualMinutes: number | null;
}

/** A completed non-agent work item (e.g. a meeting), logged directly with its actual time. */
export type WorklogManualInput = {
  entityPath?: string;
  name: string;
  description?: string;
  estimateMinutes: number;
  actualMinutes: number;
};

export type WorklogClient = {
  list(): Promise<WorklogEntry[]>;
  setActual(id: string, minutes: number): Promise<void>;
  create(input: WorklogManualInput): Promise<WorklogEntry | null>;
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
    },
    /** Logs a completed non-agent work item; returns the created entry, or null on error. */
    async create(input) {
      const response = await fetch(basePath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input)
      });
      if (!response.ok) return null;
      return await response.json() as WorklogEntry;
    }
  };
}
