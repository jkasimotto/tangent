/**
 * Coalesces concurrent observations and preserves the last valid value when a
 * later refresh fails. A stale snapshot is safer than reporting that every
 * durable session disappeared because one tmux command timed out.
 */
export function createObservationCache({ load, ttlMs = 500, retryMs = 1_000, now = Date.now, report = console.error }) {
  let value;
  let loadedAt = 0;
  let inFlight = null;
  let inFlightGeneration = -1;
  let lastError = null;
  let retryAt = 0;
  let generation = 0;

  /** Returns a current observation or the last valid value on refresh error. */
  async function get({ fresh = false } = {}) {
    const at = now();
    if (!fresh && value !== undefined && at - loadedAt <= ttlMs) return value;
    if (!fresh && value !== undefined && lastError && at < retryAt) return value;
    if (inFlight) {
      if (inFlightGeneration === generation) return inFlight;
      // A mutation happened after this observation started. Let the bounded
      // load settle, then cross the invalidation boundary with a new load.
      try { await inFlight; } catch {}
      return get({ fresh: true });
    }
    const loadGeneration = generation;
    inFlightGeneration = loadGeneration;
    inFlight = (async () => {
      try {
        const next = await load();
        value = next;
        loadedAt = loadGeneration === generation ? now() : 0;
        lastError = null;
        retryAt = 0;
        return next;
      } catch (error) {
        lastError = error;
        retryAt = now() + retryMs;
        if (value !== undefined) {
          report("observation refresh:", error?.message ?? error);
          return value;
        }
        throw error;
      } finally {
        inFlight = null;
        inFlightGeneration = -1;
      }
    })();
    return inFlight;
  }

  /** Expires the TTL without discarding the last-known-good fallback. */
  function invalidate() {
    generation += 1;
    loadedAt = 0;
    retryAt = 0;
  }

  /** Reports freshness without exposing mutable cache storage. */
  function status() {
    return {
      available: value !== undefined,
      stale: value !== undefined && now() - loadedAt > ttlMs,
      loadedAt: loadedAt || null,
      refreshing: Boolean(inFlight),
      error: lastError ? String(lastError?.message ?? lastError) : null,
      retryAt: retryAt || null,
    };
  }

  return { get, invalidate, status };
}
