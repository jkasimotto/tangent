import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMessageDelivery } from "./message-delivery.mjs";
import { openMessageQueueStore } from "./message-queue-store.mjs";

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
  assert.deepEqual(released, [], "a dropped notice is not released; it stays unread in its inbox for the sweep");
  assert.equal(delivery.queuedCount("worker-2"), 0);
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

test("a worker report reaches a brain that never stops working, in order", async () => {
  // The production block: tangent-brain-g313 held one queued notice until its
  // composer ended, so the assignment queue it controls could not advance.
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-message-working-brain-"));
  const file = path.join(root, "messages.jsonl");
  const brain = { name: "tangent-brain-g313", kind: "brain", state: "working", stateDetail: null, composer: "idle" };
  const delivered = [];
  const read = [];
  const delivery = createMessageDelivery({
    file,
    /** Returns the working brain as the only live session. */
    sessions: async () => [brain],
    /** Records what the transport was asked to type and how. */
    deliverText: async (target, text, label, options) => { delivered.push({ target, text, label, options }); return true; },
    notices: {
      /** Records which durable notices the brain read. */
      delivered: async (notices) => { read.push(...notices); },
      /** Fails the test if a delivered notice is released instead. */
      released: (notices) => { throw new Error(`released ${JSON.stringify(notices)}`); },
    },
    /** Accepts fixture polling wake-up. */
    wake() {},
  });
  const report = { from: "tangent", area: null, text: "Goal g: assignment 1 submitted implementation-result.", queuedAt: "then", notices: [{ area: "otto/tangent", id: "n1" }] };
  const ready = { from: "tangent", area: null, text: "Goal g: assignment 2 is ready and waits for your command.", queuedAt: "then", notices: [{ area: "otto/tangent", id: "n2" }] };
  assert.equal(delivery.queue(brain.name, report), 1);
  assert.equal(delivery.queue(brain.name, ready), 2);
  await delivery.tick();
  await delivery.tick();
  assert.equal(delivery.queuedCount(brain.name), 0, "nothing waits for the brain's turn to end");
  assert.deepEqual(delivered.map((call) => call.text.includes("assignment 1")), [true, false]);
  assert.deepEqual(delivered.map((call) => call.options.settle), [false, false], "a working harness is typed into at once");
  assert.deepEqual(read, [...report.notices, ...ready.notices]);
});

test("a brain composing text keeps its queued report until the text is gone", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-message-brain-draft-"));
  const brain = { name: "tangent-brain-g313", kind: "brain", state: "working", stateDetail: null, composer: "draft" };
  const delivered = [];
  const delivery = createMessageDelivery({
    file: path.join(root, "messages.jsonl"),
    /** Returns the mutable brain fixture. */
    sessions: async () => [brain],
    /** Records fixture text delivery. */
    deliverText: async (...args) => { delivered.push(args); return true; },
    notices: {
      /** Accepts fixture notice delivery. */
      delivered: async () => {},
      /** Fails the test if a still-queued notice is released. */
      released: () => { throw new Error("released a queued notice"); },
    },
    /** Accepts fixture polling wake-up. */
    wake() {},
  });
  const entry = { from: "tangent", area: null, text: "Goal g: assignment 1 submitted implementation-result.", queuedAt: "then", notices: [{ area: "otto/tangent", id: "n1" }] };
  assert.equal((await delivery.dispatch(brain, entry)).state, "queued");
  await delivery.tick();
  assert.equal(delivered.length, 0, "unsent text in the composer is never typed over");
  assert.equal(delivery.queuedCount(brain.name), 1);
  brain.composer = "idle";
  await delivery.tick();
  assert.equal(delivered.length, 1);
  assert.equal(delivery.queuedCount(brain.name), 0);
});

test("generic messages persist before wake and survive a controller restart in order", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-message-restart-"));
  const queueFile = path.join(root, "state", "message-queue.json");
  const logFile = path.join(root, "messages.jsonl");
  const blocked = { name: "worker", state: "working", stateDetail: null, composer: "draft" };
  const firstStore = await openMessageQueueStore({ file: queueFile });
  const wakeDepths = [];
  const firstController = createMessageDelivery({
    file: logFile,
    store: firstStore,
    /** Test helper for sessions. */
    sessions: async () => [blocked],
    /** Test helper for deliverText. */
    deliverText: async () => true,
    notices: {
      /** Test helper for delivered. */
      delivered: async () => {},
      /** Test helper for released. */
      released() {} },
    /** Records the durable depth visible at each delivery wake. */
    wake: () => wakeDepths.push(firstStore.entries().length),
  });
  for (const text of ["first", "second"]) {
    const result = await firstController.dispatch(blocked, { from: "sender", area: "otto", text, durable: true, queuedAt: "then" });
    assert.equal(result.state, "queued");
  }
  assert.deepEqual(wakeDepths, [1, 2], "each wake happens after its atomic append");

  const delivered = [];
  const ready = { ...blocked, state: "waiting", stateDetail: "idle", composer: "idle" };
  const restartedStore = await openMessageQueueStore({ file: queueFile });
  const restarted = createMessageDelivery({
    file: logFile,
    store: restartedStore,
    /** Test helper for sessions. */
    sessions: async () => [ready],
    /** Test helper for deliverText. */
    deliverText: async (_target, text) => { delivered.push(text); return true; },
    notices: {
      /** Test helper for delivered. */
      delivered: async () => {},
      /** Test helper for released. */
      released() {} },
    /** Test helper for wake. */
    wake() {},
  });
  assert.equal(restarted.queuedCount("worker"), 2);
  await restarted.tick();
  await restarted.tick();
  assert.deepEqual(delivered.map((text) => text.endsWith(" first") ? "first" : text.endsWith(" second") ? "second" : text), ["first", "second"]);
  assert.equal(restarted.totalQueued(), 0);
  assert.deepEqual((await openMessageQueueStore({ file: queueFile })).entries(), []);
});

test("an immediately presentable generic message stays durable until delivery settles", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-message-settlement-"));
  const store = await openMessageQueueStore({ file: path.join(root, "message-queue.json") });
  const target = { name: "worker", state: "waiting", stateDetail: "idle" };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let entered;
  const deliveryEntered = new Promise((resolve) => { entered = resolve; });
  const delivery = createMessageDelivery({
    file: path.join(root, "messages.jsonl"),
    store,
    /** Test helper for sessions. */
    sessions: async () => [target],
    /** Holds the presentation boundary open. */
    deliverText: async () => { entered(); await gate; return true; },
    notices: {
      /** Test helper for delivered. */
      delivered: async () => {},
      /** Test helper for released. */
      released() {} },
    /** Accepts the settlement wake. */
    wake() {},
  });
  const dispatched = delivery.dispatch(target, { from: "sender", area: null, text: "facts", durable: true, queuedAt: "then" });
  await deliveryEntered;
  assert.equal(store.entries().length, 1, "the accepted message is durable while presentation is in flight");
  release();
  const result = await dispatched;
  assert.equal(result.state, "delivered", "an immediate send waits for its submission receipt");
  assert.equal(store.entries().length, 0, "settlement removes the durable entry");
});

test("a failed immediate presentation remains durable across restart and retries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-message-false-immediate-"));
  const queueFile = path.join(root, "message-queue.json");
  const target = { name: "worker", state: "waiting", stateDetail: "idle" };
  const firstStore = await openMessageQueueStore({ file: queueFile });
  let attempted;
  const attemptedPresentation = new Promise((resolve) => { attempted = resolve; });
  const first = createMessageDelivery({
    file: path.join(root, "messages.jsonl"),
    store: firstStore,
    /** Test helper for sessions. */
    sessions: async () => [target],
    /** Simulates the pane refusing or failing to echo the complete prompt. */
    deliverText: async () => false,
    notices: {
      /** Test helper for delivered. */
      delivered: async () => {},
      /** Test helper for released. */
      released() {} },
    wake: attempted,
  });

  const accepted = await first.dispatch(target, { from: "sender", area: null, text: "facts", durable: true, queuedAt: "then" });
  assert.equal(accepted.state, "queued");
  assert.match(accepted.reason, /durable message will retry/);
  await attemptedPresentation;
  assert.equal(first.queuedCount(target.name), 1, "a false receipt leaves the live queue head pending");
  assert.equal(firstStore.entries().length, 1, "a false receipt never removes the disk record");

  const delivered = [];
  const restartedStore = await openMessageQueueStore({ file: queueFile });
  const restarted = createMessageDelivery({
    file: path.join(root, "messages.jsonl"),
    store: restartedStore,
    /** Test helper for sessions. */
    sessions: async () => [target],
    /** Test helper for deliverText. */
    deliverText: async (_target, text) => { delivered.push(text); return true; },
    notices: {
      /** Test helper for delivered. */
      delivered: async () => {},
      /** Test helper for released. */
      released() {} },
    /** Test helper for wake. */
    wake() {},
  });
  assert.equal(restarted.queuedCount(target.name), 1, "restart hydrates the presentation that did not arrive");
  await restarted.tick();
  assert.equal(delivered.length, 1);
  assert.equal(restarted.queuedCount(target.name), 0);
  assert.equal(restartedStore.entries().length, 0, "only the true retry receipt settles the record");
});

test("a terminal submission failure reports the source Brain and restarts on the immutable target", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-message-terminal-restart-"));
  const queueFile = path.join(root, "message-queue.json");
  const target = { name: "worker", target: "$17", instanceId: "controller-1", assignment: "assignment-2", attempt: "attempt-3", launchRef: "codex/sol", state: "waiting", stateDetail: "idle" };
  const failures = [];
  /** Returns one stable fixture delivery ID. */
  const messageId = () => "message-1";
  const firstStore = await openMessageQueueStore({ file: queueFile, id: messageId });
  const first = createMessageDelivery({
    file: path.join(root, "messages.jsonl"),
    store: firstStore,
    /** Returns the exact initial fixture target. */
    sessions: async () => [target],
    /** Simulates a proved full draft that every submission key leaves unsent. */
    deliverText: async (_target, _text, _label, options) => {
      await options.checkpoint("submitting");
      throw Object.assign(new Error("Message message-1 was not submitted to worker ($17, codex) after 3 submission attempts. Its full text still exists in the worker composer."), { deliveryState: "failed" });
    },
    notices: {
      /** Accepts fixture notice delivery. */
      delivered: async () => {},
      /** Accepts fixture notice release. */
      released() {},
    },
    /** Records the source-Brain failure callback. */
    onFailure: async (failure) => failures.push(failure),
    /** Accepts a fixture scheduler wake. */
    wake() {},
    /** Suppresses the expected terminal report. */
    report() {},
  });
  const result = await first.dispatch(target, { from: "brain", area: "otto/tangent", sourceRole: "brain", text: "facts", durable: true });
  assert.equal(result.status, 409);
  assert.match(result.error, /full text still exists in the worker composer/);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].entry.deliveryId, "message-1");
  assert.deepEqual(firstStore.entries()[0].targetIdentity, {
    name: "worker", target: "$17", instanceId: "controller-1", assignment: "assignment-2", attempt: "attempt-3", launchRef: "codex/sol",
  });
  assert.equal(firstStore.entries()[0].deliveryState, "failed");

  const restartedStore = await openMessageQueueStore({ file: queueFile });
  let retried = 0;
  const restarted = createMessageDelivery({
    file: path.join(root, "messages.jsonl"),
    store: restartedStore,
    /** Returns the same exact target with its durable draft visible. */
    sessions: async () => [{ ...target, state: "working", composer: "draft" }],
    /** Verifies restart recovery keeps the target and state. */
    deliverText: async (exactTarget, _text, _label, options) => {
      retried += 1;
      assert.equal(exactTarget.target, "$17");
      assert.equal(options.deliveryState, "failed");
      return true;
    },
    notices: {
      /** Accepts fixture notice delivery. */
      delivered: async () => {},
      /** Accepts fixture notice release. */
      released() {},
    },
    /** Accepts a fixture scheduler wake. */
    wake() {},
  });
  await restarted.tick();
  assert.equal(retried, 1, "restart retries submission of the durable staged draft");
  assert.deepEqual(restartedStore.entries(), [], "the proved retry settles exactly once");
});

test("restart settles a submitted checkpoint without replaying text or its notice", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-message-submitted-restart-"));
  const queueFile = path.join(root, "message-queue.json");
  /** Returns one stable fixture delivery ID. */
  const messageId = () => "message-submitted";
  const firstStore = await openMessageQueueStore({ file: queueFile, id: messageId });
  await firstStore.append("worker", {
    from: "brain",
    area: "otto/tangent",
    text: "already submitted facts",
    notices: [{ area: "otto/tangent", id: "notice-1" }],
    generation: 7,
    brainArea: "otto/tangent",
  });
  await firstStore.update("message-submitted", { deliveryState: "submitted" });

  const restartedStore = await openMessageQueueStore({ file: queueFile });
  let sessionReads = 0;
  let deliveryAttempts = 0;
  const settledNotices = [];
  const restarted = createMessageDelivery({
    file: path.join(root, "messages.jsonl"),
    store: restartedStore,
    /** A terminal receipt must settle before target discovery. */
    sessions: async () => { sessionReads += 1; return []; },
    /** Replaying this text would duplicate the already submitted message. */
    deliverText: async () => { deliveryAttempts += 1; return true; },
    notices: {
      /** Records the durable notice effect that follows submission. */
      delivered: async (...args) => settledNotices.push(args),
      /** Accepts fixture notice release. */
      released() {},
    },
    /** Accepts a fixture scheduler wake. */
    wake() {},
  });

  await restarted.tick();
  assert.equal(sessionReads, 0);
  assert.equal(deliveryAttempts, 0, "a submitted checkpoint never types or submits again");
  assert.deepEqual(settledNotices, [[[ { area: "otto/tangent", id: "notice-1" } ], "worker", 7, "otto/tangent"]]);
  assert.equal(restarted.queuedCount("worker"), 0);
  assert.deepEqual(restartedStore.entries(), []);
});

test("a queued durable presentation retries after deliverText returns false", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-message-false-tick-"));
  const store = await openMessageQueueStore({ file: path.join(root, "message-queue.json") });
  const target = { name: "worker", state: "working", composer: "draft" };
  let attempts = 0;
  const delivery = createMessageDelivery({
    file: path.join(root, "messages.jsonl"),
    store,
    /** Test helper for sessions. */
    sessions: async () => [{ ...target, state: "waiting", stateDetail: "idle", composer: "idle" }],
    /** Test helper for deliverText. */
    deliverText: async () => { attempts += 1; return attempts > 1; },
    notices: {
      /** Test helper for delivered. */
      delivered: async () => {},
      /** Test helper for released. */
      released() {} },
    /** Test helper for wake. */
    wake() {},
  });
  assert.equal((await delivery.dispatch(target, { from: "sender", area: null, text: "facts", durable: true, queuedAt: "then" })).state, "queued");

  await delivery.tick();
  assert.equal(attempts, 1);
  assert.equal(delivery.queuedCount(target.name), 1);
  assert.equal(store.entries().length, 1, "the false tick receipt keeps durable state");

  await delivery.tick();
  assert.equal(attempts, 2);
  assert.equal(delivery.queuedCount(target.name), 0);
  assert.equal(store.entries().length, 0, "the first true receipt settles the head");
});

test("a failed durable append neither wakes nor presents the message", async () => {
  const target = { name: "worker", state: "waiting", stateDetail: "idle" };
  let woke = 0;
  let presented = 0;
  const delivery = createMessageDelivery({
    file: path.join(await mkdtemp(path.join(os.tmpdir(), "tangent-message-write-fail-")), "messages.jsonl"),
    store: {
      /** Test helper for entries. */
      entries: () => [],
      /** Simulates the atomic store refusing the acceptance write. */
      async append() { throw new Error("disk unavailable"); },
    },
    /** Test helper for sessions. */
    sessions: async () => [target],
    /** Test helper for deliverText. */
    deliverText: async () => { presented += 1; return true; },
    notices: {
      /** Test helper for delivered. */
      delivered: async () => {},
      /** Test helper for released. */
      released() {} },
    /** Test helper for wake. */
    wake: () => { woke += 1; },
  });
  await assert.rejects(
    delivery.dispatch(target, { from: "sender", area: null, text: "facts", durable: true, queuedAt: "then" }),
    /disk unavailable/,
  );
  assert.equal(woke, 0);
  assert.equal(presented, 0);
  assert.equal(delivery.totalQueued(), 0);
});

test("a durable retarget restarts on the exact replacement session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-message-retarget-restart-"));
  const queueFile = path.join(root, "message-queue.json");
  const store = await openMessageQueueStore({ file: queueFile });
  const oldTarget = { name: "worker-old", state: "working", composer: "draft" };
  const delivery = createMessageDelivery({
    file: path.join(root, "messages.jsonl"),
    store,
    /** Test helper for sessions. */
    sessions: async () => [oldTarget],
    /** Test helper for deliverText. */
    deliverText: async () => true,
    notices: {
      /** Test helper for delivered. */
      delivered: async () => {},
      /** Test helper for released. */
      released() {} },
    /** Test helper for wake. */
    wake() {},
  });
  await delivery.dispatch(oldTarget, { from: "sender", area: null, text: "facts", durable: true, queuedAt: "then" });
  await delivery.retarget("worker-old", "worker-new");

  const restarted = createMessageDelivery({
    file: path.join(root, "messages.jsonl"),
    store: await openMessageQueueStore({ file: queueFile }),
    /** Test helper for sessions. */
    sessions: async () => [],
    /** Test helper for deliverText. */
    deliverText: async () => true,
    notices: {
      /** Test helper for delivered. */
      delivered: async () => {},
      /** Test helper for released. */
      released() {} },
    /** Test helper for wake. */
    wake() {},
  });
  assert.equal(restarted.queuedCount("worker-old"), 0);
  assert.equal(restarted.queuedCount("worker-new"), 1);
});

test("a brain notice is queued durably, survives a restart, and is read only when shown", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-message-notice-durable-"));
  const queueFile = path.join(root, "state", "message-queue.json");
  const logFile = path.join(root, "messages.jsonl");
  const brain = { name: "tangent-brain-g1", kind: "brain", state: "working", stateDetail: null, composer: "draft" };
  const read = [];
  /** Builds one delivery over the same store file, as a restarted server does. */
  const open = async (store) => createMessageDelivery({
    file: logFile,
    store,
    /** Returns the brain fixture. */
    sessions: async () => [brain],
    /** Accepts fixture text delivery. */
    deliverText: async () => true,
    notices: {
      /** Records which durable notices the brain read. */
      delivered: async (notices, target, generation) => { read.push({ notices, target, generation }); },
    },
    /** Accepts fixture polling wake-up. */
    wake() {},
  });
  const first = await open(await openMessageQueueStore({ file: queueFile }));
  const entry = { from: "tangent", area: null, text: "Goal g: assignment 1 done.", notices: [{ area: "otto/tangent", id: "n1" }], generation: 1 };
  assert.equal(await first.queueDurable(brain.name, entry), 1);
  assert.deepEqual([...first.pendingNotices()], ["otto/tangent n1"], "a queued notice is on its way");
  await first.tick();
  assert.equal(read.length, 0, "a drafting brain is not typed over, and the notice stays queued");

  // A restart reloads the entry, with its notices, from the queue file.
  const second = await open(await openMessageQueueStore({ file: queueFile }));
  assert.deepEqual([...second.pendingNotices()], ["otto/tangent n1"]);
  brain.composer = "idle";
  await second.tick();
  assert.deepEqual(read, [{ notices: [{ area: "otto/tangent", id: "n1" }], target: brain.name, generation: 1 }]);
  assert.equal(second.queuedCount(brain.name), 0);
  assert.deepEqual([...second.pendingNotices()], [], "a shown notice leaves the queue");
  assert.deepEqual((await openMessageQueueStore({ file: queueFile })).entries(), [], "and the file");
});
