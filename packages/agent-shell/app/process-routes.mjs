import { readJson, sendJson } from "./http-json.mjs";

/** Creates the HTTP route table for the complete process-note lifecycle. */
export function createProcessRoutes(operations) {
  const routes = new Map([
    ["GET /api/processes", list],
    ["POST /api/processes/create", create],
    ["POST /api/processes/remove", remove],
    ["POST /api/processes/control", control],
    ["POST /api/processes/check", check],
    ["POST /api/processes/request-start", requestStart],
    ["POST /api/processes/start", start],
    ["POST /api/processes/defer", defer],
    ["POST /api/processes/skip", skip],
  ]);

  /** Handles one matching request and reports whether this router owned it. */
  async function handle(request, response, url) {
    const route = routes.get(`${request.method} ${url.pathname}`);
    if (!route) return false;
    await route(request, response, url);
    return true;
  }

  /** Returns every process with its schedule, next run, last run, and state. */
  async function list(_request, response, url) {
    sendJson(response, 200, await operations.list(url.searchParams.get("area") ?? "", ["1", "true"].includes(url.searchParams.get("exact") ?? "")));
  }

  /** Creates one loop process note. */
  async function create(request, response) { await mutate(request, response, operations.create); }
  /** Removes one loop process note. */
  async function remove(request, response) { await mutate(request, response, operations.remove); }

  /** Pauses or resumes one process. */
  async function control(request, response) {
    await mutate(request, response, operations.control);
  }

  /** Evaluates one process now and says why. */
  async function check(request, response) {
    await mutate(request, response, operations.check);
  }
  /** Asks the exact Area brain to start one event. */
  async function requestStart(request, response) { await mutate(request, response, operations.requestStart); }
  /** Lets the exact Area brain accept and start one event. */
  async function start(request, response) { await mutate(request, response, operations.start); }
  /** Moves one event to an approved later instant. */
  async function defer(request, response) { await mutate(request, response, operations.defer); }
  /** Finishes one event without starting it. */
  async function skip(request, response) { await mutate(request, response, operations.skip); }

  /** Runs one process operation and reports a refusal as 409. */
  async function mutate(request, response, operation) {
    try {
      const result = await operation(await readJson(request));
      sendJson(response, Number(result?.httpStatus) || 200, result);
    } catch (error) {
      sendJson(response, Number(error.status) || 409, { code: error.code ?? "process-operation-refused", error: String(error.stderr ?? error.message ?? error) });
    }
  }

  return { handle };
}
