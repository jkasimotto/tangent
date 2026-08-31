import { readJson, sendJson } from "./http-json.mjs";

/** Creates the HTTP route table for Goal pipeline operations. */
export function createPipelineRoutes(operations) {
  const routes = new Map([
    ["POST /api/goals/handover", handover],
    ["POST /api/pipelines/control", control],
    ["POST /api/pipelines/append", append],
    ["POST /api/goals/attempts/replace", replaceAttempt],
    ["POST /api/goals/attempts/resume", resumeAttempt],
  ]);

  /** Handles one matching request and reports whether this router owned it. */
  async function handle(request, response, url) {
    const route = routes.get(`${request.method} ${url.pathname}`);
    if (!route) return false;
    await operations.alias?.(url.pathname, request.tangentOperationId);
    await route(request, response);
    return true;
  }

  /** Stores one worker report. The queue controller chooses the next attempt. */
  async function handover(request, response) {
    const body = await readJson(request, {
      rejectMalformed: true,
      malformedMessage: "The tangent send brain body is malformed or truncated JSON. Retry the same command unchanged. Nothing was submitted.",
    });
    if (body["continue"] === true) {
      sendJson(response, 400, { error: "Workers cannot replace themselves. Submit a typed context-risk report for the Area brain." });
      return;
    }
    let text;
    try { text = operations.normalizeMessage(body.text); }
    catch (error) { sendJson(response, 400, { error: String(error.message ?? error) }); return; }
    const hasReport = Object.hasOwn(body, "report");
    if (hasReport && (!body.report || typeof body.report !== "object" || Array.isArray(body.report))) {
      sendJson(response, 400, { error: "The report was rejected because it is not one JSON object. Correct --report and run the same tangent send brain command again. Nothing was submitted." });
      return;
    }
    const kind = body.kind == null ? null : String(body.kind);
    if (kind !== null && !operations.isWorkerSendKind(kind)) {
      sendJson(response, 400, { error: `Unknown send kind "${kind}". Use --done, --blocked, or no flag.` });
      return;
    }
    const result = await operations.handoverStep(String(body.session ?? ""), text, hasReport ? body.report : null, String(body.idempotencyKey ?? ""), kind);
    const value = result.status !== 200 ? { error: result.error }
      : { status: result.state, next: result.next, pipeline: result.pipeline, receipt: result.receipt ?? null };
    sendJson(response, result.status, value);
  }

  /** Advances, restarts, skips, sends, or ends a pipeline step. */
  async function control(request, response) {
    const body = await readJson(request);
    const result = await operations.control(String(body.goal ?? ""), String(body.action ?? ""), body.step, {
      caller: String(body.caller ?? ""),
      expectedRevision: body.expectedRevision,
      idempotencyKey: String(body.idempotencyKey ?? ""),
    });
    sendJson(response, result.status, result.status === 200
      ? { status: result.state ?? "started", next: result.next ?? (result.index ? { index: result.index, session: result.session } : null), pipeline: result.pipeline, ...(result.ended ? { ended: result.ended } : {}) }
      : launchError(result));
  }

  /** Appends new pending steps without rewriting pipeline history. */
  async function append(request, response) {
    const body = await readJson(request);
    const result = await operations.append(String(body.goal ?? ""), Array.isArray(body.steps) ? body.steps : [], {
      caller: String(body.caller ?? ""),
      expectedRevision: body.expectedRevision,
      idempotencyKey: String(body.idempotencyKey ?? ""),
    });
    sendJson(response, result.status, result.status === 200
      ? { status: result.state, after: result.after ?? null, next: result.next ?? null, session: result.session ?? null, added: result.added, pipeline: result.pipeline, warnings: result.warnings ?? [], launches: result.launches ?? [] }
      : launchError(result));
  }

  /** Attaches a live attempt or opens a new session with its resume command typed. */
  async function resumeAttempt(request, response) {
    const body = await readJson(request);
    const result = await operations.resumeAttempt(String(body.goal ?? ""), {
      attemptId: String(body.attemptId ?? ""),
      conversationId: String(body.conversationId ?? ""),
    });
    sendJson(response, result.status, result.status === 200
      ? { status: result.state, session: result.session ?? null, command: result.command ?? null }
      : { error: result.error, ...(result.found ? { found: result.found } : {}) });
  }

  /** Replaces one Goal attempt after its successor is ready. */
  async function replaceAttempt(request, response) {
    const body = await readJson(request);
    const result = await operations.replaceAttempt(String(body.goal ?? ""), {
      assignmentId: String(body.assignmentId ?? ""),
      expectedAttemptId: String(body.expectedAttemptId ?? ""),
      expectedRevision: body.expectedRevision,
      launch: body.launch,
      operationId: String(body.operationId ?? body.idempotencyKey ?? request.tangentOperationId ?? ""),
      caller: String(body.caller ?? ""),
      confirmed: body.confirmed === true,
    });
    sendJson(response, result.status, result.status === 200
      ? {
          status: result.state ?? "replaced",
          session: result.session ?? null,
          operation: result.operation ?? null,
          pipeline: result.pipeline,
          repeated: result.repeated === true,
          requiresConfirmation: result.requiresConfirmation === true,
        }
      : {
          error: result.error,
          ...(result.code ? { code: result.code } : {}),
          ...(result.launch ? { launch: result.launch } : {}),
          ...(result.area ? { area: result.area } : {}),
          ...(result.allowed ? { allowed: result.allowed } : {}),
          ...(result.operation ? { operation: result.operation } : {}),
          ...(result.pipeline ? { pipeline: result.pipeline } : {}),
        });
  }

  /** Preserves actionable Area policy fields on a launch refusal. */
  function launchError(result) {
    return { error: result.error, ...(result.code ? { code: result.code } : {}), ...(result.launch ? { launch: result.launch } : {}), ...(result.area ? { area: result.area } : {}), ...(result.allowed ? { allowed: result.allowed } : {}) };
  }

  return { handle };
}
