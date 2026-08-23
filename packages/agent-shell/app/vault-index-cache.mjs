// The vault index cache (goal-opening-and-saving-a-document-takes-under-a-seco).
//
// Every request that touches a Document, a Goal, or the Area map builds the
// vault index, and the shell polls three of those endpoints every 2.5 seconds
// from every open tab. A full build reads every Markdown file in the vault, so
// the builds cost more CPU than the poll interval gives them and requests pile
// up: a Document read took 10 to 30 seconds on the live server.
//
// The cache keeps the last built index under the fingerprint of the vault it
// was built from. A fingerprint pass is a `readdir` and a `stat` per file, some
// 50 times cheaper than a build, so an unchanged vault answers from memory and
// a changed vault still answers with fresh facts on the first request after the
// change. There is no time-based staleness window.

/**
 * Wraps one expensive build in a fingerprint-keyed cache with single-flight.
 *
 * `fingerprint()` must return a string that changes whenever the built value
 * would change. Callers that arrive while a build for the same fingerprint is
 * in flight wait for that build instead of starting their own, so a burst of
 * polls after a vault change costs one build, not one build per request.
 *
 * A failed build is not cached, and it does not poison the callers that come
 * after it.
 */
export function createFingerprintCache({ fingerprint, build }) {
  let cached = null;
  let inFlight = null;
  return async function cachedValue() {
    const key = await fingerprint();
    if (cached && cached.key === key) return cached.value;
    if (inFlight && inFlight.key === key) return inFlight.promise;
    const promise = (async () => build())();
    inFlight = { key, promise };
    try {
      const value = await promise;
      cached = { key, value };
      return value;
    } finally {
      if (inFlight?.promise === promise) inFlight = null;
    }
  };
}
