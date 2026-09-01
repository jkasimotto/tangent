import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createWorkStore } from "./work-store.mjs";
import { WORK_SCHEMA, workSemanticHash } from "./work-model.mjs";

/** Creates one valid store candidate. */
function candidate(label = "Otto") {
  const source = { version: "v", condition: "current" };
  return {
    schema: WORK_SCHEMA,
    fence: { areas: source, goals: source, jobs: source, agents: source, brains: source, processes: source, presentations: source },
    areas: [{ id: "otto", parentId: null, label, state: "open", visibility: "work", presented: [], morePresentedCount: 0 }],
    goals: [], agents: [], brains: [], processes: [], problems: [],
  };
}

test("the Work store persists before publication and retains epoch on restart", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-work-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = createWorkStore({ root, instanceId: "test" });
  assert.equal((await first.load()).state, "missing");
  const initial = candidate();
  const published = await first.publish({ candidate: initial, semanticHash: workSemanticHash(initial), controllerBoot: "controller-1" });
  assert.equal(published.ok, true);
  assert.equal(published.revision, 1);
  assert.ok((await readFile(first.file, "utf8")).includes("agent-shell-work-store.v1"));

  const second = createWorkStore({ root, instanceId: "test" });
  assert.equal((await second.load()).state, "loaded");
  assert.equal(second.current().epoch, first.current().epoch);
  assert.equal(second.current().revision, 1);
  assert.deepEqual(second.current().body, first.current().body);
});

test("equal candidates do not create revisions", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-work-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createWorkStore({ root, instanceId: "test" });
  const value = candidate();
  await store.publish({ candidate: value, semanticHash: workSemanticHash(value), controllerBoot: "one" });
  const equal = await store.publish({ candidate: value, semanticHash: workSemanticHash(value), controllerBoot: "two" });
  assert.equal(equal.changed, false);
  assert.equal(store.current().revision, 1);
  assert.equal(store.metadata().controllerBoot, "two");
});

test("invalid and oversized candidates retain the complete prior revision", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-work-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createWorkStore({ root, instanceId: "test", hardLimit: 2_000 });
  const value = candidate();
  await store.publish({ candidate: value, semanticHash: workSemanticHash(value), controllerBoot: "one" });
  const before = store.current();
  const invalid = { ...value, areas: [{ ...value.areas[0], label: "x".repeat(161) }] };
  assert.equal((await store.publish({ candidate: invalid, semanticHash: workSemanticHash(invalid), controllerBoot: "two" })).ok, false);
  const oversized = { ...value, problems: [{ code: "source-record-invalid", source: "goals", count: 1, sampleIds: ["x".repeat(512)] }], areas: [{ ...value.areas[0], label: "L".repeat(160) }] };
  assert.equal((await store.publish({ candidate: oversized, semanticHash: workSemanticHash(oversized), controllerBoot: "two" })).ok, false);
  assert.equal(store.current(), before);
});

test("a corrupt envelope is quarantined and starts a new epoch", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-work-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createWorkStore({ root, instanceId: "test" });
  await writeFile(store.file, "not json\n").catch(async () => { await import("node:fs/promises").then(({ mkdir }) => mkdir(root, { recursive: true })); await writeFile(store.file, "not json\n"); });
  const loaded = await store.load();
  assert.equal(loaded.state, "corrupt");
  const value = candidate();
  const published = await store.publish({ candidate: value, semanticHash: workSemanticHash(value), controllerBoot: "one" });
  assert.equal(published.revision, 1);
});

test("publication crash points always reload one complete revision", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-work-crash-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const baseline = createWorkStore({ root, instanceId: "crash" });
  const first = candidate("one");
  await baseline.publish({ candidate: first, semanticHash: workSemanticHash(first), controllerBoot: "one" });

  const fileSyncFailure = createWorkStore({ root, instanceId: "crash", fs: {
    mkdir, readFile, rename,
    /** Injects a temporary-file sync failure. */
    async open(file, flags, mode) {
      const handle = await open(file, flags, mode);
      if (!String(file).endsWith(".tmp")) return handle;
      return { writeFile: handle.writeFile.bind(handle), close: handle.close.bind(handle),
        /** Fails the temporary-file sync point. */
        async sync() { throw new Error("file sync crash"); },
      };
    },
  } });
  await fileSyncFailure.load();
  const second = candidate("two");
  assert.equal((await fileSyncFailure.publish({ candidate: second, semanticHash: workSemanticHash(second), controllerBoot: "two" })).ok, false);
  const afterFileSync = createWorkStore({ root, instanceId: "crash" });
  await afterFileSync.load();
  assert.equal(afterFileSync.current().revision, 1);

  const afterRename = createWorkStore({ root, instanceId: "crash",
    /** Fails the memory-swap point. */
    swap() { throw new Error("memory swap crash"); },
    /** Returns the fatal classification to the test. */
    fatal: (error) => ({ fatal: error.code }),
  });
  await afterRename.load();
  const result = await afterRename.publish({ candidate: second, semanticHash: workSemanticHash(second), controllerBoot: "two" });
  assert.equal(result.fatal, "work-store-fatal-after-rename");
  assert.equal(afterRename.current().revision, 1, "the in-process Buffer did not swap");
  const restarted = createWorkStore({ root, instanceId: "crash" });
  await restarted.load();
  assert.equal(restarted.current().revision, 2, "restart loads the complete renamed envelope");
  assert.equal(restarted.current().value.areas[0].label, "two");
});
