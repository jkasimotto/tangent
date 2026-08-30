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
  const goalStops = [];
  const routes = createShellControlRoutes({
    /** Changes the agent command. */
    async agent(command) { return command; },
    /** Refuses the orchestrator kill. */
    async kill(name) { return { status: 400, error: `refuse ${name}` }; },
    /** Records the fenced Goal stop. */
    async stopGoal(body) { goalStops.push(body); return { status: 200, value: { target: body.expectedSession, goal: body.goal } }; },
  });
  const agent = response();
  await routes.handle(request("POST", { cmd: "claude" }), agent, new URL("http://shell/api/agent"));
  assert.equal(agent.body.agent, "claude");
  const killed = response();
  await routes.handle(request("POST"), killed, new URL("http://shell/api/kill/chat"));
  assert.equal(killed.status, 400);
  assert.equal(killed.body.error, "refuse chat");
  const stopped = response();
  await routes.handle(request("POST", { goal: "otto/tangent/goal-one.md", expectedSession: "agent-one", expectedTarget: "$1916" }), stopped, new URL("http://shell/api/goals/stop"));
  assert.deepEqual(stopped.body, { target: "agent-one", goal: "otto/tangent/goal-one.md" });
  assert.deepEqual(goalStops, [{ goal: "otto/tangent/goal-one.md", expectedSession: "agent-one", expectedTarget: "$1916" }]);
});
