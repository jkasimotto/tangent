import { createHash } from "node:crypto";
import path from "node:path";
import { readJsonObject, writeJsonObject } from "./json-store.mjs";

export const OPERATION_EVENTS_SCHEMA = "operation-event-ledger.v1";
const KEPT_EVENTS = 2_000;

/** Returns the ledger path for one exact Area. */
export function operationEventsPath(root, area) {
  return path.join(root, area, "operation-events.json");
}

/** Reads one exact Area ledger. */
export async function readOperationEvents(root, area) {
  const value = await readJsonObject(operationEventsPath(root, area));
  return value?.schema === OPERATION_EVENTS_SCHEMA
    ? { ...value, area, events: Array.isArray(value.events) ? value.events : [], conditions: value.conditions && typeof value.conditions === "object" ? value.conditions : {} }
    : { schema: OPERATION_EVENTS_SCHEMA, area, cutoverAt: new Date().toISOString(), events: [], conditions: {} };
}

/** Writes one exact Area ledger atomically. */
export async function writeOperationEvents(root, record) {
  return writeJsonObject(operationEventsPath(root, record.area), record);
}

/** Stable identity for a material condition edge or declared result. */
export function operationEventId(operationId, kind, conditionKey, revision) {
  return createHash("sha256").update(`${operationId}\0${kind}\0${conditionKey}\0${revision}`).digest("hex");
}

/** Adds one material event once. */
export function appendOperationEvent(record, input, now = new Date().toISOString()) {
  const operationId = String(input.operationId ?? "").trim();
  const kind = String(input.kind ?? "").trim();
  const conditionKey = String(input.conditionKey ?? "").trim();
  const revision = String(input.revision ?? "").trim();
  const summary = String(input.summary ?? "").trim();
  if (!operationId || !kind || !conditionKey || !revision || !summary) throw new Error("A material Operation event needs identity, kind, condition, revision, and summary.");
  const id = operationEventId(operationId, kind, conditionKey, revision);
  const existing = record.events.find((event) => event.id === id);
  if (existing) return { ...existing, duplicate: true };
  const event = { id, operationId, kind, conditionKey, revision, summary, evidenceRef: input.evidenceRef ?? null, createdAt: now, deliveredAt: null };
  record.events.push(event);
  record.events = record.events.slice(-KEPT_EVENTS);
  return { ...event, duplicate: false };
}

/** Projects condition edges and declared results from the current Operation. */
export function materialOperationEvents(record, operation, now = new Date().toISOString()) {
  const events = [];
  const previous = record.conditions[operation.id] ?? null;
  const problem = operation.problem ? String(operation.problem) : null;
  const outcomeKey = operation.runtime?.lastOutcome?.key;
  const conditionKey = problem
    ? `${String(outcomeKey ?? "problem")}:${createHash("sha256").update(problem).digest("hex").slice(0, 12)}`
    : String(outcomeKey ?? "health");
  const revision = String(operation.runtime?.lastOutcome?.revision ?? operation.revision ?? conditionKey);
  const edge = (problem && (!previous || previous.problem !== problem || previous.conditionKey !== conditionKey)) || (!problem && previous?.problem);
  const sequence = Math.max(0, Number(previous?.sequence) || 0) + (edge ? 1 : 0);
  if (problem && (!previous || previous.problem !== problem || previous.conditionKey !== conditionKey)) {
    events.push(appendOperationEvent(record, { operationId: operation.id, kind: previous?.problem ? "problem-changed" : "problem-opened", conditionKey, revision: `${revision}:edge:${sequence}`, summary: `${operation.label ?? operation.name} problem: ${problem}`, evidenceRef: operation.id }, now));
  } else if (!problem && previous?.problem) {
    events.push(appendOperationEvent(record, { operationId: operation.id, kind: "problem-resolved", conditionKey: previous.conditionKey, revision: `resolved:${previous.revision}:edge:${sequence}`, summary: `${operation.label ?? operation.name} recovered.`, evidenceRef: operation.id }, now));
  }
  const declared = operation.reportableResult;
  if (declared?.key && declared?.summary) {
    events.push(appendOperationEvent(record, { operationId: operation.id, kind: "declared-result", conditionKey: String(declared.key), revision: String(declared.revision ?? revision), summary: String(declared.summary), evidenceRef: declared.evidenceRef ?? operation.id }, now));
  }
  record.conditions[operation.id] = { problem, conditionKey, revision, sequence };
  return events.filter((event) => !event.duplicate);
}

/** Marks one material event delivered to its exact Area inbox. */
export function markOperationEventDelivered(record, id, now = new Date().toISOString()) {
  const event = record.events.find((item) => item.id === id);
  if (!event || event.deliveredAt) return false;
  event.deliveredAt = now;
  return true;
}
