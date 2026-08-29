import { readJson, sendJson } from "./http-json.mjs";

/** Creates the HTTP route boundary for reading and saving Area-map scenes. */
export function createAreaCanvasRoutes({ repository, proposals = null, view = null, areaExists = async () => true }) {
  /** Handles one request when it targets the Area-map endpoint. */
  async function handle(request, response, url) {
    if (url.pathname !== "/api/areas/canvas") return false;
    if (request.method === "GET") {
      const area = String(url.searchParams.get("area") ?? "");
      if (!await areaExists(area)) { sendJson(response, 404, { error: `no Area ${area || "(none)"}` }); return true; }
      const result = await repository.read(area);
      const etag = result.hash ? `"${result.hash}"` : null;
      if (etag && request.headers["if-none-match"] === etag) { response.writeHead(304, { ETag: etag, "Cache-Control": "no-cache" }); response.end(); return true; }
      if (!result.ok) { sendJson(response, 422, { area, file: result.file, hash: result.hash, errors: result.errors, fallback: "list" }); return true; }
      const value = { area, file: result.file, exists: result.exists, hash: result.hash, canvas: result.canvas, scene: result.canvas, migrated: result.migrated === true, warnings: result.warnings, proposals: proposals ? await proposals.list(area, { openOnly: true }) : [], view: view ? await view(area) : null };
      const headers = { "Cache-Control": "no-cache", ...(etag ? { ETag: etag } : {}) };
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", ...headers }); response.end(JSON.stringify(value)); return true;
    }
    if (request.method === "POST") {
      const body = await readJson(request); const area = String(body.area ?? "");
      if (!await areaExists(area)) { sendJson(response, 404, { error: `no Area ${area || "(none)"}` }); return true; }
      const reason = body.reason ?? null;
      if (reason !== null && !["blank slate", "undo blank slate"].includes(reason)) { sendJson(response, 422, { error: "unknown canvas save reason" }); return true; }
      const result = await repository.save(area, body.canvas, { baseHash: body.baseHash ?? null, operationId: body.operationId ?? null, session: body.session ?? null, reason });
      const status = result.status ?? 200;
      sendJson(response, status, status < 400 ? result : { error: result.error ?? (status === 409 ? "canvas changed" : "canvas commit failed"), ...result }); return true;
    }
    return false;
  }
  return { handle };
}
