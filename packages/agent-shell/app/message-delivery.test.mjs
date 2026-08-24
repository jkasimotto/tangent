import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMessageDelivery } from "./message-delivery.mjs";

test("message delivery owns ordering, retargeting, and dead-target drops", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-message-delivery-"));
  const file = path.join(root, "messages.jsonl");
  let live = [{ name: "worker", state: "working", stateDetail: null }];
  const released = [];
  const delivery = createMessageDelivery({
    file,
    /** Returns the mutable live-session fixture. */
    sessions: async () => live,
    /** Accepts fixture text delivery. */
    deliverText: async () => true,
    notices: {
      /** Accepts fixture notice delivery. */
      delivered: async () => {},
      /** Records fixture notice release. */
      released: (items) => released.push(...items),
    },
    /** Accepts fixture polling wake-up. */
    wake() {},
    /** Returns a stable fixture timestamp. */
    now: () => "now",
  });
  const entry = { from: "brain", area: "otto", text: "facts", queuedAt: "then", notices: [{ area: "otto", id: "1" }] };
  assert.equal((await delivery.dispatch(live[0], entry)).state, "queued");
  assert.equal(delivery.queuedCount("worker"), 1);
  delivery.retarget("worker", "worker-2");
  assert.equal(delivery.queuedCount("worker-2"), 1);
  live = [];
  await delivery.tick();
  assert.deepEqual(released, entry.notices);
  assert.match(await readFile(file, "utf8"), /"event":"dropped"/);
});

test("message delivery sends immediately only to an empty composer", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-message-immediate-"));
  const delivered = [];
  const target = { name: "worker", state: "waiting", stateDetail: "idle" };
  const delivery = createMessageDelivery({
    file: path.join(root, "messages.jsonl"),
    /** Returns the live fixture target. */
    sessions: async () => [target],
    /** Records fixture text delivery. */
    deliverText: async (...args) => { delivered.push(args); return true; },
    notices: {
      /** Accepts fixture notice delivery. */
      delivered: async () => {},
      /** Accepts fixture notice release. */
      released() {},
    },
    /** Accepts fixture polling wake-up. */
    wake() {},
  });
  const result = await delivery.dispatch(target, { from: "brain", area: "otto", text: "facts", queuedAt: "then" });
  assert.equal(result.state, "delivered");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(delivered.length, 1);
});
