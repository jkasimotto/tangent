import { randomUUID } from "node:crypto";
import { readJsonObject, writeJsonObject } from "./json-store.mjs";

export const MESSAGE_QUEUE_SCHEMA = "agent-message-queue.v1";

/** Returns one canonical durable generic-message record, or null. */
function normalizeEntry(value) {
  if (!value || typeof value !== "object") return null;
  const id = String(value.id ?? "").trim();
  const target = String(value.target ?? "").trim();
  const text = String(value.text ?? "").replace(/\s+/g, " ").trim();
  if (!id || !target || !text || text.length > 4000) return null;
  return {
    id,
    target,
    from: String(value.from ?? "unknown sender").replace(/\s+/g, " ").trim() || "unknown sender",
    area: typeof value.area === "string" && value.area.trim() ? value.area.replace(/\s+/g, " ").trim() : null,
    text,
    // This store is only for generic cross-agent messages. Their provenance
    // banner is mandatory and cannot be disabled by a stale or edited file.
    banner: true,
    queuedAt: String(value.queuedAt ?? "").trim() || null,
  };
}

/** Normalizes a missing, malformed, or partially old queue without guessing recipients. */
export function normalizeMessageQueue(value) {
  if (!value || typeof value !== "object" || value.schema !== MESSAGE_QUEUE_SCHEMA) {
    return { schema: MESSAGE_QUEUE_SCHEMA, entries: [] };
  }
  const seen = new Set();
  const entries = [];
  for (const candidate of Array.isArray(value.entries) ? value.entries : []) {
    const entry = normalizeEntry(candidate);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }
  return { schema: MESSAGE_QUEUE_SCHEMA, entries };
}

/**
 * Opens one atomic file-backed queue. Mutations serialize through one writer,
 * so a later append cannot be overwritten by an earlier slow rename.
 */
export async function openMessageQueueStore({ file, now = () => new Date().toISOString(), id = randomUUID }) {
  let record = normalizeMessageQueue(await readJsonObject(file));
  let writes = Promise.resolve();

  /** Applies and atomically persists one mutation. */
  function mutate(change) {
    const operation = writes.then(async () => {
      const next = normalizeMessageQueue(change(record));
      await writeJsonObject(file, next);
      record = next;
      return record;
    });
    writes = operation.catch(() => {});
    return operation;
  }

  /** Returns hydrated entries in their durable insertion order. */
  function entries() {
    return record.entries.map((entry) => ({ ...entry }));
  }

  /** Persists one exact target and body before its caller may wake delivery. */
  async function append(target, entry) {
    const stored = normalizeEntry({
      id: String(entry.deliveryId ?? "").trim() || id(),
      target,
      from: entry.from,
      area: entry.area,
      text: entry.text,
      banner: entry.banner,
      queuedAt: entry.queuedAt || now(),
    });
    if (!stored) throw new Error("a durable agent message needs an exact target and normalized text");
    await mutate((current) => ({ ...current, entries: [...current.entries, stored] }));
    return { ...stored };
  }

  /** Removes only entries whose current delivery attempt reached settlement. */
  async function remove(ids) {
    const wanted = new Set((Array.isArray(ids) ? ids : [ids]).map((value) => String(value)));
    if (!wanted.size) return;
    await mutate((current) => ({ ...current, entries: current.entries.filter((entry) => !wanted.has(entry.id)) }));
  }

  /** Persists the delivery controller's already-bounded retarget order. */
  async function retarget(oldTarget, newTarget, orderedIds, rejectedIds = []) {
    const order = [...new Set(orderedIds.map((value) => String(value)))];
    const rejected = new Set(rejectedIds.map((value) => String(value)));
    await mutate((current) => {
      const byId = new Map(current.entries.map((entry) => [entry.id, entry]));
      const affected = new Set([...order, ...rejected]);
      const untouched = current.entries.filter((entry) => !affected.has(entry.id));
      const moved = order.map((entryId) => byId.get(entryId)).filter(Boolean).map((entry) => ({
        ...entry,
        target: entry.target === oldTarget || entry.target === newTarget ? newTarget : entry.target,
      }));
      return { ...current, entries: [...untouched, ...moved] };
    });
  }

  return { append, entries, remove, retarget };
}
