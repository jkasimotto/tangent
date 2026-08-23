/** Creates the browser's small JSON client around a fetch implementation. */
export function createApiClient(fetchJson = globalThis.fetch.bind(globalThis), telemetry = null) {
  /** Calls one JSON endpoint and turns non-success replies into errors. */
  async function api(path, options = {}) {
    const method = String(options.method ?? "GET").toUpperCase();
    const startedAt = telemetry?.start?.() ?? 0;
    let response;
    try {
      response = await fetchJson(path, options);
    } catch (error) {
      telemetry?.apiFinished?.(method, path, startedAt, 0, false);
      throw error;
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
