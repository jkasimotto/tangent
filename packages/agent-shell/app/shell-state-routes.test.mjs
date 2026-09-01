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
    instanceId: "instance-a",
    features: { areaMapWorld: false },
    /** Returns one snapshot. */
    async snapshot() { return { sessions: [] }; },
    /** Returns bounded shell status. */
    async status() { return { currentCommit: "abc" }; },
    /** Returns bounded prompt inspection. */
    async promptInspect() { return { schema: "agent-shell-prompt-inspect.v1" }; },
  });
  const snapshot = response();
  await routes.handle({ method: "GET" }, snapshot, new URL("http://shell/api/sessions"));
  assert.deepEqual(JSON.parse(snapshot.body), { sessions: [] });
  const config = response();
  await routes.handle({ method: "GET" }, config, new URL("http://shell/config.js"));
  assert.match(config.body, /window\.CHAT_SESSION = "chat"/);
  assert.match(config.body, /window\.TANGENT_FEATURES = \{"areaMapWorld":false\}/);
  assert.match(config.body, /agent-shell-work\.v3/);
  assert.equal(config.headers["content-type"], "text/javascript");
  const status = response();
  await routes.handle({ method: "GET" }, status, new URL("http://shell/api/shell/status"));
  assert.deepEqual(JSON.parse(status.body), { currentCommit: "abc" });
  const prompts = response();
  await routes.handle({ method: "GET" }, prompts, new URL("http://shell/api/prompts/inspect"));
  assert.deepEqual(JSON.parse(prompts.body), { schema: "agent-shell-prompt-inspect.v1" });
});
