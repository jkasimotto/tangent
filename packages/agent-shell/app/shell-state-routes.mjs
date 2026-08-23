import { sendJson } from "./http-json.mjs";

/** Creates routes for the browser's boot configuration and live snapshot. */
export function createShellStateRoutes(operations) {
  /** Handles one matching request and reports whether this router owned it. */
  async function handle(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/sessions") {
      sendJson(response, 200, await operations.snapshot());
      return true;
    }
    if (request.method === "GET" && url.pathname === "/config.js") {
      response.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-cache" });
      response.end(`window.CHAT_SESSION = ${JSON.stringify(operations.chatSession)};\n`);
      return true;
    }
    return false;
  }
  return { handle };
}
