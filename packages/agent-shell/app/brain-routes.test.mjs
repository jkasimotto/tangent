import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createBrainRoutes } from "./brain-routes.mjs";

/** Creates one JSON request double. */
function request(method, body = {}) {
  const stream = Readable.from([JSON.stringify(body)]);
  stream.method = method;
  return stream;
}

/** Creates a response double that records its JSON result. */
function response() {
  return {
    /** Records the response status. */
    writeHead(status) { this.status = status; },
    /** Records and parses the response body. */
    end(body) { this.body = JSON.parse(body); },
  };
}

test("brain routes dispatch by method and path", async () => {
  const routes = createBrainRoutes({
    /** Starts the requested Area. */
    async start(area) { return { status: 200, session: `${area}-brain`, generation: 1, reattached: false, brain: { area } }; },
  });
  const output = response();
  const handled = await routes.handle(request("POST", { area: "otto/tangent" }), output, new URL("http://shell/api/brains/start"));
  assert.equal(handled, true);
  assert.equal(output.status, 200);
  assert.equal(output.body.session, "otto/tangent-brain");
  assert.equal(await routes.handle(request("GET"), response(), new URL("http://shell/api/unknown")), false);
});

test("the answer route sends typed changes to the brain operation", async () => {
  let received;
  const routes = createBrainRoutes({
    /** Records the complete answer payload from the route. */
    async answerRequest(area, id, answer, note) {
      received = { area, id, answer, note };
      return { status: 200, request: { id, answer, note } };
    },
  });
  const output = response();
  await routes.handle(request("POST", { area: "otto/tangent", id: "r1", answer: "changes", note: "Use less text." }), output, new URL("http://shell/api/brains/requests/answer"));
  assert.deepEqual(received, { area: "otto/tangent", id: "r1", answer: "changes", note: "Use less text." });
  assert.equal(output.status, 200);
});

test("withdraw and dismiss routes keep brain and Julian authority separate", async () => {
  const received = [];
  const routes = createBrainRoutes({
    /** Records a brain-owned withdrawal. */
    async withdrawRequest(session, id, note) { received.push({ kind: "withdraw", session, id, note }); return { status: 200, request: { id } }; },
    /** Records Julian's durable dismissal. */
    async dismissRequest(area, id) { received.push({ kind: "dismiss", area, id }); return { status: 200, request: { id } }; },
  });
  await routes.handle(request("POST", { session: "brain-g2", id: "r1", note: "Obsolete." }), response(), new URL("http://shell/api/brains/requests/withdraw"));
  await routes.handle(request("POST", { area: "otto/tangent", id: "r2" }), response(), new URL("http://shell/api/brains/requests/dismiss"));
  assert.deepEqual(received, [
    { kind: "withdraw", session: "brain-g2", id: "r1", note: "Obsolete." },
    { kind: "dismiss", area: "otto/tangent", id: "r2" },
  ]);
});
