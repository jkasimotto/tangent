/** Creates the browser's small JSON client around a fetch implementation. */
export function createApiClient(fetchJson = globalThis.fetch.bind(globalThis)) {
  /** Calls one JSON endpoint and turns non-success replies into errors. */
  async function api(path, options = {}) {
    const response = await fetchJson(path, options);
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
