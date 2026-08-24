/** Creates the browser's small JSON client around a fetch implementation. */
export function createApiClient(fetchJson = globalThis.fetch.bind(globalThis), telemetry = null, deadlineMs = 20_000) {
  /** Calls one JSON endpoint and turns non-success replies into errors. */
  async function api(path, options = {}) {
    const method = String(options.method ?? "GET").toUpperCase();
    const startedAt = telemetry?.start?.() ?? 0;
    let response;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, deadlineMs);
    const callerSignal = options.signal;
    /** Propagates caller cancellation into the request deadline controller. */
    const callerAborted = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) callerAborted();
    else callerSignal?.addEventListener("abort", callerAborted, { once: true });
    try {
      response = await fetchJson(path, { ...options, signal: controller.signal });
    } catch (error) {
      telemetry?.apiFinished?.(method, path, startedAt, 0, false);
      if (timedOut) throw new Error(`Agent Shell ${method} ${path} exceeded its ${deadlineMs}ms response deadline.`);
      throw error;
    } finally {
      globalThis.clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", callerAborted);
    }
    telemetry?.apiFinished?.(method, path, startedAt, response.status, response.ok);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Agent Shell returned ${response.status}.`);
    return data;
  }

  /** Posts one JSON object. */
  function post(path, body) {
    return api(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  return { api, post };
}
