/** Owns a last-known-good projection built outside the caller's event loop. */
export function createVaultProjectionController({ fingerprint, build, timeoutMs = 10_000, now = Date.now }) {
  let current = null;
  let inFlight = null;
  let lastError = null;
  let revision = 0;

  /** Runs one bounded build and publishes it only after complete success. */
  async function refresh(key) {
    if (inFlight) {
      await inFlight.promise.catch(() => {});
      const nextKey = await fingerprint();
      if (current && current.key === nextKey && current.revision === revision) return current.value;
      return refresh(nextKey);
    }
    const startedAt = now();
    const buildRevision = revision;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`Vault projection exceeded ${timeoutMs} ms.`)), timeoutMs);
    const promise = (async () => {
      try {
        const value = await build({ signal: controller.signal });
        current = { key, value, observedAt: now(), revision: buildRevision };
        lastError = null;
        return value;
      } catch (error) {
        lastError = { message: String(error?.message ?? error), at: now(), startedAt };
        throw error;
      } finally {
        clearTimeout(timeout);
        inFlight = null;
      }
    })();
    inFlight = { key, revision: buildRevision, promise };
    return promise;
  }

  /** Returns current data and refreshes a changed vault without blocking it. */
  async function get() {
    const key = await fingerprint();
    if (!current) return refresh(key);
    if (current.revision !== revision) {
      if (!inFlight) void refresh(key).catch(() => {});
      return current.value;
    }
    if (current.key !== key && !inFlight) void refresh(key).catch(() => {});
    return current.value;
  }

  /** Forces the next reader to wait for a post-mutation projection. */
  function invalidate() {
    revision += 1;
  }

  /** Reports freshness without exposing the projection payload. */
  async function status() {
    const key = await fingerprint().catch(() => null);
    return {
      stale: Boolean(current && (current.revision !== revision || (key !== null && current.key !== key))),
      invalidated: Boolean(current && current.revision !== revision),
      building: Boolean(inFlight),
      observedAt: current?.observedAt ?? null,
      revision,
      publishedRevision: current?.revision ?? null,
      error: lastError?.message ?? null,
      errorAt: lastError?.at ?? null,
    };
  }

  return { get, invalidate, status };
}
