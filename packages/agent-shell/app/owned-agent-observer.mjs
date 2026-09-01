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
      let changed = false;
      try {
        const raw = await load();
        const result = normalizeOwnedAgents(raw);
        if (pass < acceptedGeneration) return current;
        acceptedGeneration = pass;
        const priorRows = new Map(current.rows.map((row) => [row.id, row]));
        const rows = result.rows.map((row) => {
          const prior = priorRows.get(row.id);
          return prior && sameAgentFacts(prior, row) ? prior : Object.freeze(row);
        });
        changed = !current.complete || rows.length !== current.rows.length || rows.some((row) => priorRows.get(row.id) !== row) || JSON.stringify(result.problems) !== JSON.stringify(current.problems);
        current = Object.freeze({ ...result, raw: Object.freeze(raw.map(Object.freeze)), rows: Object.freeze(rows), complete: true, observedAt: new Date(now()).toISOString(), generation: pass });
      } catch (error) {
        if (pass < acceptedGeneration) return current;
        acceptedGeneration = pass;
        report("owned Agent observation:", error?.message ?? error);
        const next = Object.freeze({
          rows: Object.freeze(current.rows.map((row) => Object.freeze({ ...row, liveness: "unknown", activity: "unknown", activityDetail: "unknown", evidence: "The complete Agent observation failed." }))),
          raw: current.raw,
          problems: Object.freeze([{ code: "agent-observation-failed", ids: [] }]),
          complete: false,
          observedAt: current.observedAt,
          generation: pass,
        });
        changed = current.complete || JSON.stringify(next.rows) !== JSON.stringify(current.rows) || JSON.stringify(next.problems) !== JSON.stringify(current.problems);
        current = next;
      } finally {
        active = null;
      }
      if (changed) for (const listener of listeners) listener(current);
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

/** Compares one Agent observation without its transport-only observation time. */
function sameAgentFacts(left, right) {
  const { observedAt: _leftObservedAt, ...leftFacts } = left;
  const { observedAt: _rightObservedAt, ...rightFacts } = right;
  return JSON.stringify(leftFacts) === JSON.stringify(rightFacts);
}
