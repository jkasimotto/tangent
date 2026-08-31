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

test("voice returns the transcript and the standard Area delivery", async () => {
  const input = Readable.from([Buffer.alloc(300, "x")]);
  input.method = "POST";
  input.headers = { "content-type": "audio/webm", "x-idempotency-key": "one" };
  const routes = createVoiceRoutes({
    chatSession: "chat",
    /** Reports configured transcription. */
    available: () => true,
    /** Returns exact transcribed text. */
    async transcribe() { return "Exact note."; },
    /** Sends one Area message. */
    async send(body) {
      assert.deepEqual(body, { to: "otto/tangent", text: "Exact note.", from: "Agent Shell voice", idempotencyKey: "one" });
      return { status: 200, value: { status: "queued", to: body.to, target: "area", live: false, receipt: "n1" } };
    },
  });
  const output = response();
  await routes.handle(input, output, new URL("http://shell/api/voice?area=otto/tangent"));
  assert.deepEqual(output.body, { transcript: "Exact note.", delivery: { status: "queued", to: "otto/tangent", target: "area", live: false, receipt: "n1" } });
});

test("voice capture rejects audio when transcription is not configured", async () => {
  /** Reports no key. */
  const available = () => false;
  const routes = createVoiceRoutes({ chatSession: "chat", available });
  const output = response();
  await routes.handle(request({ audio: "x".repeat(300) }), output, new URL("http://shell/api/voice?area=otto/tangent"));
  assert.equal(output.status, 503);
});
