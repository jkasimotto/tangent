import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const AREA_PRESENTATION_SCHEMA = "area-presentations.v1";
const queues = new Map();

function recordPath(root, area) {
  return path.join(root, "areas", ...area.split("/"), "presentations.json");
}

export async function readAreaPresentations(root, area) {
  try { return JSON.parse(await readFile(recordPath(root, area), "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return { schema: AREA_PRESENTATION_SCHEMA, area, items: [] };
    throw error;
  }
}

async function save(root, record) {
  const file = recordPath(root, record.area);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

function mutate(area, operation) {
  const previous = queues.get(area) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  queues.set(area, next);
  return next.finally(() => { if (queues.get(area) === next) queues.delete(area); });
}

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

function update(root, area, file, operation) {
  return mutate(area, async () => {
    const record = await readAreaPresentations(root, area);
    const item = record.items.find((entry) => entry.file === file && entry.withdrawnAt === null);
    const changed = item ? operation(item) : false;
    if (changed) await save(root, record);
    return { record, item: item ?? null, changed };
  });
}

export function withdrawAreaDocument(root, area, file, now = new Date().toISOString()) {
  return update(root, area, file, (item) => { item.withdrawnAt = now; return true; });
}

export function dismissAreaDocument(root, area, file, now = new Date().toISOString()) {
  return update(root, area, file, (item) => {
    if (item.dismissedAt && item.dismissedHash === item.presentedHash) return false;
    item.dismissedAt = now; item.dismissedHash = item.presentedHash; return true;
  });
}

export function markAreaDocumentOpened(root, area, file, hash = null, now = new Date().toISOString()) {
  return update(root, area, file, (item) => {
    if (item.openedAt) return false;
    item.openedAt = now; item.openedHash = hash; return true;
  });
}

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

export async function pruneMissingAreaPresentations(root, record, exists) {
  const kept = [];
  for (const item of record.items) if (await exists(item)) kept.push(item);
  if (kept.length === record.items.length) return { record, changed: false };
  record.items = kept;
  if (kept.length) await save(root, record); else await removeAreaPresentations(root, record.area);
  return { record, changed: true };
}

export function projectAreaPresentations(record) {
  return [...record.items].filter((item) => item.withdrawnAt === null && (!item.dismissedAt || item.dismissedHash !== item.presentedHash))
    .sort((a, b) => b.presentedAt.localeCompare(a.presentedAt));
}
