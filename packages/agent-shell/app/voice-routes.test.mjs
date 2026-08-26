import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createVoiceRoutes } from "./voice-routes.mjs";

/** Creates a request double. */
function request(body) {
  const stream = Readable.from([JSON.stringify(body)]);
  stream.method = "POST";
  stream.headers = {};
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

test("typed capture saves exact text to the named Area", async () => {
  const routes = createVoiceRoutes({
    chatSession: "chat",
    /** Reports configured routing. */
    available: () => true,
    /** Saves one Journal entry. */
    async capture(body) { return { area: body.area, text: body.text }; },
  });
  const output = response();
  await routes.handle(request({ area: "otto/tangent", text: "Exact note.", idempotencyKey: "one" }), output, new URL("http://shell/api/command"));
  assert.deepEqual(output.body, { transcript: "Exact note.", entry: { area: "otto/tangent", text: "Exact note." } });
});

test("voice capture rejects audio when transcription is not configured", async () => {
  /** Reports no key. */
  const available = () => false;
  const routes = createVoiceRoutes({ chatSession: "chat", available });
  const output = response();
  await routes.handle(request({ audio: "x".repeat(300) }), output, new URL("http://shell/api/voice?area=otto/tangent"));
  assert.equal(output.status, 503);
});
