// Minimal IPC controller used only by gateway resilience integration tests.
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { workSemanticHash } from "./work-model.mjs";

const boot = randomUUID();
let workGeneration = 0;
const server = http.createServer((request, response) => {
  if (request.url === "/api/sessions") {
    response.writeHead(200, { "content-type": "application/json" });
    const fixtureBytes = Number(process.env.TANGENT_GATEWAY_FIXTURE_SNAPSHOT_BYTES ?? 0);
    response.end(JSON.stringify({ boot, sessions: [{ name: "durable-agent", state: "working" }], fixture: "x".repeat(fixtureBytes) }));
    return;
  }
  if (request.url === "/api/block") {
    // Deliberately reproduce an event loop that cannot serve HTTP or IPC.
    for (;;) { /* test fixture: supervisor must terminate this process */ }
  }
  if (request.url?.startsWith("/api/slow")) {
    setTimeout(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, boot }));
    }, 100);
    return;
  }
  if (request.url === "/api/change" && request.method === "POST") {
    workGeneration += 1;
    publishWork(workGeneration);
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: true, boot }));
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  process.send?.({ type: "agent-shell-ready", port: address.port, boot, instanceId: process.env.TANGENT_SHELL_INSTANCE_ID, pid: process.pid });
  publishWork();
});

/** Publishes one valid candidate through the real gateway IPC boundary. */
function publishWork(generation = workGeneration) {
  const requestedBytes = Number(process.env.TANGENT_GATEWAY_FIXTURE_WORK_BYTES ?? 0);
  const count = Math.max(1, Math.ceil(requestedBytes / 260));
  const fixedVersion = createHash("sha256").update(String(count)).digest("base64url");
  const source = { version: fixedVersion, condition: "current" };
  const jobs = { version: `${fixedVersion}-jobs-${generation}`, condition: "current" };
  const agents = { version: `${fixedVersion}-agents-${generation}`, condition: "current" };
  const observedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, generation)).toISOString();
  const activity = generation % 2 ? "waiting" : "working";
  const candidate = {
    schema: "agent-shell-work.v3",
    fence: { areas: source, goals: source, jobs, agents, brains: source, processes: source, presentations: source },
    areas: Array.from({ length: count }, (_, index) => ({ id: `area-${String(index).padStart(6, "0")}`, parentId: null, label: `Area ${index} ${"x".repeat(96)}`, state: "open", visibility: "work", presented: [], morePresentedCount: 0 })),
    goals: [{
      id: "area-000000/goal-load.md", areaId: "area-000000", parentGoalId: null, title: "Load proof", lifecycle: "open", verify: false,
      visibility: "work", rank: 0, blockers: { state: "ready", count: 0 }, startedAt: "2026-01-01T00:00:00.000Z",
      workState: { code: activity, owner: "agent", since: observedAt, evidence: "Fixture Agent" },
      execution: { run: 1, revision: generation + 1, state: "open", assignment: { id: "assignment-1", index: 1, total: 1, kind: "implementation", state: activity === "working" ? "running" : "waiting", label: "Load", instructionPreview: "Exercise the direct Work route.", launchRef: null, agentId: "agent-load", startedAt: "2026-01-01T00:00:00.000Z", endedAt: null }, counts: { total: 1, final: 0, pending: 0 } },
      presented: [], morePresentedCount: 0,
    }],
    agents: [{
      id: "agent-load", target: "$load", role: "worker", areaId: "area-000000", owner: { kind: "assignment", goalId: "area-000000/goal-load.md", run: 1, assignmentId: "assignment-1" },
      liveness: "live", activity, activityDetail: activity === "waiting" ? "idle" : "none", activitySince: observedAt, evidence: "Fixture Agent",
      observedAt, contextUsedTokens: null, cwd: null, launchRef: null, createdAt: "2026-01-01T00:00:00.000Z", workTitle: "Load proof",
    }],
    brains: [], processes: [], problems: [],
  };
  process.send?.({ type: "work-candidate", candidateId: randomUUID(), controllerBoot: boot, semanticHash: workSemanticHash(candidate), sourceWatermark: {}, candidate });
}

process.on("message", (message) => {
  if (message?.type === "work-candidate-ack" && message.ok) process.send?.({ type: "work-current", sourceWatermark: message.sourceWatermark ?? {}, observedAt: new Date().toISOString() });
});

setInterval(() => process.send?.({ type: "agent-shell-heartbeat", boot, at: Date.now() }), 25);
process.once("disconnect", () => process.exit(0));
