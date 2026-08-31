import { readJson, sendJson } from "./http-json.mjs";

/** Serves the complete Area hierarchy and revision-checked deferred shards. */
export function createAreaMapWorldRoutes({ index, saveGesture = null, viewStore = null }) {
  /** Handles a complete-world read, deferred shard read, or source gesture. */
  async function handle(request, response, url) {
    if (url.pathname === "/api/areas/map-world" && request.method === "GET") {
      const located = String(url.searchParams.get("located") ?? "");
      const world = await index.snapshot(located);
      if (world && viewStore) world.view = await viewStore.read(world.worldId);
      sendJson(response, world ? 200 : 404, world ?? { error: `no Area ${located || "(none)"}` }); return true;
    }
    if (url.pathname === "/api/areas/map-shard" && request.method === "GET") {
      const result = await index.shard(String(url.searchParams.get("area") ?? ""), String(url.searchParams.get("worldRevision") ?? ""), String(url.searchParams.get("located") ?? ""));
      sendJson(response, result.status, result); return true;
    }
    if (url.pathname === "/api/areas/map-gestures" && request.method === "POST") {
      const body = await readJson(request, { maxBytes: 16 * 1024 * 1024, rejectMalformed: true, malformedMessage: "map gesture must be one complete JSON object" });
      const result = await index.applyGesture(body, saveGesture);
      sendJson(response, result.status ?? 200, result); return true;
    }
    if (url.pathname === "/api/areas/map-view" && request.method === "GET") {
      const worldId = String(url.searchParams.get("worldId") ?? "");
      try { sendJson(response, 200, { worldId, view: await viewStore?.read(worldId) ?? null }); }
      catch (error) { sendJson(response, Number(error?.status ?? 500), { error: String(error?.message ?? error) }); }
      return true;
    }
    if (url.pathname === "/api/areas/map-view" && ["POST", "PUT"].includes(request.method)) {
      const body = await readJson(request);
      try {
        if (!viewStore) throw Object.assign(new Error("Area-map view storage is unavailable"), { status: 503 });
        await viewStore.write(String(body.worldId ?? ""), body.view);
        sendJson(response, 200, { ok: true });
      } catch (error) { sendJson(response, Number(error?.status ?? 500), { error: String(error?.message ?? error) }); }
      return true;
    }
    return false;
  }
  return { handle };
}
