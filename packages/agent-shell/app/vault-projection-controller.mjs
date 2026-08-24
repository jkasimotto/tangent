/** Owns a last-known-good projection built outside the caller's event loop. */
export function createVaultProjectionController({ fingerprint, build, timeoutMs = 10_000, now = Date.now }) {
  let current = null;
  let inFlight = null;
  let lastError = null;

  /** Runs one bounded build and publishes it only after complete success. */
  async function refresh(key) {
    if (inFlight) return inFlight;
    const startedAt = now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`Vault projection exceeded ${timeoutMs} ms.`)), timeoutMs);
    inFlight = (async () => {
      try {
        const value = await build({ signal: controller.signal });
        current = { key, value, observedAt: now() };
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
    return inFlight;
  }

  /** Returns current data and refreshes a changed vault without blocking it. */
  async function get() {
    const key = await fingerprint();
    if (!current) return refresh(key);
    if (current.key !== key && !inFlight) void refresh(key).catch(() => {});
    return current.value;
  }

  /** Reports freshness without exposing the projection payload. */
  async function status() {
    const key = await fingerprint().catch(() => null);
    return {
      stale: Boolean(current && key !== null && current.key !== key),
      building: Boolean(inFlight),
      observedAt: current?.observedAt ?? null,
      error: lastError?.message ?? null,
      errorAt: lastError?.at ?? null,
    };
  }

  return { get, status };
}
