import assert from "node:assert/strict";
import test from "node:test";
import { createWorkClient } from "./public/work-client.js";

/** Creates one valid empty Work snapshot. */
function snapshot(revision = 1, epoch = "epoch-1") {
  const source = { version: "v", condition: "current" };
  return { schema: "agent-shell-work.v3", epoch, revision, publishedAt: "2026-09-01T00:00:00.000Z", fence: { areas: source, goals: source, jobs: source, agents: source, brains: source, processes: source, presentations: source }, areas: [], goals: [], agents: [], brains: [], processes: [], problems: [] };
}
/** Creates one Work HTTP response. */
function response(value, { status = 200, state = "current", etag = '"work-1"' } = {}) {
  const body = status === 304 ? "" : JSON.stringify(value);
  return new Response(body || null, { status, headers: { etag, "content-type": "application/json", "content-length": String(body.length), "x-tangent-work-state": state, "x-tangent-work-epoch": value?.epoch ?? "epoch-1", "x-tangent-work-revision": String(value?.revision ?? 1), "x-tangent-work-published-at": value?.publishedAt ?? "", "x-tangent-work-observed-at": "2026-09-01T00:00:01.000Z", "x-tangent-gateway-boot": "gateway", "x-tangent-controller-boot": "controller" } });
}
/** Creates an in-memory session-storage fixture. */
function memorySession() {
  const values = new Map();
  return {
    /** Reads one cached value. */
    getItem: (key) => values.get(key) ?? null,
    /** Saves one cached value. */
    setItem: (key, value) => values.set(key, value),
  };
}

test("a stale 304 updates metadata and retains snapshot identity", async () => {
  const calls = [];
  const session = memorySession();
  const client = createWorkClient({
    session, config: { instanceId: "test", schema: "agent-shell-work.v3", rollout: "v3" },
    /** Returns a changed response and then a stale 304. */
    fetchImpl: async (_path, options) => {
      calls.push(options);
      return calls.length === 1 ? response(snapshot()) : response(snapshot(), { status: 304, state: "stale" });
    },
  });
  const first = await client.read();
  const second = await client.read();
  assert.equal(second.snapshot, first.snapshot);
  assert.equal(second.metadata.state, "stale");
  assert.equal(calls[1].headers["if-none-match"], '"work-1"');
});

test("a refresh error retains the last valid snapshot", async () => {
  let fails = false;
  const client = createWorkClient({ session: memorySession(), config: { instanceId: "test", schema: "agent-shell-work.v3", rollout: "v3" },
    /** Injects a transport failure after the first response. */
    fetchImpl: async () => { if (fails) throw new TypeError("offline"); return response(snapshot()); },
  });
  await client.read();
  fails = true;
  await assert.rejects(client.read(), (error) => error.retained?.revision === 1);
  assert.equal(client.state().snapshot.revision, 1);
});

test("the browser cache hydrates only the matching instance and rollout", async () => {
  const session = memorySession();
  const config = { instanceId: "one", schema: "agent-shell-work.v3", rollout: "v3" };
  const first = createWorkClient({ session, config,
    /** Returns one cacheable snapshot. */
    fetchImpl: async () => response(snapshot()),
  });
  await first.read();
  assert.equal(createWorkClient({ session, config }).hydrate().snapshot.revision, 1);
  assert.equal(createWorkClient({ session, config: { ...config, instanceId: "two" } }).hydrate(), null);
  assert.equal(createWorkClient({ session, config: { ...config, rollout: "other" } }).hydrate(), null);
});

test("one active Work read keeps only one trailing request", async () => {
  let release;
  let calls = 0;
  const client = createWorkClient({ session: memorySession(), config: { instanceId: "test" },
    /** Holds the first Work read open. */
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) await new Promise((resolve) => { release = resolve; });
      return response(snapshot(calls));
    },
  });
  const first = client.read();
  await Promise.resolve();
  const second = client.read();
  const third = client.read();
  assert.equal(calls, 1);
  release();
  await Promise.all([first, second, third]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 2);
});
