import assert from "node:assert/strict";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
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
      ...environment,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (chunk) => errors.push(chunk.toString()));
  context.after(async () => {
    if (child.exitCode === null) child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 2500))]);
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

test("gateway caches compact Work as opaque bytes across controller recovery", async (context) => {
  let port;
  try {
    port = await freePort();
  } catch (error) {
    if (error?.code === "EPERM") return context.skip("local listeners are not permitted");
    throw error;
  }
  await startGateway(context, port, { TANGENT_GATEWAY_FIXTURE_WORK_BYTES: "1024" });
  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(base, (health) => health.controller.state === "ready");
  const first = await fetch(`${base}/api/work`);
  const body = await first.text();
  assert.equal(first.headers.get("x-tangent-stale"), "0");
  assert.match(body, /agent-shell-work\.v1/);

  void fetch(`${base}/api/block`, { method: "POST" }).catch(() => {});
  await waitForHealth(base, (health) => health.controller.state !== "ready");
  const cached = await fetch(`${base}/api/work`);
  assert.equal(cached.status, 200);
  assert.equal(cached.headers.get("x-tangent-stale"), "1");
  assert.equal(await cached.text(), body);
});

test("gateway names an oversized Work projection without reporting a restart", async (context) => {
  let port;
  try {
    port = await freePort();
  } catch (error) {
    if (error?.code === "EPERM") return context.skip("local listeners are not permitted");
    throw error;
  }
  await startGateway(context, port, {
    TANGENT_GATEWAY_WORK_MAX_BYTES: "512",
    TANGENT_GATEWAY_FIXTURE_WORK_BYTES: "1024",
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(base, (health) => health.controller.state === "ready");
  const response = await fetch(`${base}/api/work`);
  assert.equal(response.status, 502);
  const problem = await response.json();
  assert.equal(problem.code, "work-projection-too-large");
  assert.doesNotMatch(problem.error, /restart/i);
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
  await waitForHealth(base, (health) => health.controller.state === "ready");

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
  assert.equal(stayedQuiet, true, "telemetry must not invalidate the projection that produced it");

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
