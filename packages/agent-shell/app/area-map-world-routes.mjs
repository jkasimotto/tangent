import { sendJson } from "./http-json.mjs";

/** Serves the complete Area hierarchy and revision-checked deferred shards. */
export function createAreaMapWorldRoutes({ index }) {
  /** Handles a complete-world or deferred-shard read. */
  async function handle(request, response, url) {
    if (url.pathname === "/api/areas/map-world" && request.method === "GET") {
      const located = String(url.searchParams.get("located") ?? "");
      const world = await index.snapshot(located);
      sendJson(response, world ? 200 : 404, world ?? { error: `no Area ${located || "(none)"}` }); return true;
    }
    if (url.pathname === "/api/areas/map-shard" && request.method === "GET") {
      const result = await index.shard(String(url.searchParams.get("area") ?? ""), String(url.searchParams.get("worldRevision") ?? ""), String(url.searchParams.get("located") ?? ""));
      sendJson(response, result.status, result); return true;
    }
    return false;
  }
  return { handle };
}
