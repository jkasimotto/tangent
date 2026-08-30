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
    features: { areaMapWorld: false },
    /** Returns one snapshot. */
    async snapshot() { return { sessions: [] }; },
  });
  const snapshot = response();
  await routes.handle({ method: "GET" }, snapshot, new URL("http://shell/api/sessions"));
  assert.deepEqual(JSON.parse(snapshot.body), { sessions: [] });
  const config = response();
  await routes.handle({ method: "GET" }, config, new URL("http://shell/config.js"));
  assert.match(config.body, /window\.CHAT_SESSION = "chat"/);
  assert.match(config.body, /window\.TANGENT_FEATURES = \{"areaMapWorld":false\}/);
  assert.equal(config.headers["content-type"], "text/javascript");
});

test("Work route serves hashed bytes and honors conditional reads", async () => {
  const body = JSON.stringify({ schema: "agent-shell-work.v1" });
  const routes = createShellStateRoutes({
    chatSession: "chat",
    /** Returns one hashed Work response. */
    async work() { return { body, bytes: Buffer.byteLength(body), etag: '"work-1"' }; },
  });
  const first = response();
  await routes.handle({ method: "GET", headers: {} }, first, new URL("http://shell/api/work"));
  assert.equal(first.status, 200);
  assert.equal(first.headers.etag, '"work-1"');
  assert.equal(first.body, body);

  const unchanged = response();
  await routes.handle({ method: "GET", headers: { "if-none-match": '"work-1"' } }, unchanged, new URL("http://shell/api/work"));
  assert.equal(unchanged.status, 304);
  assert.equal(unchanged.body, undefined);
});
