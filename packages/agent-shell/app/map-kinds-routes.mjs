import { sendJson } from "./http-json.mjs";

/**
 * Serves the Map kinds catalog: one read-only route the Map fetches on mount
 * and on its resource cadence. A problem in the definition or an icon is part
 * of the catalog, not an error, so the Map always loads.
 */
export function createMapKindsRoutes({ catalog, reportError = console.error }) {
  /** Handles the Map kinds read and reports whether this router owned the request. */
  async function handle(request, response, url) {
    if (url.pathname !== "/api/areas/map-kinds" || request.method !== "GET") return false;
    try {
      sendJson(response, 200, await catalog.read());
    } catch (error) {
      reportError(`map kinds read failed: ${String(error?.message ?? error).slice(0, 200)}`);
      sendJson(response, 500, { error: "Map kinds could not be read." });
    }
    return true;
  }

  return { handle };
}

export default { createMapKindsRoutes };
