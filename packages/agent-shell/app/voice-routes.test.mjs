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

test("typed commands use the same context and routing operations", async () => {
  const routes = createVoiceRoutes({
    chatSession: "chat",
    /** Reports configured routing. */
    available: () => true,
    /** Builds context. */
    async context(focused) { return { focused }; },
    /** Routes text. */
    async route(text, focused) { return { summary: [`${focused}:${text}`] }; },
  });
  const output = response();
  await routes.handle(request({ text: "status" }), output, new URL("http://shell/api/command"));
  assert.deepEqual(output.body, { transcript: "status", summary: ["chat:status"] });
});

test("voice routes reject requests when routing is not configured", async () => {
  /** Reports no key. */
  const available = () => false;
  const routes = createVoiceRoutes({ chatSession: "chat", available });
  const output = response();
  await routes.handle(request({ text: "status" }), output, new URL("http://shell/api/command"));
  assert.equal(output.status, 503);
});
