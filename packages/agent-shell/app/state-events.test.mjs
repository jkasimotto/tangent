import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createStateEvents } from "./state-events.mjs";

test("state events connect, invalidate, and disconnect clients", () => {
  const events = createStateEvents();
  const request = new EventEmitter();
  const writes = [];
  const response = {
    /** Records the stream headers. */
    writeHead(status, headers) { writes.push({ status, headers }); },
    /** Records one stream event. */
    write(value) { writes.push(value); },
  };

  events.connect(request, response);
  events.changed("/api/goals/create");
  request.emit("close");
  events.changed("ignored");

  assert.equal(writes[0].status, 200);
  assert.match(writes[1], /event: ready/);
  assert.match(writes[2], /api\/goals\/create/);
  assert.equal(writes.length, 3);
});
