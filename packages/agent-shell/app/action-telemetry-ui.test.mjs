import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { actionName, createActionTelemetry, safeAreaMapTelemetry } from "./public/action-telemetry.js";

/** Makes the small DOM control surface used by actionName. */
function control(attributes = {}, tagName = "BUTTON") {
  const element = {
    tagName,
    id: attributes.id ?? "",
    /** Returns this fixture as its own nearest control. */
    closest: () => element,
    /** Reports whether the fixture carries one attribute. */
    hasAttribute: (name) => Object.hasOwn(attributes, name),
    /** Reads one fixture attribute. */
    getAttribute: (name) => attributes[name] ?? null,
  };
  return element;
}

test("browser action names use stable data attributes, not visible labels", () => {
  assert.equal(actionName(control({ "data-pipeline-control": "skip" })), "pipeline-control:skip");
  assert.equal(actionName(control({ "data-launch-for": "private/goal.md" })), "launch-for");
  assert.equal(actionName(control({ "data-goal-recovery": "private/goal.md" })), "goal-recovery");
  assert.equal(actionName(control({ "data-notify-document-comments": "" })), "notify-document-comments");
  assert.equal(actionName(control({ "data-complete-goal": "private/goal.md" })), "complete-goal");
  assert.equal(actionName(control({ "data-wont-do-goal": "private/goal.md" })), "wont-do-goal");
});

test("API telemetry strips query strings and does not recurse", async () => {
  const calls = [];
  const telemetry = createActionTelemetry(async (...args) => calls.push(args), () => 25);
  telemetry.apiFinished("GET", "/api/vault?private=yes", 10, 200, true);
  telemetry.apiFinished("POST", "/api/telemetry/action", 10, 204, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0][1].body), { kind: "api", action: "GET /api/vault", durationMs: 15, status: 200, ok: true });
});

test("Area map telemetry correlates lifecycle IDs while dropping authored content", async () => {
  const calls = [];
  const telemetry = createActionTelemetry(async (...args) => calls.push(args), () => 25);
  telemetry.recordAreaMap({
    name: "area_map_save", operationId: "11111111-1111-4111-8111-111111111111", gestureId: "22222222-2222-4222-8222-222222222222", worldRevision: "AbCdEfGhIjKlMnOp",
    phase: "failed", failureKind: "head-race", status: 409, retryable: true, retryAttempt: 1,
    shardCount: 2, duration: 12.5,
    owner: "private/area", selectedRegion: "private/area", text: "authored words", coordinates: { x: 1, y: 2 }, affectedAreas: ["private/area"],
  });
  telemetry.recordAreaMap({ name: "private authored event", operationId: "operation-8" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0][1].body), {
    kind: "area-map", action: "area_map_save", eventStream: "area-map",
    operationId: "11111111-1111-4111-8111-111111111111", gestureId: "22222222-2222-4222-8222-222222222222", worldRevision: "AbCdEfGhIjKlMnOp",
    phase: "failed", failureKind: "head-race", shardCount: 2,
    durationMs: 12.5, status: 409, retryAttempt: 1, retryable: true,
  });
  assert.deepEqual(safeAreaMapTelemetry({
    name: "area_map_projection", operationId: "secret_project", gestureId: "private_token", projectionId: "42",
  }), { action: "area_map_projection", eventStream: "area-map", projectionId: "42" });
});

test("Area map frame telemetry is coalesced with latency, count, and gesture correlation", async () => {
  const calls = [];
  const scheduled = [];
  const telemetry = createActionTelemetry(async (...args) => calls.push(args), () => 25, {
    areaMapFlushMs: 750,
    /** Captures one bounded telemetry delivery timer. */
    schedule(run, delay) { scheduled.push({ run, delay, cancelled: false }); return scheduled.length - 1; },
    /** Marks one captured telemetry delivery timer as cancelled. */
    cancel(index) { if (scheduled[index]) scheduled[index].cancelled = true; },
  });
  telemetry.recordAreaMap({ name: "area_map_gesture", gestureId: "33333333-3333-4333-8333-333333333333", phase: "started", gestureKind: "pointer" });
  for (let index = 0; index < 60; index += 1) {
    telemetry.recordAreaMap({
      name: "area_map_gesture_solved", gestureKind: "region-move", depth: 2, previewCount: index + 1,
      maximumTime: index / 10, owner: `private/area-${index}`,
    });
    telemetry.recordAreaMap({
      name: "area_map_projection", projectionId: String(index + 1), projectionKind: "area-pointer-preview",
      phase: "request", elementCount: 5,
    });
    telemetry.recordAreaMap({
      name: "area_map_projection", projectionId: String(index + 1), projectionKind: "area-pointer-preview",
      phase: "consumed", elementCount: 5, duration: index,
    });
  }

  assert.equal(calls.length, 1, "only the gesture boundary posts before the delivery interval");
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 750);
  scheduled[0].run();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.length, 4, "180 frame events become three summaries");
  const summaries = calls.slice(1).map((call) => JSON.parse(call[1].body));
  assert.deepEqual(summaries.map(({ action, phase, sampleCount }) => ({ action, phase, sampleCount })), [
    { action: "area_map_gesture_solved", phase: undefined, sampleCount: 60 },
    { action: "area_map_projection", phase: "request", sampleCount: 60 },
    { action: "area_map_projection", phase: "consumed", sampleCount: 60 },
  ]);
  assert.ok(summaries.every((entry) => entry.gestureId === "33333333-3333-4333-8333-333333333333"));
  assert.equal(summaries[0].durationMs, 5.9);
  assert.equal(summaries[0].previewCount, 60);
  assert.equal(summaries[2].durationMs, 59);
  assert.equal(summaries[2].projectionId, "60");
  assert.ok(summaries.every((entry) => !Object.hasOwn(entry, "owner")));
});

test("gesture finish flushes summaries and delayed projection callbacks keep correlation", async () => {
  const calls = [];
  const scheduled = [];
  const telemetry = createActionTelemetry(async (...args) => calls.push(args), () => 25, {
    /** Captures one bounded telemetry delivery timer. */
    schedule(run) { scheduled.push({ run, cancelled: false }); return scheduled.length - 1; },
    /** Marks one captured telemetry delivery timer as cancelled. */
    cancel(index) { if (scheduled[index]) scheduled[index].cancelled = true; },
  });
  telemetry.recordAreaMap({ name: "area_map_gesture", gestureId: "44444444-4444-4444-8444-444444444444", phase: "started" });
  telemetry.recordAreaMap({ name: "area_map_projection", projectionId: "61", phase: "request" });
  telemetry.recordAreaMap({ name: "area_map_gesture_solved", duration: 4 });
  telemetry.recordAreaMap({ name: "area_map_gesture", gestureId: "44444444-4444-4444-8444-444444444444", phase: "finished" });
  telemetry.recordAreaMap({ name: "area_map_projection", projectionId: "61", phase: "consumed", duration: 8 });
  telemetry.flushAreaMap();
  await new Promise((resolve) => setImmediate(resolve));

  const entries = calls.map((call) => JSON.parse(call[1].body));
  assert.deepEqual(entries.map((entry) => `${entry.action}:${entry.phase ?? "summary"}`), [
    "area_map_gesture:started",
    "area_map_projection:request",
    "area_map_gesture_solved:summary",
    "area_map_gesture:finished",
    "area_map_projection:consumed",
  ]);
  assert.ok(entries.every((entry) => entry.gestureId === "44444444-4444-4444-8444-444444444444"));
  assert.ok(scheduled.every(({ cancelled }) => cancelled));
});

test("pagehide and telemetry teardown flush without leaving a timer or listener", () => {
  const calls = [];
  const timers = [];
  let pagehide = null;
  const target = {
    /** Captures the pagehide listener installed by telemetry. */
    addEventListener(name, listener) { if (name === "pagehide") pagehide = listener; },
    /** Releases the pagehide listener installed by telemetry. */
    removeEventListener(name, listener) { if (name === "pagehide" && pagehide === listener) pagehide = null; },
  };
  const telemetry = createActionTelemetry(async (...args) => calls.push(args), () => 25, {
    pagehideTarget: target,
    /** Captures one bounded telemetry delivery timer. */
    schedule(run) { timers.push({ run, cancelled: false }); return timers.length - 1; },
    /** Marks one captured telemetry delivery timer as cancelled. */
    cancel(index) { if (timers[index]) timers[index].cancelled = true; },
  });
  telemetry.recordAreaMap({ name: "area_map_gesture_solved", gestureId: "55555555-5555-4555-8555-555555555555", duration: 3 });
  assert.equal(calls.length, 0);
  pagehide();
  assert.equal(calls.length, 1);
  assert.equal(timers[0].cancelled, true);

  telemetry.recordAreaMap({ name: "area_map_gesture_solved", gestureId: "66666666-6666-4666-8666-666666666666", duration: 5 });
  telemetry.destroy();
  assert.equal(calls.length, 2);
  assert.equal(timers[1].cancelled, true);
  assert.equal(pagehide, null);
  telemetry.recordAreaMap({ name: "area_map_gesture_solved", gestureId: "77777777-7777-4777-8777-777777777777", duration: 8 });
  assert.equal(calls.length, 2);
});

test("both production Area-map mounts forward client telemetry", async () => {
  const source = await readFile(new URL("./public/shell.js", import.meta.url), "utf8");
  const dedicatedMount = source.slice(source.indexOf("function areaMapPane(area)"), source.indexOf("function mountAreaWorkspace()"));
  assert.match(dedicatedMount, /onEvent:\s*actionTelemetry\.recordAreaMap/);
  assert.match(source, /createAreaDirectoryView\(\{[\s\S]*shell:\s*\{[^}]*actionTelemetry/);
});
