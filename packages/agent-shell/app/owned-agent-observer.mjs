import { normalizeOwnedAgents } from "./work-source-adapters.mjs";

/**
 * Runs one complete owned-Agent observation at a time.
 *
 * A failed list keeps prior rows and marks them unknown. Each completed pass
 * has a generation, so an older pane result cannot replace a newer pass.
 */
export function createOwnedAgentObserver({ load, intervalMs = 1_000, now = Date.now, report = console.error }) {
  let generation = 0;
  let acceptedGeneration = 0;
  let current = { rows: [], raw: [], problems: [], complete: false, observedAt: null, generation: 0 };
  let active = null;
  let timer = null;
  let stopped = true;
  const listeners = new Set();

  /** Returns one shared, complete owned-Agent observation. */
  async function observe() {
    if (active) return active;
    const pass = ++generation;
    active = (async () => {
      try {
        const raw = await load();
        const result = normalizeOwnedAgents(raw);
        if (pass < acceptedGeneration) return current;
        acceptedGeneration = pass;
        current = Object.freeze({ ...result, raw: Object.freeze(raw.map(Object.freeze)), rows: Object.freeze(result.rows.map(Object.freeze)), complete: true, observedAt: new Date(now()).toISOString(), generation: pass });
      } catch (error) {
        if (pass < acceptedGeneration) return current;
        acceptedGeneration = pass;
        report("owned Agent observation:", error?.message ?? error);
        current = Object.freeze({
          rows: Object.freeze(current.rows.map((row) => Object.freeze({ ...row, liveness: "unknown", activity: "unknown", activityDetail: "unknown", evidence: "The complete Agent observation failed." }))),
          raw: current.raw,
          problems: Object.freeze([{ code: "agent-observation-failed", ids: [] }]),
          complete: false,
          observedAt: current.observedAt,
          generation: pass,
        });
      } finally {
        active = null;
      }
      for (const listener of listeners) listener(current);
      return current;
    })();
    return active;
  }

  /** Schedules the next passive observation. */
  function schedule() {
    if (stopped) return;
    timer = setTimeout(async () => {
      await observe();
      schedule();
    }, intervalMs);
    timer.unref?.();
  }

  /** Starts passive Agent observation. */
  function start() {
    if (!stopped) return;
    stopped = false;
    void observe().finally(schedule);
  }

  /** Stops passive Agent observation. */
  function stop() {
    stopped = true;
    clearTimeout(timer);
    timer = null;
  }

  /** Subscribes to complete observations. */
  function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  /** Returns the last complete or degraded observation. */
  function snapshot() { return current; }

  return { observe, start, stop, subscribe, snapshot };
}
