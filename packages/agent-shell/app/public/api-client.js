/** One classified browser request error with the local operation evidence. */
export class ApiError extends Error {
  constructor(message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = "ApiError";
    Object.assign(this, details);
  }
}

/** Converts one Retry-After header to a non-negative delay. */
function retryAfterMs(value, now = Date.now()) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : 0;
}

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
      if (timedOut) throw new ApiError(`Agent Shell ${method} ${path} exceeded its ${deadlineMs}ms response deadline.`, { kind: "timeout", status: 0, path, method, operationId: "", retryAfterMs: 0, cause: error });
      const kind = callerSignal?.aborted ? "abort" : "transport";
      throw new ApiError(error?.message ?? `Agent Shell ${method} ${path} could not connect.`, { kind, status: 0, path, method, operationId: "", retryAfterMs: 0, cause: error });
    } finally {
      globalThis.clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", callerAborted);
    }
    telemetry?.apiFinished?.(method, path, startedAt, response.status, response.ok);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ApiError(data.error || `Agent Shell returned ${response.status}.`, {
        kind: "http",
        status: response.status,
        path,
        method,
        operationId: response.headers?.get?.("x-tangent-operation-id") ?? data.operationId ?? "",
        retryAfterMs: retryAfterMs(response.headers?.get?.("retry-after")),
      });
    }
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
