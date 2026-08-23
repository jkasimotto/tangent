import { readJson, sendJson } from "./http-json.mjs";

/** Creates the HTTP route table for Goal pipeline operations. */
export function createPipelineRoutes(operations) {
  const routes = new Map([
    ["POST /api/goals/handover", handover],
    ["POST /api/pipelines/control", control],
    ["POST /api/pipelines/append", append],
    ["POST /api/pipelines/edit", edit],
  ]);

  /** Handles one matching request and reports whether this router owned it. */
  async function handle(request, response, url) {
    const route = routes.get(`${request.method} ${url.pathname}`);
    if (!route) return false;
    await route(request, response);
    return true;
  }

  /** Advances a step or moves its work into a fresh session. */
  async function handover(request, response) {
    const body = await readJson(request);
    let text;
    try { text = operations.normalizeMessage(body.text); }
    catch (error) { sendJson(response, 400, { error: String(error.message ?? error) }); return; }
    const result = body.continue === true
      ? await operations.continueWorker(String(body.session ?? ""), text)
      : await operations.handoverStep(String(body.session ?? ""), text);
    const value = result.status !== 200 ? { error: result.error }
      : body.continue === true ? { status: "continued", session: result.session }
        : { status: result.state, next: result.next, pipeline: result.pipeline };
    sendJson(response, result.status, value);
  }

  /** Restarts, skips, sends, or ends a pipeline step. */
  async function control(request, response) {
    const body = await readJson(request);
    const result = await operations.control(String(body.goal ?? ""), String(body.action ?? ""), body.step);
    sendJson(response, result.status, result.status === 200
      ? { status: result.state ?? "started", next: result.next ?? (result.index ? { index: result.index, session: result.session } : null), pipeline: result.pipeline, ...(result.ended ? { ended: result.ended } : {}) }
      : { error: result.error });
  }

  /** Appends new pending steps without rewriting pipeline history. */
  async function append(request, response) {
    const body = await readJson(request);
    const result = await operations.append(String(body.goal ?? ""), Array.isArray(body.steps) ? body.steps : []);
    sendJson(response, result.status, result.status === 200
      ? { status: result.state, after: result.after ?? null, next: result.next ?? null, session: result.session ?? null, added: result.added, pipeline: result.pipeline, warnings: result.warnings ?? [] }
      : { error: result.error });
  }

  /** Edits one step that has not started. */
  async function edit(request, response) {
    const body = await readJson(request);
    const result = await operations.edit(String(body.goal ?? ""), body.step, body);
    sendJson(response, result.status, result.status === 200 ? { pipeline: result.pipeline } : { error: result.error });
  }

  return { handle };
}
