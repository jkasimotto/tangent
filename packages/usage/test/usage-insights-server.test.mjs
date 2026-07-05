import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createUsageUiApp } from "../dist/server/index.js";
import { buildInsightsResponse } from "../dist/server/insights.js";

/** Builds a minimal NormalizedToolCall fixture. */
function toolCall(id, category, durationMs, overrides = {}) {
  return { id, name: "Tool", category, targetPaths: [], evidenceEventIds: [], result: { status: "success", durationMs }, ...overrides };
}

/** Builds a minimal assistant NormalizedConversationMessage fixture with the given tool calls. */
function assistantMessage(id, toolCalls) {
  return { id, role: "assistant", text: "", toolCalls, confidence: "exact" };
}

/** Builds a minimal NormalizedConversation fixture from a list of assistant messages. */
function conversation(conversationId, messages, repo = "/repo/polez") {
  return {
    schema: "usage.conversation.v1",
    provider: "claude",
    conversationId,
    providerSessionId: conversationId,
    repo: { root: repo },
    messages,
    totals: { userMessages: 0, assistantMessages: messages.length, toolCalls: 0 },
    caveats: []
  };
}

const scope = { repo: ".", scope: "all", parkStatePath: "/dev/null/unused-in-these-tests" };

test("buildInsightsResponse assembles the distribution header and ranks findings by cost", () => {
  const convo = conversation("conv-1", [
    assistantMessage("m1", [
      toolCall("r1", "read", 40_000),
      toolCall("s1", "search", 30_000),
      toolCall("c1", "command", 20_000)
    ])
  ]);
  const response = buildInsightsResponse([convo], {}, scope, 30, { includeParked: false });
  assert.equal(response.scopeLabel, "all projects");
  assert.equal(response.windowDays, 30);
  assert.equal(response.totalMs, 90_000);
  const findingInfo = response.categories.find((category) => category.key === "findingInfo");
  assert.equal(findingInfo.ms, 70_000);
});

test("buildInsightsResponse hides parked findings by default and includes them with a parked flag when asked", () => {
  const heavy = conversation("conv-heavy", [
    assistantMessage("m1", [toolCall("r1", "read", 5 * 60_000)])
  ]);
  const findings = buildInsightsResponse([heavy], {}, scope, 30, { includeParked: true }).findings;
  assert.equal(findings.length, 1, "the fixture must clear the info-finding-heavy generator's cost floor");
  const fingerprint = findings[0].fingerprint;
  const parkState = { [fingerprint]: { parkedAt: new Date().toISOString(), costMsAtPark: findings[0].costMs } };

  const hidden = buildInsightsResponse([heavy], parkState, scope, 30, { includeParked: false });
  assert.equal(hidden.findings.length, 0, "a parked finding is excluded by default");

  const shown = buildInsightsResponse([heavy], parkState, scope, 30, { includeParked: true });
  assert.equal(shown.findings.length, 1);
  assert.equal(shown.findings[0].parked, true);
  assert.equal(shown.findings[0].fingerprint, fingerprint);
});

test("buildInsightsResponse restricts to the requested generator and attaches the shared remedy label", () => {
  const heavy = conversation("conv-heavy-2", [assistantMessage("m1", [toolCall("r1", "read", 5 * 60_000)])]);
  const response = buildInsightsResponse([heavy], {}, scope, 30, { generator: "recurring-long-commands", includeParked: true });
  assert.equal(response.findings.length, 0, "the read-only fixture produces no recurring-long-commands finding");

  const infoResponse = buildInsightsResponse([heavy], {}, scope, 30, { generator: "info-finding-heavy-sessions", includeParked: true });
  assert.equal(infoResponse.findings.length, 1);
  assert.equal(infoResponse.findings[0].remedyLabel, "missing map: add a CLAUDE.md pointer or docs index entry");
});

test("insights routes: GET returns an empty feed and POST park/unpark are gated and error correctly against an isolated, dataset-free environment", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "usage-insights-server-"));
  const previous = {
    USAGE_HOME: process.env.USAGE_HOME,
    CLAUDE_HOME: process.env.CLAUDE_HOME,
    CODEX_HOME: process.env.CODEX_HOME,
    GEMINI_HOME: process.env.GEMINI_HOME,
    TANGENT_VERIFY_READONLY: process.env.TANGENT_VERIFY_READONLY
  };
  process.env.USAGE_HOME = path.join(dir, "usage-home");
  process.env.CLAUDE_HOME = path.join(dir, "claude-home");
  process.env.CODEX_HOME = path.join(dir, "codex-home");
  process.env.GEMINI_HOME = path.join(dir, "gemini-home");
  delete process.env.TANGENT_VERIFY_READONLY;

  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });

  const registration = await createUsageUiApp({ client: fakeUsageClient() });
  const route = registration.routes[0];

  const feed = await route.handle({ method: "GET" }, new URL("http://localhost/api/usage/insights"), []);
  assert.equal(feed.status, 200);
  assert.equal(feed.json.scopeLabel, "all projects");
  assert.deepEqual(feed.json.findings, []);
  assert.equal(feed.json.totalMs, 0);

  const missingFingerprint = await route.handle(postRequest({}), new URL("http://localhost/api/usage/insights/park"), []);
  assert.equal(missingFingerprint.status, 400);

  const unknownFingerprint = await route.handle(postRequest({ fingerprint: "does-not-exist" }), new URL("http://localhost/api/usage/insights/park"), []);
  assert.equal(unknownFingerprint.status, 404);
  assert.match(unknownFingerprint.json.error, /No finding with fingerprint/);

  const noopUnpark = await route.handle(postRequest({ fingerprint: "was-never-parked" }), new URL("http://localhost/api/usage/insights/unpark"), []);
  assert.equal(noopUnpark.status, 200);
  assert.equal(noopUnpark.json.parked, false);

  process.env.TANGENT_VERIFY_READONLY = "1";
  const readonlyPark = await route.handle(postRequest({ fingerprint: "any" }), new URL("http://localhost/api/usage/insights/park"), []);
  assert.equal(readonlyPark.status, 403);
  const readonlyUnpark = await route.handle(postRequest({ fingerprint: "any" }), new URL("http://localhost/api/usage/insights/unpark"), []);
  assert.equal(readonlyUnpark.status, 403);
});

/** Builds a fake POST request whose body is the JSON-encoded value, for calling a route's handler directly without a real HTTP server. */
function postRequest(body) {
  const text = JSON.stringify(body);
  return {
    method: "POST",
    /** Yields the request body as a single Buffer chunk, matching the `for await` shape `readJsonBody` expects. */
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(text, "utf8");
    }
  };
}

/** Creates a fake Usage core client sufficient for the existing session routes; the insights route never reads it. */
function fakeUsageClient() {
  return {
    sessions: {
      /** Lists no fake Usage sessions. */
      async list() {
        return { data: [], meta: { warnings: [] } };
      }
    },
    messages: {
      /** Queries no fake Usage messages. */
      async query() {
        return { data: [], meta: { warnings: [] } };
      }
    },
    providers: {
      /** Lists no fake provider capabilities. */
      async list() {
        return { data: [], meta: { warnings: [] } };
      }
    }
  };
}
