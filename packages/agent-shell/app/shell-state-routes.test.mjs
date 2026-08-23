import assert from "node:assert/strict";
import test from "node:test";
import { createShellStateRoutes } from "./shell-state-routes.mjs";

/** Creates a response recorder. */
function response() {
  return {
    /** Records headers. */
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    /** Records a response body. */
    end(body) { this.body = body; },
  };
}

test("shell-state routes serve snapshots and the shared chat session", async () => {
  const routes = createShellStateRoutes({
    chatSession: "chat",
    /** Returns one snapshot. */
    async snapshot() { return { sessions: [] }; },
  });
  const snapshot = response();
  await routes.handle({ method: "GET" }, snapshot, new URL("http://shell/api/sessions"));
  assert.deepEqual(JSON.parse(snapshot.body), { sessions: [] });
  const config = response();
  await routes.handle({ method: "GET" }, config, new URL("http://shell/config.js"));
  assert.match(config.body, /window\.CHAT_SESSION = "chat"/);
  assert.equal(config.headers["content-type"], "text/javascript");
});
