import { publicAreaResourceFailure } from "./area-resource-recovery.mjs";
import { readJson, sendJson } from "./http-json.mjs";

const DEFAULT_ROUTE_DEADLINE_MS = 18_000;
const DEFAULT_CLEANUP_GRACE_MS = 250;

/** Returns a bounded public error response for one thrown resource operation. */
function operationError(error) {
  return publicAreaResourceFailure(error);
}

/** Runs one slow resource operation against the route-owned abort deadline. */
async function withDeadline(operation, milliseconds, cleanupGraceMs) {
  const controller = new AbortController();
  let timer;
  let timedOut = false;
  let pending;
  try { pending = Promise.resolve(operation(controller.signal)); }
  catch (error) { pending = Promise.reject(error); }
  const settled = pending.then(
    (value) => ({ state: "fulfilled", value }),
    (error) => ({ state: "rejected", error }),
  );
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      resolve({ state: "timed-out" });
    }, milliseconds);
  });
  try {
    const result = await Promise.race([settled, timeout]);
    if (timedOut || result.state === "timed-out") {
      let cleanupTimer;
      await Promise.race([
        settled,
        new Promise((resolve) => { cleanupTimer = setTimeout(resolve, cleanupGraceMs); }),
      ]);
      clearTimeout(cleanupTimer);
      throw Object.assign(new Error("The Map resource request timed out."), { status: 503, code: "resource-timeout", retryable: true });
    }
    if (result.state === "rejected") throw result.error;
    return result.value;
  }
  finally { clearTimeout(timer); }
}

/** Serves the private Area-resource read, observation, discovery, mutation, and representation APIs. */
export function createAreaResourceRoutes({ operations, writesEnabled = true, deadlineMs = DEFAULT_ROUTE_DEADLINE_MS, cleanupGraceMs = DEFAULT_CLEANUP_GRACE_MS }) {
  /** Sends one operation result while preserving its typed status and recovery payload. */
  function reply(response, result) {
    const status = Number(result?.status ?? 200);
    sendJson(response, status, status >= 400 ? publicAreaResourceFailure(result) : result);
  }

  /** Runs one injected operation with consistent typed error handling. */
  async function run(response, name, input, { deadline = false } = {}) {
    try {
      if (typeof operations?.[name] !== "function") throw Object.assign(new Error("Map resources are unavailable."), { status: 503, code: "resource-unavailable", retryable: true });
      const result = deadline
        ? await withDeadline((signal) => operations[name](input, { signal }), deadlineMs, cleanupGraceMs)
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
      "/api/areas/map-resources/resolve": ["resolve", false, false],
      "/api/areas/map-resources/refresh": ["refresh", true, true],
      "/api/areas/map-resources/discover": ["discover", true, true],
      "/api/areas/map-resources/inspect-target": ["inspectTarget", false, false],
      "/api/areas/map-resources/apply": ["apply", false, true],
      "/api/areas/map-resources/representation": ["representation", false, true],
    };
    const route = routes[url.pathname];
    if (!route || request.method !== "POST") return false;
    if (route[2] && !writesEnabled) {
      reply(response, { status: 503, code: "resource-unavailable", error: "Map resource writes are disabled by the current rollout.", retryable: false });
      return true;
    }
    let body;
    try { body = await readJson(request, { maxBytes: 4 * 1024 * 1024, rejectMalformed: true, malformedMessage: "Map resource request must be one complete JSON object" }); }
    catch (error) { reply(response, operationError(Object.assign(error, { code: "invalid-resource-request", retryable: false }))); return true; }
    await run(response, route[0], body, { deadline: route[1] });
    return true;
  }

  return { handle };
}

export default { createAreaResourceRoutes };
