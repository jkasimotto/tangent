import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const PRESENTATION_SCHEMA = "goal-presentations.v1";

/** Returns the runtime record path for one Goal. */
function recordPath(root, area, slug) {
  return path.join(root, ...area.split("/"), `${slug}.json`);
}

/** Reads one Goal presentation record or returns an empty record. */
export async function readGoalPresentations(root, area, slug) {
  try { return JSON.parse(await readFile(recordPath(root, area, slug), "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return { schema: PRESENTATION_SCHEMA, area, slug, goal: `${area}/goal-${slug}.md`, items: [] };
    throw error;
  }
}

/** Presents or updates one validated card without changing its stable identity. */
export async function presentGoalCard(root, goal, card, presenter, now = new Date().toISOString()) {
  const record = await readGoalPresentations(root, goal.area, goal.slug);
  record.cards ??= [];
  const current = record.cards.find((entry) => entry.kind === card.kind && entry.title === card.title);
  if (current?.fieldsHash === card.fieldsHash) return { record, card: current, changed: false };
  const entry = current ?? { id: randomUUID(), kind: card.kind, title: card.title, presentedAt: now };
  Object.assign(entry, { fields: card.fields, fieldsHash: card.fieldsHash, presentedBy: presenter, updatedAt: now, dismissedAt: null, dismissedHash: null });
  if (!current) record.cards.push(entry);
  await save(root, record);
  return { record, card: entry, changed: true };
}

/** Withdraws one named Goal card. */
export async function withdrawGoalCard(root, goal, title) {
  const record = await readGoalPresentations(root, goal.area, goal.slug);
  const before = (record.cards ?? []).length;
  record.cards = (record.cards ?? []).filter((entry) => entry.title !== title);
  if (record.cards.length === before) return { record, card: null, changed: false };
  await save(root, record);
  return { record, changed: true };
}

/** Dismisses one exact Goal card revision idempotently. */
export async function dismissGoalCard(root, goal, id, now = new Date().toISOString()) {
  const record = await readGoalPresentations(root, goal.area, goal.slug);
  const card = (record.cards ?? []).find((entry) => entry.id === id);
  if (!card) return { record, card: null, changed: false };
  if (card.dismissedAt && card.dismissedHash === card.fieldsHash) return { record, card, changed: false };
  card.dismissedAt = now; card.dismissedHash = card.fieldsHash;
  await save(root, record);
  return { record, card, changed: true };
}

/** Returns all currently active Goal cards. */
export function projectCards(record) {
  return [...(record.cards ?? [])].filter((card) => card.dismissedAt === null || card.dismissedHash !== card.fieldsHash).sort((a, b) => a.presentedAt.localeCompare(b.presentedAt));
}

/** Saves one complete presentation record atomically. */
async function save(root, record) {
  const file = recordPath(root, record.area, record.slug);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(temporary, file);
  return record;
}

/** Returns the content identity that controls presentation idempotence. */
export function presentationHash(text) {
  return createHash("sha256").update(text).digest("hex");
}

/** Presents one Document, or resets attention after its content changes. */
export async function presentGoalDocument(root, goal, document, presenter = {}, note = "", now = new Date().toISOString()) {
  const record = await readGoalPresentations(root, goal.area, goal.slug);
  const current = record.items.find((item) => item.file === document.file && item.root === document.root);
  // Same content, still presented: nothing to do. A dismissal is fenced to the
  // presented hash, so re-presenting unchanged content cannot bring it back.
  if (current?.presentedHash === document.hash && current.withdrawnAt === null) return { record, item: current, changed: false };
  const item = current ?? { id: randomUUID(), file: document.file, root: document.root };
  Object.assign(item, {
    title: document.title, presentedBy: presenter, presentedAt: now, presentedHash: document.hash,
    note: String(note ?? "").trim(), openedAt: null, openedHash: null, withdrawnAt: null, dismissedAt: null, dismissedHash: null,
    ...(document.repository ? { repository: document.repository } : {}),
  });
  if (!current) record.items.push(item);
  await save(root, record);
  return { record, item, changed: true };
}

/** Withdraws one active presentation without changing its Document. */
export async function withdrawGoalDocument(root, goal, file, now = new Date().toISOString()) {
  const record = await readGoalPresentations(root, goal.area, goal.slug);
  const item = record.items.find((entry) => entry.file === file && entry.withdrawnAt === null);
  if (!item) return { record, item: null, changed: false };
  item.withdrawnAt = now;
  await save(root, record);
  return { record, item, changed: true };
}

/** Records that Julian dismissed one presentation. It stays hidden until the content changes. */
export async function dismissGoalDocument(root, goal, file, now = new Date().toISOString(), expectedHash = "") {
  const record = await readGoalPresentations(root, goal.area, goal.slug);
  const item = record.items.find((entry) => entry.file === file && entry.withdrawnAt === null);
  if (!item) return { record, item: null, changed: false };
  if (expectedHash && item.presentedHash !== expectedHash) return { record, item, changed: false, conflict: true };
  if (item.dismissedAt && item.dismissedHash === item.presentedHash) return { record, item, changed: false, repeated: true };
  item.dismissedAt = now;
  item.dismissedHash = item.presentedHash;
  await save(root, record);
  return { record, item, changed: true };
}

/** Records the first opening of one presentation. Opening never hides the row. */
export async function markGoalDocumentOpened(root, goal, file, hash = null, now = new Date().toISOString()) {
  const record = await readGoalPresentations(root, goal.area, goal.slug);
  const item = record.items.find((entry) => entry.file === file && entry.openedAt === null && entry.withdrawnAt === null);
  if (!item) return { record, item: null, changed: false };
  item.openedAt = now;
  item.openedHash = hash;
  await save(root, record);
  return { record, item, changed: true };
}

/** Removes all presentation state when its Goal closes. */
export async function removeGoalPresentations(root, goal) {
  try { await unlink(recordPath(root, goal.area, goal.slug)); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

/** Removes presentation items whose source files no longer exist. */
export async function pruneMissingPresentations(root, record, exists) {
  const kept = [];
  for (const item of record.items) if (await exists(item)) kept.push(item);
  if (kept.length === record.items.length) return { record, changed: false };
  record.items = kept;
  if (kept.length) await save(root, record);
  else await removeGoalPresentations(root, record);
  return { record, changed: true };
}

/** Projects every presentation that is neither withdrawn nor dismissed, newest first. Opened ones stay. */
export function projectPresentations(record) {
  return [...record.items].filter((item) => item.withdrawnAt === null && !item.dismissedAt).sort((a, b) => b.presentedAt.localeCompare(a.presentedAt));
}
