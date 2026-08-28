import { readJson, sendJson } from "./http-json.mjs";

/** Creates the HTTP route table for the vault index, map state, and Documents. */
export function createDocumentRoutes(operations) {
  const routes = new Map([
    ["GET /api/vault", vault],
    ["GET /api/map-state", readMap],
    ["POST /api/map-state", writeMap],
    ["GET /api/document", readDocument],
    ["POST /api/document", writeDocument],
    ["POST /api/document/notify-comments", notifyComments],
    ["GET /api/document/comments", comments],
    ["POST /api/document/resolve", resolve],
  ]);

  /** Handles one matching request and reports whether this router owned it. */
  async function handle(request, response, url) {
    const route = routes.get(`${request.method} ${url.pathname}`);
    if (!route) return false;
    await route(request, response, url);
    return true;
  }

  /** Returns the complete indexed vault projection. */
  async function vault(_request, response) {
    sendJson(response, 200, await operations.vault());
  }

  /** Returns persisted map state for one Area. */
  async function readMap(_request, response, url) {
    const area = url.searchParams.get("area") ?? "";
    sendJson(response, 200, { area, state: await operations.readMap(area) });
  }

  /** Validates and persists one Area's map state. */
  async function writeMap(request, response) {
    const body = await readJson(request);
    const area = String(body.area ?? "");
    if (!operations.validArea(area) || typeof body.state !== "object" || body.state === null) {
      sendJson(response, 400, { error: "area and state required" });
      return;
    }
    await operations.writeMap(area, body.state);
    sendJson(response, 200, { ok: true });
  }

  /** Returns one indexed Document. */
  async function readDocument(_request, response, url) {
    const document = await operations.readDocument(url.searchParams.get("file") ?? "", url.searchParams.get("repository") ?? "");
    sendJson(response, document ? 200 : 404, document ?? { error: "document not found" });
  }

  /** Saves one conflict-checked Document revision. */
  async function writeDocument(request, response) {
    const body = await readJson(request);
    if (typeof body.text !== "string") {
      sendJson(response, 400, { error: "text is required" });
      return;
    }
    const result = await operations.writeDocument(String(body.file ?? ""), body.text, String(body.baseHash ?? ""), body.summary);
    sendJson(response, result.status, result.status === 200 ? result.document : { error: result.error, current: result.current });
  }

  /** Explicitly notifies the exact active Area brain about saved comments. */
  async function notifyComments(request, response) {
    const result = await operations.notifyComments(String((await readJson(request)).file ?? ""));
    sendJson(response, result.status, result.status === 200 ? result.value : { error: result.error });
  }

  /** Returns every open comment on one Document. */
  async function comments(_request, response, url) {
    const document = await operations.readDocument(url.searchParams.get("file") ?? "");
    sendJson(response, document ? 200 : 404, document
      ? { file: document.file, title: document.title, comments: document.comments }
      : { error: "document not found" });
  }

  /** Resolves one uniquely matched Document comment. */
  async function resolve(request, response) {
    const body = await readJson(request);
    const result = await operations.resolve(String(body.file ?? ""), String(body.prefix ?? ""), String(body.note ?? ""), String(body.session ?? ""), Number.isInteger(body.index) ? body.index : null);
    sendJson(response, result.status, result.status === 200
      ? { file: result.document.file, comment: result.comment, remaining: result.document.comments.length }
      : { error: result.error, matches: result.matches ?? [] });
  }

  return { handle };
}
