import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MESSAGE_QUEUE_SCHEMA, normalizeMessageQueue, openMessageQueueStore } from "./message-queue-store.mjs";

test("message queue normalization keeps only exact, unique recipients", () => {
  const valid = { id: "m1", target: "worker-1", from: "brain", area: "otto", text: "facts", banner: true, queuedAt: "then" };
  assert.deepEqual(normalizeMessageQueue({
    schema: MESSAGE_QUEUE_SCHEMA,
    entries: [valid, { ...valid, text: "duplicate" }, { ...valid, id: "m2", target: "" }, null],
  }), { schema: MESSAGE_QUEUE_SCHEMA, entries: [valid] });
  assert.deepEqual(normalizeMessageQueue({ schema: "foreign", entries: [valid] }), { schema: MESSAGE_QUEUE_SCHEMA, entries: [] });
});

test("the file store serializes atomic appends, retargets, and removal", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-message-store-"));
  const file = path.join(root, "messages", "queue.json");
  const ids = ["m1", "m2", "m3"];
  const store = await openMessageQueueStore({ file,
    /** Test helper for id. */
    id: () => ids.shift(),
    /** Test helper for now. */
    now: () => "now" });
  await Promise.all([
    store.append("old", { from: "one", text: "first" }),
    store.append("new", { from: "two", text: "ahead" }),
    store.append("old", { from: "three", text: "second" }),
  ]);
  assert.deepEqual(store.entries().map((entry) => entry.id), ["m1", "m2", "m3"]);

  await store.retarget("old", "new", ["m2", "m1", "m3"]);
  assert.deepEqual(store.entries().map((entry) => [entry.target, entry.text]), [
    ["new", "ahead"], ["new", "first"], ["new", "second"],
  ]);
  await store.remove(["m2", "m1"]);
  assert.deepEqual(store.entries().map((entry) => entry.id), ["m3"]);
  assert.equal(JSON.parse(await readFile(file, "utf8")).schema, MESSAGE_QUEUE_SCHEMA);
  assert.deepEqual((await readdir(path.dirname(file))).filter((name) => name.endsWith(".tmp")), [], "atomic writes leave no temporary file");
});

test("a valid stored queue is normalized when opened", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-message-store-read-"));
  const file = path.join(root, "queue.json");
  await writeFile(file, JSON.stringify({
    schema: MESSAGE_QUEUE_SCHEMA,
    entries: [
      { id: "m1", target: "worker", from: "", area: 4, text: " hello ", banner: 0, queuedAt: "" },
      { id: "m2", target: "", text: "lost recipient" },
    ],
  }));
  const store = await openMessageQueueStore({ file });
  assert.deepEqual(store.entries(), [{
    id: "m1", target: "worker", from: "unknown sender", area: null, text: "hello", banner: true, queuedAt: null,
  }]);
});

test("delivery checkpoints preserve the accepted immutable target", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-message-store-target-"));
  /** Returns one stable fixture delivery ID. */
  const messageId = () => "m-target";
  const store = await openMessageQueueStore({ file: path.join(root, "queue.json"), id: messageId });
  await store.append("worker", {
    from: "brain",
    area: "otto/tangent",
    sourceRole: "brain",
    text: "facts",
    targetIdentity: { name: "worker", target: "$9", instanceId: "shell-1", assignment: "a1", attempt: "try-1", launchRef: "pi-code" },
  });
  await store.update("m-target", { deliveryState: "submitted" });
  const reopened = await openMessageQueueStore({ file: path.join(root, "queue.json") });
  const [entry] = reopened.entries();
  assert.equal(entry.deliveryState, "submitted", "the terminal checkpoint survives normalization and restart");
  assert.equal(entry.sourceRole, "brain");
  assert.deepEqual(entry.targetIdentity, { name: "worker", target: "$9", instanceId: "shell-1", assignment: "a1", attempt: "try-1", launchRef: "pi-code" });
});
