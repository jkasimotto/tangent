import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createShellControlRoutes } from "./shell-control-routes.mjs";

/** Creates a request double. */
function request(method, body = {}) {
  const stream = Readable.from([JSON.stringify(body)]);
  stream.method = method;
  return stream;
}

/** Creates a response recorder. */
function response() {
  return {
    /** Records status. */
    writeHead(status) { this.status = status; },
    /** Records JSON. */
    end(body) { this.body = JSON.parse(body); },
  };
}

test("shell controls route exact and prefix endpoints", async () => {
  const routes = createShellControlRoutes({
    /** Changes the agent command. */
    async agent(command) { return command; },
    /** Refuses the orchestrator kill. */
    async kill(name) { return { status: 400, error: `refuse ${name}` }; },
  });
  const agent = response();
  await routes.handle(request("POST", { cmd: "claude" }), agent, new URL("http://shell/api/agent"));
  assert.equal(agent.body.agent, "claude");
  const killed = response();
  await routes.handle(request("POST"), killed, new URL("http://shell/api/kill/chat"));
  assert.equal(killed.status, 400);
  assert.equal(killed.body.error, "refuse chat");
});
