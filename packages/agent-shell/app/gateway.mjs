// Stable Agent Shell public edge. It owns port 4321, browser assets, SSE, and
// terminal WebSockets while a replaceable controller owns vault and workflow
// operations on an ephemeral loopback port.
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile, fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { attachTerminalTransport } from "./terminal-transport.mjs";
import { withDefaultModel } from "./agent-command.mjs";
import { sendJson } from "./http-json.mjs";
import { serveStaticAsset } from "./static-assets.mjs";
import { createStateEvents } from "./state-events.mjs";
import { startEventLoopWatchdog } from "./event-loop-watchdog.mjs";
import { agentShellInstanceId, createSessionOwnership, SESSION_OWNER_OPTION } from "./session-ownership.mjs";
import { areaMapWorldEnabled } from "./public/area-map-rollout.js";
import { createWorkStore, workResponseHeaders } from "./work-store.mjs";
import { createWorkTelemetry } from "./work-telemetry.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 4321);
const CHAT_SESSION = process.env.CHAT_SESSION ?? "orchestrator";
const AREA_MAP_WORLD_ENABLED = areaMapWorldEnabled(process.env.TANGENT_AREA_MAP_WORLD);
const WORKSPACE = process.env.WORKSPACE ?? path.join(here, "workspace");
const TREES_ROOT = process.env.TREES_ROOT ?? path.join(os.homedir(), ".tangent", "trees");
const AGENT_CMD = process.env.AGENT_CMD ?? "claude";
const INSTANCE_ID = agentShellInstanceId({
  explicit: process.env.TANGENT_SHELL_INSTANCE_ID,
  host: HOST,
  port: PORT,
  treesRoot: TREES_ROOT,
  chatSession: CHAT_SESSION,
});
const SESSION_OWNERS_ROOT = process.env.TANGENT_SESSION_OWNERS_ROOT
  ?? (process.env.TANGENT_BRAINS_ROOT
    ? path.join(path.dirname(process.env.TANGENT_BRAINS_ROOT), "session-owners")
    : path.join(os.homedir(), ".tangent", "agent-shell", "session-owners"));
const execFileAsync = promisify(execFile);
const sessionOwnership = createSessionOwnership({
  instanceId: INSTANCE_ID,
  root: SESSION_OWNERS_ROOT,
  /** Runs one gateway-owned tmux command. */
  runTmux: (args) => execFileAsync("tmux", args, { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 }),
});
const GATEWAY_BOOT_ID = randomUUID();
const CONTROLLER_ENTRY = process.env.AGENT_SHELL_CONTROLLER_ENTRY ?? path.join(here, "server.mjs");
const CONTROLLER_HEARTBEAT_TIMEOUT_MS = Number(process.env.TANGENT_CONTROLLER_HEARTBEAT_TIMEOUT_MS ?? 7_500);
const CONTROLLER_READY_TIMEOUT_MS = Number(process.env.TANGENT_CONTROLLER_READY_TIMEOUT_MS ?? 20_000);
const CONTROLLER_RESPONSE_TIMEOUT_MS = Number(process.env.TANGENT_CONTROLLER_RESPONSE_TIMEOUT_MS ?? 30_000);
const CONTROLLER_STABLE_MS = Number(process.env.TANGENT_CONTROLLER_STABLE_MS ?? 30_000);
const RESTART_BASE_MS = Number(process.env.TANGENT_CONTROLLER_RESTART_BASE_MS ?? 250);
const RESTART_MAX_MS = Number(process.env.TANGENT_CONTROLLER_RESTART_MAX_MS ?? 10_000);
const MAX_SNAPSHOT_BYTES = Number(process.env.TANGENT_GATEWAY_SNAPSHOT_MAX_BYTES ?? 32 * 1024 * 1024);
const MAX_CONTROLLER_REQUESTS = Number(process.env.TANGENT_GATEWAY_CONTROLLER_REQUESTS ?? 64);
const WORK_STORE_ROOT = process.env.TANGENT_WORK_STORE_ROOT ?? path.join(os.homedir(), ".tangent", "agent-shell", "work");
const workTelemetry = createWorkTelemetry();
const gatewayEventLoopDelay = monitorEventLoopDelay({ resolution: 10 });
gatewayEventLoopDelay.enable();
const workStore = createWorkStore({ root: WORK_STORE_ROOT, instanceId: INSTANCE_ID, hardLimit: Number(process.env.TANGENT_WORK_HARD_LIMIT_BYTES ?? 1024 * 1024), metric: workTelemetry.record });
await workStore.load();

startEventLoopWatchdog({
  timeoutMs: Number(process.env.TANGENT_GATEWAY_WATCHDOG_TIMEOUT_MS ?? 15_000),
  heartbeatMs: 1_000,
});

const stateEvents = createStateEvents();
let controller = null;
let restartAttempt = 0;
let restartTimer = null;
let shuttingDown = false;
let sessionSnapshot = null;
let activeControllerRequests = 0;
let activeWorkReaders = 0;
const activeReadPaths = new Set();

/** Returns exponential controller restart delay with a fixed upper bound. */
export function controllerRestartDelay(attempt, baseMs = RESTART_BASE_MS, maxMs = RESTART_MAX_MS) {
  return Math.min(maxMs, baseMs * (2 ** Math.min(Math.max(0, attempt), 16)));
}

/** Reports the currently supervised generation without exposing its child. */
function controllerStatus() {
  if (!controller) return { state: restartTimer ? "restarting" : "starting", pid: null, boot: null, instanceId: INSTANCE_ID };
  const heartbeatAgeMs = Date.now() - controller.lastHeartbeatAt;
  return {
    state: controller.port ? (heartbeatAgeMs > CONTROLLER_HEARTBEAT_TIMEOUT_MS ? "unresponsive" : "ready") : "starting",
    pid: controller.child.pid ?? null,
    boot: controller.boot ?? null,
    instanceId: controller.instanceId ?? INSTANCE_ID,
    heartbeatAgeMs,
    restartAttempt,
  };
}

/** Makes Work stale before a read can outpace controller failure cleanup. */
function reconcileWorkFreshnessWithController() {
  const status = controllerStatus();
  if (status.state !== "ready") workStore.markStale("controller-recovery", status.boot ?? "");
  return status;
}

/** Starts one isolated controller generation. */
function startController() {
  if (shuttingDown || controller || restartTimer) return;
  const child = fork(CONTROLLER_ENTRY, [], {
    cwd: here,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: "0",
      AGENT_SHELL_CONTROLLER: "1",
      AGENT_SHELL_GATEWAY_BOOT: GATEWAY_BOOT_ID,
      AGENT_SHELL_GATEWAY_PID: String(process.pid),
      AGENT_SHELL_NO_OPEN: "1",
      TANGENT_SHELL_INSTANCE_ID: INSTANCE_ID,
    },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  const generation = {
    child,
    port: null,
    boot: null,
    instanceId: null,
    startedAt: Date.now(),
    readyAt: null,
    lastHeartbeatAt: Date.now(),
    terminating: false,
  };
  controller = generation;
  child.on("message", (message) => {
    if (controller !== generation || !message || typeof message !== "object") return;
    if (message.type === "agent-shell-ready") {
      const childInstanceId = String(message.instanceId ?? "");
      if (childInstanceId !== INSTANCE_ID) {
        terminateController(`instance mismatch ${childInstanceId || "missing"}`);
        return;
      }
      generation.port = Number(message.port);
      generation.boot = String(message.boot ?? "");
      generation.instanceId = childInstanceId;
      generation.readyAt = Date.now();
      generation.lastHeartbeatAt = Date.now();
      console.error(`[gateway] controller ready pid=${child.pid} port=${generation.port} boot=${generation.boot}`);
      stateEvents.changed("controller-ready");
      return;
    }
    if (message.type === "agent-shell-heartbeat") generation.lastHeartbeatAt = Date.now();
    if (message.type === "work-dirty") {
      workStore.markStale("source-change-pending", generation.boot ?? "");
      return;
    }
    if (message.type === "work-current") {
      workStore.markCurrent({ controllerBoot: generation.boot ?? "", observedAt: message.observedAt });
      return;
    }
    if (message.type === "work-candidate") {
      void workStore.publish({ candidate: message.candidate, semanticHash: message.semanticHash, controllerBoot: generation.boot ?? "" }).then((result) => {
        if (controller !== generation || !generation.child.connected) return;
        const acknowledgement = { type: "work-candidate-ack", candidateId: message.candidateId, ...result, sourceWatermark: message.sourceWatermark };
        generation.child.send(acknowledgement);
        if (result.ok) {
          if (result.changed) stateEvents.changed(JSON.stringify({ type: "work", epoch: result.epoch, revision: result.revision }));
        }
      }).catch((error) => {
        console.error("[gateway] Work candidate:", error?.stack ?? error);
        if (error?.code === "work-store-fatal-after-rename") {
          process.exit(1);
          return;
        }
        if (controller === generation && generation.child.connected) generation.child.send({ type: "work-candidate-ack", candidateId: message.candidateId, ok: false, code: "store-publish-failed", sourceWatermark: message.sourceWatermark });
      });
    }
  });
  child.on("error", (error) => console.error("[gateway] controller spawn:", error?.message ?? error));
  child.on("exit", (code, signal) => {
    if (controller !== generation) return;
    controller = null;
    workStore.markStale("controller-recovery", generation.boot ?? "");
    console.error(`[gateway] controller exited pid=${child.pid} code=${code ?? ""} signal=${signal ?? ""}`);
    stateEvents.changed("controller-exited");
    scheduleControllerRestart();
  });
}

/** Schedules the next generation without permitting a tight restart loop. */
function scheduleControllerRestart() {
  if (shuttingDown || controller || restartTimer) return;
  const delay = controllerRestartDelay(restartAttempt);
  restartAttempt += 1;
  console.error(`[gateway] controller restart attempt=${restartAttempt} delayMs=${delay}`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startController();
  }, delay);
}

/** Terminates one stuck generation; its exit handler owns the restart. */
function terminateController(reason) {
  const generation = controller;
  if (!generation || generation.terminating) return;
  generation.terminating = true;
  workStore.markStale("controller-recovery", generation.boot ?? "");
  console.error(`[gateway] terminating controller pid=${generation.child.pid} reason=${reason}`);
  generation.child.kill("SIGTERM");
  const force = setTimeout(() => {
    if (controller === generation) generation.child.kill("SIGKILL");
  }, 2_000);
  force.unref();
}

// The gateway forwards every terminal byte, so a stall of its own event loop
// is a black terminal. Log each stall above a quarter second with its length
// (investigation of slow brain opens, 2026-08-28).
const LAG_TICK_MS = 250;
let lagExpectedAt = Date.now() + LAG_TICK_MS;
const lagMonitor = setInterval(() => {
  const lag = Date.now() - lagExpectedAt;
  lagExpectedAt = Date.now() + LAG_TICK_MS;
  if (lag > 250) console.error(`[gateway] event loop stalled ${lag}ms`);
}, LAG_TICK_MS);
lagMonitor.unref();

const controllerMonitor = setInterval(() => {
  if (!controller) return;
  const now = Date.now();
  if (!controller.port && now - controller.startedAt > CONTROLLER_READY_TIMEOUT_MS) {
    terminateController(`ready deadline ${CONTROLLER_READY_TIMEOUT_MS}ms`);
    return;
  }
  if (controller.port && now - controller.lastHeartbeatAt > CONTROLLER_HEARTBEAT_TIMEOUT_MS) {
    terminateController(`heartbeat deadline ${CONTROLLER_HEARTBEAT_TIMEOUT_MS}ms`);
    return;
  }
  if (controller.readyAt && now - controller.readyAt >= CONTROLLER_STABLE_MS) restartAttempt = 0;
}, Math.max(100, Math.min(1_000, Math.floor(CONTROLLER_HEARTBEAT_TIMEOUT_MS / 3))));
controllerMonitor.unref();

/** Removes hop-by-hop headers before crossing the local process boundary. */
function proxyHeaders(headers) {
  const output = { ...headers };
  for (const name of ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade", "host"]) delete output[name];
  return output;
}

/** Returns the cached session projection with explicit stale/controller facts. */
function sendSessionSnapshot(response, value, { stale, operationId }) {
  const status = controllerStatus();
  const snapshot = {
    ...value,
    runtime: {
      ...(value?.runtime ?? {}),
      gateway: { boot: GATEWAY_BOOT_ID, instanceId: INSTANCE_ID, stale, controller: status, capturedAt: sessionSnapshot?.capturedAt ?? null },
    },
  };
  response.setHeader("x-tangent-stale", stale ? "1" : "0");
  response.setHeader("x-tangent-operation-id", operationId);
  sendJson(response, 200, snapshot);
}

/** Returns cached sessions during controller recovery, or a named 503. */
function unavailable(request, response, operationId) {
  if (request.method === "GET" && request.url?.startsWith("/api/sessions") && sessionSnapshot) {
    sendSessionSnapshot(response, sessionSnapshot.value, { stale: true, operationId });
    return;
  }
  response.setHeader("retry-after", "1");
  response.setHeader("x-tangent-operation-id", operationId);
  sendJson(response, 503, { error: "Agent Shell controller is restarting; tmux sessions and terminals remain live.", operationId, controller: controllerStatus() });
}

/** Proxies one API request to the current controller with a response deadline. */
function proxyController(request, response, operationId) {
  const generation = controller;
  if (!generation?.port) {
    unavailable(request, response, operationId);
    return;
  }
  const readPath = request.method === "GET" || request.method === "HEAD" ? request.url : null;
  if (activeControllerRequests >= MAX_CONTROLLER_REQUESTS) {
    response.setHeader("retry-after", "1");
    sendJson(response, 503, { error: "Agent Shell controller request capacity is full; retry shortly.", operationId });
    return;
  }
  if (readPath && activeReadPaths.has(readPath)) {
    console.error(`[gateway] duplicate read rejected operation=${operationId} path=${readPath} active=${activeControllerRequests} reads=${activeReadPaths.size}`);
    response.setHeader("retry-after", "1");
    response.setHeader("x-tangent-operation-id", operationId);
    sendJson(response, 429, { error: "An identical Agent Shell read is already running; retry shortly.", operationId });
    return;
  }
  activeControllerRequests += 1;
  if (readPath) activeReadPaths.add(readPath);
  let admitted = true;
  /** Releases this request's total and exact-read admission once. */
  const releaseAdmission = () => {
    if (!admitted) return;
    admitted = false;
    activeControllerRequests = Math.max(0, activeControllerRequests - 1);
    if (readPath) activeReadPaths.delete(readPath);
  };
  let settled = false;
  let deadline;
  let upstream;
  let projectionError = null;
  try {
    upstream = http.request({
      host: "127.0.0.1",
      port: generation.port,
      method: request.method,
      path: request.url,
      headers: {
        ...proxyHeaders(request.headers),
        host: `127.0.0.1:${generation.port}`,
        "x-tangent-operation-id": operationId,
      },
    }, (incoming) => {
      incoming.on("error", (error) => upstream.destroy(projectionError ?? error));
      incoming.on("aborted", () => upstream.destroy(projectionError ?? new Error("controller response aborted")));
      const pathname = new URL(request.url, "http://localhost").pathname;
      const isSessions = request.method === "GET" && pathname === "/api/sessions" && incoming.statusCode === 200;
      if (!isSessions) {
        response.writeHead(incoming.statusCode ?? 502, proxyHeaders(incoming.headers));
        incoming.pipe(response);
        incoming.on("end", () => {
          settled = true;
          clearTimeout(deadline);
          releaseAdmission();
          if (request.method === "POST" && pathname !== "/api/telemetry/action" && (incoming.statusCode ?? 500) < 400 && incoming.headers["x-tangent-state-event"] !== "1") stateEvents.changed(pathname);
        });
        return;
      }
      const chunks = [];
      let bytes = 0;
      incoming.on("data", (chunk) => {
        bytes += chunk.length;
        const limit = MAX_SNAPSHOT_BYTES;
        if (bytes > limit) {
          projectionError = new Error(`session snapshot exceeds ${limit} bytes`);
          projectionError.code = "session-snapshot-too-large";
          incoming.destroy(projectionError);
          return;
        }
        chunks.push(chunk);
      });
      incoming.on("end", () => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        releaseAdmission();
        try {
          const parseStartedAt = Date.now();
          const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          sessionSnapshot = { value, capturedAt: new Date().toISOString() };
          sendSessionSnapshot(response, value, { stale: false, operationId });
          const snapshotMs = Date.now() - parseStartedAt;
          // The parse and re-serialize of this payload run on the loop that
          // carries terminal bytes; a slow one is logged with its size.
          if (snapshotMs > 100) console.error(`[gateway] session snapshot ${snapshotMs}ms bytes=${bytes} pipelines=${value?.pipelines?.length ?? 0}`);
        } catch (error) {
          console.error("[gateway] session snapshot:", error?.message ?? error);
          unavailable(request, response, operationId);
        }
      });
    });
  } catch (error) {
    releaseAdmission();
    throw error;
  }
  deadline = setTimeout(() => upstream.destroy(new Error(`controller response deadline ${CONTROLLER_RESPONSE_TIMEOUT_MS}ms`)), CONTROLLER_RESPONSE_TIMEOUT_MS);
  deadline.unref();
  upstream.once("close", releaseAdmission);
  upstream.on("error", (error) => {
    clearTimeout(deadline);
    releaseAdmission();
    if (settled) return;
    settled = true;
    console.error(`[gateway] ${request.method} ${request.url} operation=${operationId}:`, error?.message ?? error);
    if (!response.headersSent) unavailable(request, response, operationId);
    else response.destroy(error);
  });
  request.on("aborted", () => upstream.destroy());
  response.on("close", () => {
    if (!settled) upstream.destroy();
  });
  request.pipe(upstream);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  const operationId = String(request.headers["x-tangent-operation-id"] ?? randomUUID()).slice(0, 128);
  response.setHeader("x-tangent-operation-id", operationId);
  try {
    if (request.method === "GET" && url.pathname === "/api/work") {
      const startedAt = performance.now();
      reconcileWorkFreshnessWithController();
      activeWorkReaders += 1;
      workTelemetry.record("work_reader_count", activeWorkReaders);
      response.once("close", () => {
        activeWorkReaders = Math.max(0, activeWorkReaders - 1);
        workTelemetry.record("work_reader_count", activeWorkReaders);
      });
      const snapshot = workStore.current();
      if (!snapshot) {
        response.setHeader("retry-after", "1");
        sendJson(response, 503, { error: "Work is not ready.", code: "work-not-ready", operationId });
        workTelemetry.record("work_serve_ms", performance.now() - startedAt, { status: 503 });
        return;
      }
      const headers = { ...workResponseHeaders(workStore, { gatewayBoot: GATEWAY_BOOT_ID }), "x-tangent-operation-id": operationId };
      if (request.headers["if-none-match"] === snapshot.etag) {
        response.writeHead(304, headers);
        response.end();
        workTelemetry.record("work_serve_ms", performance.now() - startedAt, { status: 304 });
        return;
      }
      response.writeHead(200, { ...headers, "content-type": "application/json", "content-length": snapshot.body.length });
      response.end(snapshot.body);
      workTelemetry.record("work_serve_ms", performance.now() - startedAt, { status: 200 });
      if (workStore.metadata().state !== "current") workTelemetry.record("work_stale_serve_total", 1, { reason: workStore.metadata().reason || "degraded" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
      const controllerHealth = reconcileWorkFreshnessWithController();
      sendJson(response, 200, {
        ok: true,
        service: "tangent-agent-shell-gateway",
        role: "gateway",
        boot: GATEWAY_BOOT_ID,
        instanceId: INSTANCE_ID,
        pid: process.pid,
        controller: controllerHealth,
        sessions: { cached: Boolean(sessionSnapshot), capturedAt: sessionSnapshot?.capturedAt ?? null },
        work: { ...workStore.health(), reconciliation: controller?.port ? "controller-running" : "controller-unavailable", metrics: workTelemetry.snapshot() },
        eventLoopDelayMs: {
          mean: Number.isFinite(gatewayEventLoopDelay.mean) ? gatewayEventLoopDelay.mean / 1e6 : 0,
          p95: gatewayEventLoopDelay.percentile(95) / 1e6,
          max: gatewayEventLoopDelay.max / 1e6,
        },
        proxy: { active: activeControllerRequests, limit: MAX_CONTROLLER_REQUESTS, reads: activeReadPaths.size },
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/events") {
      stateEvents.connect(request, response);
      return;
    }
    if (request.method === "GET" && url.pathname === "/config.js") {
      response.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-cache" });
      response.end(`window.CHAT_SESSION = ${JSON.stringify(CHAT_SESSION)};\nwindow.TANGENT_FEATURES = ${JSON.stringify({ areaMapWorld: AREA_MAP_WORLD_ENABLED })};\nwindow.TANGENT_WORK = ${JSON.stringify({ instanceId: INSTANCE_ID, schema: "agent-shell-work.v3", rollout: "v3" })};\n`);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      proxyController(request, response, operationId);
      return;
    }
    await serveStaticAsset(url, response, here);
  } catch (error) {
    console.error(`[gateway] request ${request.method} ${url.pathname}:`, error?.stack ?? error);
    if (!response.headersSent) sendJson(response, 500, { error: "Agent Shell gateway could not complete the request.", operationId });
    else response.end();
  }
});

server.headersTimeout = Number(process.env.TANGENT_HTTP_HEADERS_TIMEOUT_MS ?? 10_000);
server.requestTimeout = Number(process.env.TANGENT_HTTP_REQUEST_TIMEOUT_MS ?? 30_000);
server.keepAliveTimeout = Number(process.env.TANGENT_HTTP_KEEPALIVE_TIMEOUT_MS ?? 5_000);
server.maxRequestsPerSocket = Number(process.env.TANGENT_HTTP_MAX_REQUESTS_PER_SOCKET ?? 1_000);
server.on("clientError", (error, socket) => {
  console.error("[gateway] client error:", error?.code ?? error?.message ?? error);
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});

const terminalTransport = attachTerminalTransport(server, {
  port: PORT,
  workspace: WORKSPACE,
  chatSession: CHAT_SESSION,
  chatCommand: withDefaultModel(AGENT_CMD),
  maxConnections: Number(process.env.TANGENT_TERMINAL_MAX_CONNECTIONS ?? 128),
  /** Creates or authorizes only this gateway's tmux sessions. */
  async prepareSession({ session, chat, workspace, chatCommand }) {
    const inspected = await sessionOwnership.inspect(session);
    if (inspected.state === "live") {
      if (inspected.instanceId === INSTANCE_ID) return;
      const owner = inspected.instanceId || `legacy session without ${SESSION_OWNER_OPTION}`;
      throw new Error(`session ${session} belongs to ${owner}`);
    }
    if (inspected.state === "error") throw inspected.error;
    if (!chat) throw new Error(`no live session ${session}`);
    const shell = process.env.SHELL ?? "/bin/zsh";
    const command = `exec ${shell} -ic '${chatCommand.replace(/'/g, "'\\''")}'`;
    const created = await execFileAsync("tmux", ["new-session", "-P", "-F", "#{session_id}", "-d", "-s", session, "-c", workspace, command]);
    const target = String(created.stdout ?? "").trim();
    if (!target) throw new Error(`tmux returned no immutable session ID for ${session}`);
    try {
      await sessionOwnership.claim(session, target);
    } catch (error) {
      await sessionOwnership.terminate(session).catch(() => {});
      throw error;
    }
  },
});

/** Stops only shell processes; durable tmux sessions remain untouched. */
function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`[gateway] shutdown signal=${signal}`);
  clearInterval(controllerMonitor);
  gatewayEventLoopDelay.disable();
  clearTimeout(restartTimer);
  restartTimer = null;
  if (controller) controller.child.kill("SIGTERM");
  stateEvents.close();
  terminalTransport.close();
  server.close(() => process.exit(exitCode));
  const force = setTimeout(() => process.exit(exitCode), 2_000);
  force.unref();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGUSR2", () => shutdown("SIGUSR2", 75));

server.on("error", async (error) => {
  console.error("[gateway] listener:", error?.code ?? error?.message ?? error);
  if (error?.code === "EADDRINUSE") {
    // A launcher race has one winner. Exit this candidate instead of retrying
    // the same occupied public port in a child loop.
    let validOwner = false;
    try {
      const response = await fetch(`http://${HOST}:${PORT}/api/health`, { signal: AbortSignal.timeout(1_000) });
      const health = await response.json();
      validOwner = response.ok && health?.service === "tangent-agent-shell-gateway";
    } catch {}
    process.exit(validOwner ? 0 : 75);
  } else {
    process.exit(1);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`agent-shell gateway: http://${HOST}:${PORT} instance=${INSTANCE_ID}`);
  startController();
  if (!process.env.AGENT_SHELL_NO_OPEN) {
    execFile("open", ["-a", "Agent Shell"], (error) => {
      if (error) console.log(`  open http://localhost:${PORT} in a browser (or set AGENT_SHELL_NO_OPEN=1).`);
    });
  }
});
