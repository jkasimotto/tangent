import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const AREA_PRESENTATION_SCHEMA = "area-presentations.v1";
const queues = new Map();

/** Returns the durable record path for one Area. */
function recordPath(root, area) {
  return path.join(root, "areas", ...area.split("/"), "presentations.json");
}

/** Reads one Area presentation record or returns an empty record. */
export async function readAreaPresentations(root, area) {
  try { return JSON.parse(await readFile(recordPath(root, area), "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return { schema: AREA_PRESENTATION_SCHEMA, area, items: [] };
    throw error;
  }
}

/** Saves one complete Area presentation record atomically. */
async function save(root, record) {
  const file = recordPath(root, record.area);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

/** Serializes presentation changes for one Area. */
function mutate(area, operation) {
  const previous = queues.get(area) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  queues.set(area, next);
  return next.finally(() => { if (queues.get(area) === next) queues.delete(area); });
}

/** Presents the supplied Area Documents with stable identities. */
export function presentAreaDocuments(root, area, documents, presenter = {}, note = "", now = new Date().toISOString()) {
  return mutate(area, async () => {
    const record = await readAreaPresentations(root, area);
    const items = [];
    let changed = false;
    for (const document of documents) {
      const current = record.items.find((item) => item.file === document.file);
      if (current?.presentedHash === document.hash && current.withdrawnAt === null) { items.push(current); continue; }
      const item = current ?? { id: randomUUID(), file: document.file, root: "vault" };
      Object.assign(item, { title: document.title, presentedBy: presenter, presentedAt: now, presentedHash: document.hash,
        note: String(note ?? "").trim(), openedAt: null, openedHash: null, withdrawnAt: null, dismissedAt: null, dismissedHash: null });
      if (!current) record.items.push(item);
      items.push(item); changed = true;
    }
    if (changed) await save(root, record);
    return { record, items, changed };
  });
}

/** Applies one mutation to an active Area Document. */
function update(root, area, file, operation) {
  return mutate(area, async () => {
    const record = await readAreaPresentations(root, area);
    const item = record.items.find((entry) => entry.file === file && entry.withdrawnAt === null);
    const changed = item ? operation(item) : false;
    if (changed) await save(root, record);
    return { record, item: item ?? null, changed };
  });
}

/** Withdraws one Area Document from presentation. */
export function withdrawAreaDocument(root, area, file, now = new Date().toISOString()) {
  return update(root, area, file, (item) => { item.withdrawnAt = now; return true; });
}

/** Dismisses one exact presented revision idempotently. */
export function dismissAreaDocument(root, area, file, now = new Date().toISOString(), expectedHash = "") {
  return update(root, area, file, (item) => {
    if (expectedHash && item.presentedHash !== expectedHash) return false;
    if (item.dismissedAt && item.dismissedHash === item.presentedHash) return false;
    item.dismissedAt = now; item.dismissedHash = item.presentedHash; return true;
  });
}

/** Records the first open of one Area Document. */
export function markAreaDocumentOpened(root, area, file, hash = null, now = new Date().toISOString()) {
  return update(root, area, file, (item) => {
    if (item.openedAt) return false;
    item.openedAt = now; item.openedHash = hash; return true;
  });
}

/** Removes presentation records for an Area and optional descendants. */
export async function removeAreaPresentations(root, area, descendants = false) {
  const base = path.join(root, "areas");
  if (!descendants) {
    try { await unlink(recordPath(root, area)); return true; }
    catch (error) { if (error.code === "ENOENT") return false; throw error; }
  }
  const { rm } = await import("node:fs/promises");
  await rm(path.join(base, ...area.split("/")), { recursive: true, force: true });
  return true;
}

/** Removes presentation entries whose Documents no longer exist. */
export async function pruneMissingAreaPresentations(root, record, exists) {
  const kept = [];
  for (const item of record.items) if (await exists(item)) kept.push(item);
  if (kept.length === record.items.length) return { record, changed: false };
  record.items = kept;
  if (kept.length) await save(root, record); else await removeAreaPresentations(root, record.area);
  return { record, changed: true };
}

/** Returns the active Area presentations in newest-first order. */
export function projectAreaPresentations(record) {
  return [...record.items].filter((item) => item.withdrawnAt === null && (!item.dismissedAt || item.dismissedHash !== item.presentedHash))
    .sort((a, b) => b.presentedAt.localeCompare(a.presentedAt));
}
