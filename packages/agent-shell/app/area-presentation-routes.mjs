import { readJson, sendJson } from "./http-json.mjs";

export function createAreaPresentationRoutes(operations) {
  async function handle(request, response, url) {
    if (request.method !== "POST") return false;
    const operation = ({
      "/api/areas/present": operations.present,
      "/api/areas/withdraw-presentation": operations.withdraw,
      "/api/areas/dismiss-presentation": operations.dismiss,
      "/api/areas/presented-opened": operations.opened,
    })[url.pathname];
    if (!operation) return false;
    const result = await operation(await readJson(request));
    sendJson(response, result.status, result.status < 400 ? result.value : { error: result.error });
    return true;
  }
  return { handle };
}
