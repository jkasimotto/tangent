import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createStateEvents } from "./state-events.mjs";

/** Creates the writable response surface needed by the event-hub fixture. */
function fixtureResponse() {
  const response = new EventEmitter();
  Object.assign(response, {
    destroyed: false, writableEnded: false, writableNeedDrain: false, writes: [], status: 0,
    /** Records the fixture response status. */
    writeHead(status) { this.status = status; },
    /** Records one fixture event write. */
    write(value) { this.writes.push(value); return !this.writableNeedDrain; },
    /** Ends the fixture response. */
    end(value = "") { if (value) this.writes.push(value); this.writableEnded = true; },
  });
  return response;
}

test("state event hub caps clients and skips backpressured duplicates", () => {
  const hub = createStateEvents({ maxClients: 1, heartbeatMs: 60_000 });
  const request = new EventEmitter();
  const first = fixtureResponse();
  assert.equal(hub.connect(request, first), true);
  first.writableNeedDrain = true;
  hub.changed("one");
  hub.changed("two");
  assert.equal(first.writes.length, 1, "only the ready event is buffered");
  const second = fixtureResponse();
  assert.equal(hub.connect(new EventEmitter(), second), false);
  assert.equal(second.status, 503);
  request.emit("close");
  assert.equal(hub.size(), 0);
  hub.close();
});
