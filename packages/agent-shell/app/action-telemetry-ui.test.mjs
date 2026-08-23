import test from "node:test";
import assert from "node:assert/strict";
import { actionName, createActionTelemetry } from "./public/action-telemetry.js";

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
  assert.equal(actionName(control({ "data-notify-document-comments": "" })), "notify-document-comments");
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
