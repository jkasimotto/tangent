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

test("message delivery rejects excess queued work explicitly", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-message-limit-"));
  const target = { name: "worker", state: "working", stateDetail: null };
  const delivery = createMessageDelivery({
    file: path.join(root, "messages.jsonl"),
    /** Returns the live fixture target. */
    sessions: async () => [target],
    /** Accepts fixture text delivery. */
    deliverText: async () => true,
    notices: {
      /** Accepts fixture notice delivery. */
      delivered: async () => {},
      /** Accepts fixture notice release. */
      released() {},
    },
    /** Accepts fixture polling wake-up. */
    wake() {},
    maxPerTarget: 2,
    maxTotal: 2,
    /** Accepts the expected queue-limit report. */
    report() {},
  });
  const entry = { from: "brain", area: "otto", text: "facts", queuedAt: "then" };
  assert.equal((await delivery.dispatch(target, entry)).status, 200);
  assert.equal((await delivery.dispatch(target, entry)).status, 200);
  assert.equal((await delivery.dispatch(target, entry)).status, 429);
  assert.equal(delivery.totalQueued(), 2);
});

test("message delivery makes bounded parallel progress across targets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-message-parallel-"));
  const targets = Array.from({ length: 100 }, (_, index) => ({ name: `worker-${index}`, state: "working", stateDetail: null }));
  let active = 0;
  let peak = 0;
  const delivery = createMessageDelivery({
    file: path.join(root, "messages.jsonl"),
    /** Returns every target as ready for fixture delivery. */
    sessions: async () => targets.map((target) => ({ ...target, state: "waiting", stateDetail: "idle" })),
    /** Records the maximum number of simultaneous target deliveries. */
    deliverText: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return true;
    },
    notices: {
      /** Accepts fixture notice delivery. */
      delivered: async () => {},
      /** Accepts fixture notice release. */
      released() {},
    },
    /** Accepts fixture polling wake-up. */
    wake() {},
    concurrency: 8,
  });
  const entry = { from: "brain", area: "otto", text: "facts", queuedAt: "then" };
  for (const target of targets) assert.ok(delivery.queue(target.name, entry));
  await delivery.tick();
  assert.equal(peak, 8);
  assert.equal(delivery.totalQueued(), 0);
});

test("an arriving dispatch cannot overbook slots held by a queue tick", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-message-race-"));
  const targets = Array.from({ length: 9 }, (_, index) => ({ name: `worker-${index}`, state: "waiting", stateDetail: "idle" }));
  let active = 0;
  let peak = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const delivery = createMessageDelivery({
    file: path.join(root, "messages.jsonl"),
    /** Returns the ready fixture targets. */
    sessions: async () => targets,
    /** Holds each fixture delivery at one shared gate. */
    deliverText: async () => { active += 1; peak = Math.max(peak, active); await gate; active -= 1; return true; },
    notices: {
      /** Accepts fixture notice delivery. */
      delivered: async () => {},
      /** Accepts fixture notice release. */
      released() {},
    },
    /** Accepts fixture polling wake-up. */
    wake() {},
    concurrency: 8,
  });
  const entry = { from: "brain", area: "otto", text: "facts", queuedAt: "then" };
  for (const target of targets.slice(0, 8)) delivery.queue(target.name, entry);
  const ticking = delivery.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await delivery.dispatch(targets[8], entry)).state, "queued");
  release();
  await ticking;
  assert.equal(peak, 8);
  assert.equal(delivery.totalQueued(), 1);
});
