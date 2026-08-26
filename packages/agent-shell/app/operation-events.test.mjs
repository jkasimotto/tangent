import assert from "node:assert/strict";
import test from "node:test";
import { appendOperationEvent, markOperationEventDelivered, materialOperationEvents } from "./operation-events.mjs";

/** Creates one empty Operation event ledger. */
function ledger() {
  return { schema: "operation-event-ledger.v1", area: "otto/test", events: [], conditions: {} };
}

test("Operation problems emit only on condition edges", () => {
  const record = ledger();
  const operation = { id: "trigger:otto/test:probe", area: "otto/test", label: "Probe", problem: "offline", runtime: { lastCheckedAt: "2026-08-26T01:00:00.000Z" } };
  assert.equal(materialOperationEvents(record, operation).length, 1);
  assert.equal(materialOperationEvents(record, operation).length, 0);
  operation.runtime.lastCheckedAt = "2026-08-26T02:00:00.000Z";
  assert.equal(materialOperationEvents(record, operation).length, 0, "a poll timestamp is not an event revision");
  operation.problem = "timed out";
  assert.equal(materialOperationEvents(record, operation)[0].kind, "problem-changed");
  operation.problem = null;
  assert.equal(materialOperationEvents(record, operation)[0].kind, "problem-resolved");
  operation.problem = "timed out";
  assert.equal(materialOperationEvents(record, operation)[0].kind, "problem-opened", "the same condition can recur after resolution");
});

test("declared results deduplicate and delivery is durable", () => {
  const record = ledger();
  const input = { operationId: "command:otto/test:sync", kind: "declared-result", conditionKey: "r1", revision: "1", summary: "Synced 12 rows." };
  const event = appendOperationEvent(record, input);
  assert.equal(appendOperationEvent(record, input).duplicate, true);
  assert.equal(markOperationEventDelivered(record, event.id, "2026-08-26T02:00:00.000Z"), true);
  assert.equal(markOperationEventDelivered(record, event.id), false);
});
