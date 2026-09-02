import { readJson, sendJson } from "./http-json.mjs";

const DEFAULT_ROUTE_DEADLINE_MS = 18_000;

/** Returns a bounded public error response for one thrown resource operation. */
function operationError(error) {
  return {
    status: Number(error?.status ?? 500),
    code: String(error?.code ?? "resource-operation-failed"),
    error: String(error?.publicMessage ?? error?.message ?? "The Map resource operation failed."),
    retryable: error?.retryable === true,
    ...(error?.recovery ? { recovery: error.recovery } : {}),
  };
}

/** Runs one slow resource operation against the route-owned abort deadline. */
async function withDeadline(operation, milliseconds) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error("The Map resource request timed out."), { status: 503, code: "resource-timeout", retryable: true }));
      controller.abort();
    }, milliseconds);
  });
  try { return await Promise.race([operation(controller.signal), timeout]); }
  finally { clearTimeout(timer); }
}

/** Serves the private Area-resource read, observation, discovery, mutation, and representation APIs. */
export function createAreaResourceRoutes({ operations, deadlineMs = DEFAULT_ROUTE_DEADLINE_MS }) {
  /** Sends one operation result while preserving its typed status and recovery payload. */
  function reply(response, result) { sendJson(response, Number(result?.status ?? 200), result); }

  /** Runs one injected operation with consistent typed error handling. */
  async function run(response, name, input, { deadline = false } = {}) {
    try {
      if (typeof operations?.[name] !== "function") throw Object.assign(new Error("Map resources are unavailable."), { status: 503, code: "resource-unavailable", retryable: true });
      const result = deadline
        ? await withDeadline((signal) => operations[name](input, { signal }), deadlineMs)
        : await operations[name](input);
      reply(response, result);
    } catch (error) { reply(response, operationError(error)); }
  }

  /** Handles one matching resource route and reports whether this router owned it. */
  async function handle(request, response, url) {
    if (url.pathname === "/api/areas/map-resources" && request.method === "GET") {
      await run(response, "read", { area: String(url.searchParams.get("area") ?? "") });
      return true;
    }
    const routes = {
      "/api/areas/map-resources/resolve": ["resolve", false],
      "/api/areas/map-resources/refresh": ["refresh", true],
      "/api/areas/map-resources/discover": ["discover", true],
      "/api/areas/map-resources/inspect-target": ["inspectTarget", false],
      "/api/areas/map-resources/apply": ["apply", false],
      "/api/areas/map-resources/representation": ["representation", false],
    };
    const route = routes[url.pathname];
    if (!route || request.method !== "POST") return false;
    let body;
    try { body = await readJson(request, { maxBytes: 4 * 1024 * 1024, rejectMalformed: true, malformedMessage: "Map resource request must be one complete JSON object" }); }
    catch (error) { reply(response, operationError(Object.assign(error, { code: "invalid-resource-request", retryable: false }))); return true; }
    await run(response, route[0], body, { deadline: route[1] });
    return true;
  }

  return { handle };
}

export default { createAreaResourceRoutes };
