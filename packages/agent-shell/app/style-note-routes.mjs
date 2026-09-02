import { readJson, sendJson } from "./http-json.mjs";

/**
 * The HTTP surface of the writing-style corpus. Both routes are deliberately
 * thin: the whole point of D1 is that a style note touches nothing else, so
 * this router never saves a Document, never commits, and never notifies a
 * brain. `/api/style-notes` is in WORKER_REFUSED_ROUTES, so the "workers only
 * send" rule stays visible here rather than implied (D5).
 */
export function createStyleNoteRoutes(operations) {
  const routes = new Map([
    ["POST /api/style-notes", add],
    ["GET /api/style-notes", list],
  ]);

  /** Handles one matching request and reports whether this router owned it. */
  async function handle(request, response, url) {
    const route = routes.get(`${request.method} ${url.pathname}`);
    if (!route) return false;
    await route(request, response, url);
    return true;
  }

  /** Records one style note against a vault Document without writing the vault. */
  async function add(request, response) {
    const body = await readJson(request);
    const result = await operations.add({
      file: String(body.file ?? ""),
      note: String(body.note ?? ""),
      quote: body.quote == null ? "" : String(body.quote),
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
    }, String(request.headers["x-tangent-session"] ?? "").trim());
    sendJson(response, result.status, result.status === 200 ? { note: result.entry } : { error: result.error });
  }

  /** Returns the corpus, filtered, newest first, with its counts. */
  async function list(_request, response, url) {
    const result = await operations.list({
      area: url.searchParams.get("area") ?? "",
      file: url.searchParams.get("file") ?? "",
      model: url.searchParams.get("model") ?? "",
      harness: url.searchParams.get("harness") ?? "",
      tag: url.searchParams.get("tag") ?? "",
      since: url.searchParams.get("since") ?? "",
      id: url.searchParams.get("id") ?? "",
    });
    sendJson(response, 200, result);
  }

  return { handle };
}
