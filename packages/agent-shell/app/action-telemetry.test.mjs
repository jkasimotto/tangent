import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeActionTelemetry, recordActionTelemetry } from "./action-telemetry.mjs";

test("action telemetry keeps identifiers and timing but no arbitrary fields", () => {
  const entry = normalizeActionTelemetry({
    kind: "api",
    action: "POST /api/goals/start",
    durationMs: 12.6,
    status: 200,
    ok: true,
    prompt: "private words",
  }, () => new Date("2026-08-23T00:00:00.000Z"));
  assert.deepEqual(entry, {
    schema: "agent-shell-action.v1",
    at: "2026-08-23T00:00:00.000Z",
    kind: "api",
    action: "POST /api/goals/start",
    durationMs: 13,
    status: 200,
    ok: true,
  });
});

test("action telemetry appends JSONL and rejects empty actions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-actions-"));
  const file = path.join(root, "actions.jsonl");
  assert.equal(await recordActionTelemetry(file, { kind: "ui", action: "launch-start" }), true);
  assert.equal(await recordActionTelemetry(file, { kind: "ui", action: "" }), false);
  const rows = (await readFile(file, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "launch-start");
});

test("connection telemetry keeps bounded runtime evidence", () => {
  const entry = normalizeActionTelemetry({
    kind: "connection",
    action: "online->transport-retrying",
    trigger: "event",
    retryAttempt: 2,
    lastSuccessAgeMs: 1250.4,
    gatewayBoot: "gateway-1",
    controllerBoot: "controller-2",
    operationId: "operation-3",
    eventStream: "retrying",
    prompt: "private words",
  }, () => new Date("2026-08-25T00:00:00.000Z"));
  assert.deepEqual(entry, {
    schema: "agent-shell-action.v1",
    at: "2026-08-25T00:00:00.000Z",
    kind: "connection",
    action: "online->transport-retrying",
    trigger: "event",
    retryAttempt: 2,
    lastSuccessAgeMs: 1250,
    gatewayBoot: "gateway-1",
    controllerBoot: "controller-2",
    operationId: "operation-3",
    eventStream: "retrying",
  });
});
