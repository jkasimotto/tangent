import { readJson, sendJson } from "./http-json.mjs";

/** Canonical HTTP ownership for durable Job execution. */
export function createJobRoutes(operations) {
  const routes = new Map([
    ["GET /api/jobs/show", show],
    ["POST /api/jobs/create", create],
    ["POST /api/jobs/start", start],
    ["POST /api/jobs/append", append],
    ["POST /api/jobs/advance", advance],
    ["POST /api/jobs/stop", stop],
    ["POST /api/jobs/replace", replace],
  ]);

  /** Handles one request owned by the Job router. */
  async function handle(request, response, url) {
    const route = routes.get(`${request.method} ${url.pathname}`);
    if (!route) return false;
    await route(request, response, url);
    return true;
  }

  /** Returns one selected Job run and its run history. */
  async function show(_request, response, url) {
    const result = await operations.show(String(url.searchParams.get("goal") ?? ""), url.searchParams.get("run"));
    send(response, result);
  }

  /** Creates a Job run without starting an Assignment. */
  async function create(request, response) {
    const body = await readJson(request);
    if (body.compatAlias) await operations.alias?.(String(body.compatAlias), body.operationId);
    send(response, await operations.create(String(body.goal ?? ""), body));
  }

  /** Starts the next pending Assignment in a Job. */
  async function start(request, response) {
    const body = await readJson(request);
    if (body.compatAlias) await operations.alias?.(String(body.compatAlias), body.operationId);
    send(response, await operations.start(String(body.goal ?? ""), body));
  }

  /** Appends Assignments to the current Job run. */
  async function append(request, response) {
    const body = await readJson(request);
    if (body.compatAlias) await operations.alias?.(String(body.compatAlias), body.operationId);
    send(response, await operations.append(String(body.goal ?? ""), body));
  }

  /** Advances one selected Assignment. */
  async function advance(request, response) {
    const body = await readJson(request);
    send(response, await operations.advance(String(body.goal ?? ""), body));
  }

  /** Stops the current Job run. */
  async function stop(request, response) {
    const body = await readJson(request);
    send(response, await operations.stop(String(body.goal ?? ""), body));
  }

  /** Replaces an Assignment's current Agent Attempt. */
  async function replace(request, response) {
    const body = await readJson(request);
    if (body.compatAlias) await operations.alias?.(String(body.compatAlias), body.operationId);
    send(response, await operations.replace(String(body.goal ?? ""), body));
  }

  /** Sends one canonical Job response without legacy Pipeline fields. */
  function send(response, result) {
    const status = result?.status ?? 500;
    if (status !== 200) {
      sendJson(response, status, { error: result?.error ?? "Job operation failed", ...(result?.code ? { code: result.code } : {}), ...(result?.currentRevision != null ? { currentRevision: result.currentRevision } : {}) });
      return;
    }
    const value = { ...result };
    delete value.status;
    delete value.pipeline;
    if (value.job == null && result.pipeline != null) value.job = result.pipeline;
    sendJson(response, 200, value);
  }

  return { handle };
}
