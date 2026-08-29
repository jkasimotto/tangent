import { readJson, sendJson } from "./http-json.mjs";

/** Routes brain-owned pictures and proposals, plus Julian-owned decisions and promotions. */
export function createAreaMapRoutes({ pictures, proposals, promotions, authorizeBrain, areaExists }) {
  /** Handles one Area map runtime request. */
  async function handle(request, response, url) {
    const routes = new Set(["/api/areas/picture", "/api/areas/picture/withdraw", "/api/areas/map-proposals", "/api/areas/map-proposals/withdraw", "/api/areas/map-proposals/decide", "/api/areas/map-promotions", "/api/areas/map-promotions/complete"]);
    if (!routes.has(url.pathname)) return false;
    const body = request.method === "POST" ? await readJson(request) : { area: url.searchParams.get("area") };
    const area = String(body.area ?? "");
    if (!await areaExists(area)) { sendJson(response, 404, { error: `no Area ${area || "(none)"}` }); return true; }
    let result;
    if (url.pathname === "/api/areas/picture" || url.pathname === "/api/areas/picture/withdraw") {
      const actor = await authorizeBrain(area, body.session);
      result = actor ? (url.pathname.endsWith("/withdraw") ? await pictures.withdraw(area, body.hash) : await pictures.present(area, body.picture, actor)) : { status: 403, error: `only the exact active brain of ${area} can present its picture` };
    } else if (url.pathname === "/api/areas/map-proposals" || url.pathname === "/api/areas/map-proposals/withdraw") {
      const actor = await authorizeBrain(area, body.session);
      result = actor ? (url.pathname.endsWith("/withdraw") ? await proposals.withdraw(area, String(body.id ?? ""), Number(body.version)) : await proposals.propose(area, body.proposal, actor)) : { status: 403, error: `only the exact active brain of ${area} can propose a map block` };
    } else if (url.pathname === "/api/areas/map-proposals/decide") {
      result = await proposals.decide(area, String(body.id ?? ""), Number(body.version), String(body.decision ?? ""));
    } else if (request.method === "GET") {
      result = { status: 200, promotions: await promotions.incomplete(area) };
    } else if (url.pathname.endsWith("/complete")) {
      const actor = await authorizeBrain(area, body.session);
      result = actor ? await promotions.complete(area, String(body.id ?? ""), body.durableRef, body.brainNoticeId ?? null) : { status: 403, error: `only the exact active brain of ${area} can complete a promotion` };
    } else if (body.advance) {
      const actor = await authorizeBrain(area, body.session);
      result = actor ? await promotions.advance(area, String(body.id), String(body.from), String(body.to), body.patch) : { status: 403, error: `only the exact active brain of ${area} can advance a promotion` };
    } else result = await promotions.start(area, body);
    sendJson(response, result.status ?? 200, result.error ? { error: result.error, ...result } : result);
    return true;
  }
  return { handle };
}
