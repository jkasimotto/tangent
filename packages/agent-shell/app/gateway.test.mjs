import assert from "node:assert/strict";
import { once } from "node:events";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Reserves one loopback port for a gateway fixture. */
async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

/** Polls gateway health until its predicate holds. */
async function waitForHealth(base, predicate, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      const health = await response.json();
      if (response.ok && predicate(health)) return health;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("gateway health condition was not reached");
}

/** Starts the gateway with a deliberately controllable IPC child. */
async function startGateway(context, port, environment = {}) {
  const errors = [];
  const workRoot = await mkdtemp(path.join(os.tmpdir(), "tangent-gateway-work-"));
  const child = spawn(process.execPath, ["gateway.mjs"], {
    cwd: here,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      AGENT_SHELL_NO_OPEN: "1",
      AGENT_SHELL_CONTROLLER_ENTRY: path.join(here, "gateway-fixture-controller.mjs"),
      TANGENT_CONTROLLER_HEARTBEAT_TIMEOUT_MS: "300",
      TANGENT_CONTROLLER_READY_TIMEOUT_MS: "1000",
      TANGENT_CONTROLLER_RESPONSE_TIMEOUT_MS: "3000",
      TANGENT_CONTROLLER_RESTART_BASE_MS: "20",
      TANGENT_CONTROLLER_RESTART_MAX_MS: "100",
      TANGENT_CONTROLLER_STABLE_MS: "100",
      TANGENT_GATEWAY_WATCHDOG_TIMEOUT_MS: "3000",
      CHAT_SESSION: `gateway-test-${process.pid}`,
      TANGENT_WORK_STORE_ROOT: workRoot,
      ...environment,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (chunk) => errors.push(chunk.toString()));
  context.after(async () => {
    if (child.exitCode === null) child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 2500))]);
    await rm(workRoot, { recursive: true, force: true });
  });
  child.once("exit", (code, signal) => {
    if (code) errors.push(`gateway exited ${code}/${signal ?? ""}`);
  });
  return { child, errors };
}

test("gateway keeps health and cached sessions available across a stuck controller", async (context) => {
  let port;
  try {
    port = await freePort();
  } catch (error) {
    if (error?.code === "EPERM") return context.skip("local listeners are not permitted");
    throw error;
  }
  const gateway = await startGateway(context, port);
  const base = `http://127.0.0.1:${port}`;
  const first = await waitForHealth(base, (health) => health.controller.state === "ready");
  const initialSessions = await fetch(`${base}/api/sessions`);
  assert.equal(initialSessions.headers.get("x-tangent-stale"), "0");
  assert.equal((await initialSessions.json()).sessions[0].name, "durable-agent");

  const blockedMutation = fetch(`${base}/api/block`, { method: "POST" }).catch((error) => error);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const responsiveHealth = await Promise.race([
    fetch(`${base}/api/health`).then((response) => response.json()),
    new Promise((_, reject) => setTimeout(() => reject(new Error("gateway health blocked with controller")), 500)),
  ]);
  assert.equal(responsiveHealth.boot, first.boot);

  const staleSessions = await fetch(`${base}/api/sessions`);
  assert.equal(staleSessions.status, 200);
  assert.equal(staleSessions.headers.get("x-tangent-stale"), "1");
  assert.equal((await staleSessions.json()).sessions[0].name, "durable-agent");

  const replacement = await waitForHealth(base, (health) => health.controller.state === "ready" && health.controller.boot !== first.controller.boot);
  assert.equal(replacement.boot, first.boot, "the public gateway generation stays alive");
  const mutationResult = await blockedMutation;
  if (mutationResult instanceof Response) assert.equal(mutationResult.status, 503);
  assert.match(gateway.errors.join(""), /terminating controller/);
});

test("gateway accepts a complete session snapshot above the old 8 MiB limit", async (context) => {
  let port;
  try {
    port = await freePort();
  } catch (error) {
    if (error?.code === "EPERM") return context.skip("local listeners are not permitted");
    throw error;
  }
  await startGateway(context, port, { TANGENT_GATEWAY_FIXTURE_SNAPSHOT_BYTES: String(9 * 1024 * 1024) });
  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(base, (health) => health.controller.state === "ready");

  const response = await fetch(`${base}/api/sessions`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-tangent-stale"), "0");
  const snapshot = await response.json();
  assert.equal(snapshot.sessions[0].name, "durable-agent");
  assert.equal(snapshot.fixture.length, 9 * 1024 * 1024);
});

test("gateway serves persisted Work bytes across controller recovery", async (context) => {
  let port;
  try {
    port = await freePort();
  } catch (error) {
    if (error?.code === "EPERM") return context.skip("local listeners are not permitted");
    throw error;
  }
  await startGateway(context, port, {
    TANGENT_GATEWAY_FIXTURE_WORK_BYTES: "1024",
    TANGENT_CONTROLLER_RESTART_BASE_MS: "1000",
    TANGENT_CONTROLLER_RESTART_MAX_MS: "1000",
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(base, (health) => health.controller.state === "ready" && health.work.revision === 1);
  const first = await fetch(`${base}/api/work`);
  const body = await first.text();
  assert.equal(first.headers.get("x-tangent-work-state"), "current");
  assert.match(body, /agent-shell-work\.v3/);

  void fetch(`${base}/api/block`, { method: "POST" }).catch(() => {});
  await waitForHealth(base, (health) => health.controller.state !== "ready");
  const cached = await fetch(`${base}/api/work`);
  assert.equal(cached.status, 200);
  assert.equal(cached.headers.get("x-tangent-work-state"), "stale");
  assert.equal(await cached.text(), body);
});

test("gateway keeps a supported Work fixture below the hard payload limit", async (context) => {
  let port;
  try {
    port = await freePort();
  } catch (error) {
    if (error?.code === "EPERM") return context.skip("local listeners are not permitted");
    throw error;
  }
  await startGateway(context, port, { TANGENT_GATEWAY_FIXTURE_WORK_BYTES: String(300 * 1024) });
  const base = `http://127.0.0.1:${port}`;
  const health = await waitForHealth(base, (value) => value.controller.state === "ready" && value.work.revision === 1);

  const response = await fetch(`${base}/api/work`);
  assert.equal(response.status, 200);
  const work = await response.json();
  assert.equal(work.schema, "agent-shell-work.v3");
  assert.ok(health.work.bytes <= 1024 * 1024);
});

test("gateway rejects an oversized candidate and reports Work not ready", async (context) => {
  let port;
  try {
    port = await freePort();
  } catch (error) {
    if (error?.code === "EPERM") return context.skip("local listeners are not permitted");
    throw error;
  }
  await startGateway(context, port, {
    TANGENT_WORK_HARD_LIMIT_BYTES: "512",
    TANGENT_GATEWAY_FIXTURE_WORK_BYTES: "1024",
  });
  const base = `http://127.0.0.1:${port}`;
  const health = await waitForHealth(base, (value) => value.controller.state === "ready" && value.work.lastRejection);
  const response = await fetch(`${base}/api/work`);
  assert.equal(response.status, 503);
  const problem = await response.json();
  assert.equal(problem.code, "work-not-ready");
  assert.equal(health.work.lastRejection.code, "candidate-too-large");
});

test("one hundred concurrent Work reads bypass controller admission", async (context) => {
  let port;
  try { port = await freePort(); }
  catch (error) { if (error?.code === "EPERM") return context.skip("local listeners are not permitted"); throw error; }
  await startGateway(context, port);
  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(base, (health) => health.work.revision === 1);
  const responses = await Promise.all(Array.from({ length: 100 }, () => fetch(`${base}/api/work`)));
  assert.deepEqual([...new Set(responses.map((response) => response.status))], [200]);
  const health = await fetch(`${base}/api/health`).then((response) => response.json());
  assert.equal(health.proxy.active, 0);
  assert.equal(health.proxy.reads, 0);
});

test("one hundred Work clients sustain direct reads while Jobs and Agents change", { timeout: 90_000 }, async (context) => {
  const seconds = Number(process.env.TANGENT_WORK_LOAD_SECONDS ?? 0);
  if (!seconds) return context.skip("set TANGENT_WORK_LOAD_SECONDS to run the sustained proof");
  let port;
  try { port = await freePort(); }
  catch (error) { if (error?.code === "EPERM") return context.skip("local listeners are not permitted"); throw error; }
  await startGateway(context, port);
  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(base, (health) => health.work.revision === 1 && health.work.state === "current");
  const deadline = performance.now() + seconds * 1_000;
  const latencies = [];
  const statuses = new Map();
  let etag = null;
  let heartbeatAgeMax = 0;
  const mutations = setInterval(() => { void fetch(`${base}/api/change`, { method: "POST" }); }, 500);
  const healthSamples = setInterval(() => {
    void fetch(`${base}/api/health`).then((response) => response.json()).then((health) => {
      heartbeatAgeMax = Math.max(heartbeatAgeMax, health.controller.heartbeatAgeMs ?? 0);
    });
  }, 100);
  await Promise.all(Array.from({ length: 100 }, async (_, clientIndex) => {
    await new Promise((resolve) => setTimeout(resolve, clientIndex * 5));
    while (performance.now() < deadline) {
      const startedAt = performance.now();
      const response = await fetch(`${base}/api/work`, { headers: etag ? { "if-none-match": etag } : {} });
      latencies.push(performance.now() - startedAt);
      statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
      etag = response.headers.get("etag") ?? etag;
      await response.arrayBuffer();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }));
  clearInterval(mutations);
  clearInterval(healthSamples);
  const health = await fetch(`${base}/api/health`).then((response) => response.json());
  const sorted = latencies.sort((left, right) => left - right);
  /** Returns one end-to-end client latency percentile. */
  const percentile = (value) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))];
  const evidence = {
    clients: 100, seconds, responses: latencies.length, statuses: Object.fromEntries(statuses), bytes: health.work.bytes,
    latencyMs: { p50: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1) },
    eventLoopDelayMs: health.eventLoopDelayMs, controllerHeartbeatAgeMaxMs: heartbeatAgeMax,
    gatewayServeMs: health.work.metrics.timings,
  };
  context.diagnostic(JSON.stringify(evidence));
  assert.equal(statuses.get(429) ?? 0, 0);
  assert.deepEqual([...statuses.keys()].sort(), [200, 304]);
  const serveRows = Object.entries(evidence.gatewayServeMs).filter(([name]) => name.startsWith("work_serve_ms"));
  assert.ok(serveRows.every(([, row]) => row.p95 <= 20), `gateway p95 exceeded 20ms: ${JSON.stringify(serveRows)}`);
  assert.ok(serveRows.every(([, row]) => row.max <= 100), `gateway maximum exceeded 100ms: ${JSON.stringify(serveRows)}`);
});

test("gateway rejects duplicate reads while one controller request is active", async (context) => {
  let port;
  try {
    port = await freePort();
  } catch (error) {
    if (error?.code === "EPERM") return context.skip("local listeners are not permitted");
    throw error;
  }
  const gateway = await startGateway(context, port);
  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(base, (health) => health.controller.state === "ready");

  const first = fetch(`${base}/api/slow`);
  await waitForHealth(base, (health) => health.proxy.active === 1 && health.proxy.reads === 1);
  const duplicate = await fetch(`${base}/api/slow`);
  assert.equal(duplicate.status, 429);
  assert.equal(duplicate.headers.get("retry-after"), "1");
  assert.ok(duplicate.headers.get("x-tangent-operation-id"));
  assert.match((await duplicate.json()).error, /already running/);
  assert.equal((await first).status, 200);
  await waitForHealth(base, (health) => health.proxy.active === 0 && health.proxy.reads === 0);
  assert.equal((await fetch(`${base}/api/slow`)).status, 200, "admission is released after completion");
  assert.match(gateway.errors.join(""), /duplicate read rejected .*path=\/api\/slow .*active=1 reads=1/);
});

test("gateway rejects controller work above its configured capacity", async (context) => {
  let port;
  try {
    port = await freePort();
  } catch (error) {
    if (error?.code === "EPERM") return context.skip("local listeners are not permitted");
    throw error;
  }
  await startGateway(context, port, { TANGENT_GATEWAY_CONTROLLER_REQUESTS: "2" });
  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(base, (health) => health.controller.state === "ready");

  const first = fetch(`${base}/api/slow?request=1`);
  const second = fetch(`${base}/api/slow?request=2`);
  await waitForHealth(base, (health) => health.proxy.active === 2);
  const excess = await fetch(`${base}/api/slow?request=3`);
  assert.equal(excess.status, 503);
  assert.equal(excess.headers.get("retry-after"), "1");
  assert.match((await excess.json()).error, /capacity is full/);
  assert.deepEqual(await Promise.all([first.then((response) => response.status), second.then((response) => response.status)]), [200, 200]);
  await waitForHealth(base, (health) => health.proxy.active === 0);
  assert.equal((await fetch(`${base}/api/slow?request=4`)).status, 200, "capacity is released after completion");
});

test("gateway telemetry does not create a browser refresh feedback loop", async (context) => {
  let port;
  try {
    port = await freePort();
  } catch (error) {
    if (error?.code === "EPERM") return context.skip("local listeners are not permitted");
    throw error;
  }
  await startGateway(context, port);
  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(base, (health) => health.controller.state === "ready" && health.work.revision === 1 && health.work.state === "current");

  const events = await fetch(`${base}/api/events`);
  const reader = events.body.getReader();
  const decoder = new TextDecoder();
  assert.match(decoder.decode((await reader.read()).value), /event: ready/);
  const nextEvent = reader.read();
  assert.equal((await fetch(`${base}/api/telemetry/action`, { method: "POST" })).status, 200);
  const stayedQuiet = await Promise.race([
    nextEvent.then(() => false),
    new Promise((resolve) => setTimeout(() => resolve(true), 100)),
  ]);
  assert.equal(stayedQuiet, true, "telemetry must not invalidate the Work snapshot that produced it");

  assert.equal((await fetch(`${base}/api/change`, { method: "POST" })).status, 200);
  const changed = await Promise.race([
    nextEvent,
    new Promise((_, reject) => setTimeout(() => reject(new Error("mutation invalidation was not delivered")), 1000)),
  ]);
  assert.match(decoder.decode(changed.value), /event: changed/);
  await reader.cancel();
});

test("a second gateway exits instead of competing for the public port", async (context) => {
  let port;
  try {
    port = await freePort();
  } catch (error) {
    if (error?.code === "EPERM") return context.skip("local listeners are not permitted");
    throw error;
  }
  await startGateway(context, port);
  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(base, (health) => health.controller.state === "ready");
  const second = spawn(process.execPath, ["gateway.mjs"], {
    cwd: here,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), AGENT_SHELL_NO_OPEN: "1" },
    stdio: "ignore",
  });
  const exited = await Promise.race([
    once(second, "exit"),
    new Promise((_, reject) => setTimeout(() => reject(new Error("competing gateway did not exit")), 1500)),
  ]);
  assert.equal(exited[0], 0);
  assert.equal((await fetch(`${base}/api/health`).then((response) => response.json())).service, "tangent-agent-shell-gateway");
});
