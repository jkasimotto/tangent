import { readJson, sendJson } from "./http-json.mjs";

/** Creates the HTTP route table for Area-brain operations. */
export function createBrainRoutes(operations) {
  const routes = new Map([
    ["POST /api/brains/start", start],
    ["POST /api/brains/stop", stop],
    ["POST /api/brains/handover", handover],
    ["GET /api/brains/show", show],
    ["POST /api/brains/verdict", verdict],
    ["POST /api/brains/verdict/undo", undoVerdict],
    ["POST /api/brains/reply", reply],
    ["POST /api/brains/requests", createRequest],
    ["POST /api/brains/requests/answer", answerRequest],
    ["POST /api/brains/requests/withdraw", withdrawRequest],
    ["POST /api/brains/requests/dismiss", dismissRequest],
  ]);

  /** Handles one matching request and reports whether this router owned it. */
  async function handle(request, response, url) {
    const route = routes.get(`${request.method} ${url.pathname}`);
    if (!route) return false;
    await route(request, response, url);
    return true;
  }

  /** Starts, resumes, or reattaches an Area brain. */
  async function start(request, response) {
    const body = await readJson(request);
    if (body.choice || String(body.command ?? "").trim()) {
      sendJson(response, 400, { code: "override-retired", error: "Brain launch overrides are retired. Change the Area Brain configuration, then refresh." });
      return;
    }
    const area = String(body.area ?? "");
    const resume = Boolean(body.resume);
    console.info(`[brain start] requested area=${JSON.stringify(area)} mode=${resume ? "resume" : "start"}`);
    const result = await operations.start(String(body.area ?? ""), {
      instruction: String(body.instruction ?? ""),
      expectedLaunch: String(body.expectedLaunch ?? ""),
      resume,
    });
    console.info(`[brain start] result area=${JSON.stringify(area)} status=${result.status} session=${JSON.stringify(result.session ?? "")} error=${JSON.stringify(result.error ?? "")}`);
    sendJson(response, result.status, result.status === 200
      ? { session: result.session, generation: result.generation, reattached: Boolean(result.reattached), brain: result.brain }
      : { error: result.error, ...(result.code ? { code: result.code } : {}), ...(result.launch ? { launch: result.launch } : {}) });
  }

  /** Stops one logical Area brain without trusting a stale session name. */
  async function stop(request, response) {
    const body = await readJson(request);
    const result = await operations.stop(String(body.area ?? ""), {
      expectedAttemptId: String(body.expectedAttemptId ?? ""),
      operationId: String(body.operationId ?? ""),
    });
    sendJson(response, result.status, result.status === 200
      ? { state: result.state, brain: result.brain }
      : { error: result.error, ...(result.code ? { code: result.code } : {}) });
  }

  /** Hands a brain generation's facts to its replacement. */
  async function handover(request, response) {
    const body = await readJson(request);
    let text;
    try { text = operations.normalizeMessage(body.text); }
    catch (error) { sendJson(response, 400, { error: String(error.message ?? error) }); return; }
    const result = await operations.handover(String(body.session ?? ""), text);
    sendJson(response, result.status, result.status === 200
      ? { status: result.state, session: result.session, generation: result.generation, previous: result.previous }
      : { error: result.error });
  }

  /** Returns one brain by Area or session. */
  async function show(_request, response, url) {
    const area = url.searchParams.get("area") ?? "";
    const session = url.searchParams.get("session") ?? "";
    const brain = await operations.show(area, session);
    sendJson(response, brain ? 200 : 404, brain
      ? { brain: { ...brain, forJulianUnparsed: await operations.unparsed(brain) }, prompt: await operations.prompt(brain) }
      : { error: area ? `no brain on ${area}` : "this session is not a brain" });
  }

  /** Records one Accept or Reject verdict. */
  async function verdict(request, response) {
    const body = await readJson(request);
    const result = await operations.verdict(String(body.area ?? ""), String(body.line ?? ""), String(body.verdict ?? ""));
    sendJson(response, result.status, result.status === 200
      ? { ok: true, line: result.line, removedText: result.removedText, index: result.index, target: result.target, verdict: result.verdict }
      : { error: result.error });
  }

  /** Restores the row removed by a verdict. */
  async function undoVerdict(request, response) {
    const body = await readJson(request);
    const result = await operations.undoVerdict(String(body.area ?? ""), String(body.line ?? ""), Number(body.index ?? 0));
    sendJson(response, result.status, result.status === 200 ? { ok: true } : { error: result.error });
  }

  /** Tells a brain which row Julian is replying to. */
  async function reply(request, response) {
    const body = await readJson(request);
    const result = await operations.reply(String(body.area ?? ""), String(body.subject ?? ""));
    sendJson(response, result.status, result.status === 200 ? { ok: true } : { error: result.error });
  }

  /** Creates one durable request. Only the live brain session can call this route. */
  async function createRequest(request, response) {
    const body = await readJson(request);
    const result = await operations.createRequest(String(body.session ?? ""), body);
    sendJson(response, result.status, result.status === 200 ? { request: result.request } : { error: result.error });
  }

  /** Records Julian's answer and notifies the controlling brain. */
  async function answerRequest(request, response) {
    const body = await readJson(request);
    const result = await operations.answerRequest(String(body.area ?? ""), String(body.id ?? ""), String(body.answer ?? ""), String(body.note ?? ""), body.effectRevision ?? null);
    sendJson(response, result.status, result.status === 200 ? { request: result.request } : { error: result.error });
  }

  /** Lets the creating live brain withdraw one obsolete Request. */
  async function withdrawRequest(request, response) {
    const body = await readJson(request);
    const result = await operations.withdrawRequest(String(body.session ?? ""), String(body.id ?? ""), String(body.note ?? ""));
    sendJson(response, result.status, result.status === 200 ? { request: result.request } : { error: result.error });
  }

  /** Records Julian's dismissal as a durable Request transition. */
  async function dismissRequest(request, response) {
    const body = await readJson(request);
    const result = await operations.dismissRequest(String(body.area ?? ""), String(body.id ?? ""));
    sendJson(response, result.status, result.status === 200 ? { request: result.request } : { error: result.error });
  }

  return { handle };
}
