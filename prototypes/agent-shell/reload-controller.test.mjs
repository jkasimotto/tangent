import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createReloadController } from "./reload-controller.mjs";

/** Creates the minimum request/response pair needed to exercise SSE handling. */
function fakeStream() {
  const request = new EventEmitter();
  const chunks = [];
  const response = {
    status: 0,
    headers: {},
    ended: false,
    /** Captures the response status and headers. */
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    /** Captures one streamed response chunk. */
    write(chunk) { chunks.push(chunk); },
    /** Captures a final response chunk and closes the fake response. */
    end(chunk) { if (chunk) chunks.push(chunk); this.ended = true; },
  };
  return { request, response, chunks };
}

test("force endpoint broadcasts to every connected reload stream", () => {
  const controller = createReloadController();
  const first = fakeStream();
  const second = fakeStream();
  const eventsUrl = new URL("http://localhost/api/reload/events");
  assert.equal(controller.handle(Object.assign(first.request, { method: "GET" }), first.response, eventsUrl), true);
  assert.equal(controller.handle(Object.assign(second.request, { method: "GET" }), second.response, eventsUrl), true);

  const force = fakeStream();
  controller.handle({ method: "POST" }, force.response, new URL("http://localhost/api/reload"));

  assert.match(first.chunks.join(""), /"reason":"force","force":true/);
  assert.match(second.chunks.join(""), /"reason":"force","force":true/);
  assert.deepEqual(JSON.parse(force.chunks.at(-1)), { ok: true, notified: 2 });
  controller.close();
});

test("source watcher coalesces a burst into one automatic reload", async () => {
  let onChange;
  let watcherClosed = false;
  const controller = createReloadController({
    watchDir: "/public",
    debounceMs: 10,
    /** Captures the watcher listener without touching the filesystem. */
    watchFiles(_dir, options, listener) {
      assert.deepEqual(options, { recursive: true });
      onChange = listener;
      return {
        /** Records that the controller disposed its watcher. */
        close() { watcherClosed = true; },
      };
    },
  });
  const stream = fakeStream();
  controller.handle(Object.assign(stream.request, { method: "GET" }), stream.response, new URL("http://localhost/api/reload/events"));

  onChange();
  onChange();
  onChange();
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(stream.chunks.filter((chunk) => chunk.startsWith("event: reload")).length, 1);
  assert.match(stream.chunks.join(""), /"reason":"source-change","force":false/);
  controller.close();
  assert.equal(watcherClosed, true);
});
