// Brain notice inbox: one JSON file per Area under the brains root,
// `${root}/${area}/inbox.json`, beside that Area's brain.json. Pure module,
// no tmux, no HTTP.
//
// Why it exists: a brain notice (a step handed over, a pipeline completed, a
// step stopped or sat idle, a Goal session ended) used to live only in the
// server's memory queue. A server restart, a brain generation handover, or a
// gap with no live brain dropped it, so the brain could miss an agent's
// finish. Every notice is written here first. It is marked delivered only
// after it reached a brain composer, or after it was listed in the first
// message of a new generation. Delivery is at-least-once: a duplicate notice
// costs the brain one line, a lost one costs it the work.
//
// The server owns which brain reads which inbox. This module owns the record
// shape, the unread question, and the text a brain sees.

import path from "node:path";
import { readJsonObject, walkJsonFiles, writeJsonObject } from "./json-store.mjs";

export const INBOX_SCHEMA = "area-brain-inbox.v1";

const KEPT_DELIVERED = 200;
const DIGEST_MAX_CHARS = 3800;

/** File path of one Area's notice inbox. */
export function inboxPath(root, area) {
  return path.join(root, area, "inbox.json");
}

/** An empty inbox for one Area. */
export function newInbox(area) {
  return { schema: INBOX_SCHEMA, area, seq: 0, notices: [] };
}

/**
 * Reads one Area's inbox. A missing, unreadable, or foreign file reads as an
 * empty inbox, so a caller can always append to what it gets back.
 */
export async function readInbox(root, area) {
  const parsed = await readJsonObject(inboxPath(root, area));
  if (!parsed || typeof parsed !== "object" || parsed.schema !== INBOX_SCHEMA) return newInbox(area);
  return { ...newInbox(area), ...parsed, area, notices: Array.isArray(parsed.notices) ? parsed.notices : [] };
}

/** Reads every inbox under the root; empty when the root is missing. */
export async function readAllInboxes(root) {
  const files = (await walkJsonFiles(root)).filter((file) => path.basename(file) === "inbox.json");
  const records = [];
  for (const file of files) {
    const area = path.relative(root, path.dirname(file)).split(path.sep).join("/");
    const record = await readInbox(root, area);
    if (record.notices.length) records.push(record);
  }
  return records;
}

/** Writes one inbox with mkdir -p and an atomic tmp + rename. */
export async function writeInbox(root, record) {
  const target = inboxPath(root, record.area);
  return writeJsonObject(target, record);
}

/**
 * Appends one notice and returns it. Ids count up inside the inbox, so they
 * stay stable across restarts and never repeat.
 */
export function appendNotice(record, text, now = new Date().toISOString(), sourceId = null, sender = null) {
  const body = String(text ?? "").trim();
  if (!body) throw new Error("a notice needs text");
  const stableSourceId = String(sourceId ?? "").trim() || null;
  const existing = stableSourceId ? record.notices?.find((notice) => notice.sourceId === stableSourceId) : null;
  if (existing) return { ...existing, duplicate: true };
  record.seq = Number(record.seq ?? 0) + 1;
  const notice = {
    id: `n${record.seq}`,
    text: body,
    createdAt: now,
    deliveredAt: null,
    deliveredTo: null,
    deliveredGeneration: null,
    deliveredBrainArea: null,
    ...(sender?.session ? { sender: {
      session: String(sender.session),
      area: sender.area == null ? null : String(sender.area),
      role: ["brain", "worker", "repair", "local"].includes(sender.role) ? sender.role : "local",
      generation: Number.isInteger(sender.generation) ? sender.generation : null,
    } } : {}),
    ...(stableSourceId ? { sourceId: stableSourceId } : {}),
  };
  record.notices = [...(record.notices ?? []), notice];
  return { ...notice, duplicate: false };
}

/** Rewrites one linked notice in place while preserving its identity and delivery evidence. */
export function rewriteNotice(record, { id = null, sourceId = null, text } = {}) {
  const notice = record.notices.find((item) => (id && item.id === id) || (sourceId && item.sourceId === sourceId));
  const body = String(text ?? "").trim();
  if (!notice || !body || notice.text === body) return false;
  notice.text = body;
  return true;
}

/** Every notice no brain generation has read yet, oldest first. */
export function unreadNotices(record) {
  return (record?.notices ?? []).filter((notice) => !notice.deliveredAt);
}

/**
 * Marks the named notices delivered to one brain session and generation, and
 * prunes the oldest delivered notices. Unknown ids are ignored: the caller
 * may hold ids from a record another pass already changed.
 */
export function markDelivered(record, ids, { session = null, generation = null, brainArea = null } = {}, now = new Date().toISOString()) {
  const wanted = new Set(ids.map((id) => String(id)));
  let changed = 0;
  for (const notice of record.notices ?? []) {
    if (!wanted.has(notice.id) || notice.deliveredAt) continue;
    notice.deliveredAt = now;
    notice.deliveredTo = session;
    notice.deliveredGeneration = generation;
    notice.deliveredBrainArea = brainArea;
    changed += 1;
  }
  pruneDelivered(record);
  return changed;
}

/** Keeps the record small: the unread notices and the last delivered ones. */
export function pruneDelivered(record, keep = KEPT_DELIVERED) {
  const notices = record.notices ?? [];
  const delivered = notices.filter((notice) => notice.deliveredAt);
  if (delivered.length <= keep) return record;
  const drop = new Set(delivered.slice(0, delivered.length - keep));
  record.notices = notices.filter((notice) => !drop.has(notice));
  return record;
}

/**
 * The inbox one brain reads. Parent and child Areas never share delivery.
 */
export function inboxesForBrain(records, area, ownsArea = null) {
  return records.filter((record) => record.area === area && (!ownsArea || ownsArea(record.area)));
}

/** Notices from several inboxes as one list, oldest first, each with its Area. */
export function mergeNotices(records) {
  const notices = [];
  for (const record of records) {
    for (const notice of unreadNotices(record)) notices.push({ ...notice, area: record.area });
  }
  return notices.sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt)));
}

/** One notice as a numbered line: the time, then the text. */
export function noticeLine(notice, index) {
  const time = String(notice.createdAt ?? "").slice(0, 16).replace("T", " ");
  return `${index + 1}. (${time}) ${notice.text}`;
}

/**
 * Every notice as one flat line for a chat composer. The list is cut when it
 * gets long, and says how many notices it left out.
 */
export function noticeDigest(notices, max = DIGEST_MAX_CHARS) {
  if (!notices.length) return "";
  const head = `You have ${notices.length} notice${notices.length === 1 ? "" : "s"} no brain generation read yet. `;
  const parts = [];
  let used = head.length;
  for (const [index, notice] of notices.entries()) {
    const line = `${noticeLine(notice, index)} `;
    if (parts.length && used + line.length > max) {
      parts.push(`and ${notices.length - index} more.`);
      break;
    }
    parts.push(line);
    used += line.length;
  }
  return (head + parts.join("")).trim();
}

/** Every notice as numbered lines for a brain's first message. */
export function noticeBlock(notices, max = DIGEST_MAX_CHARS) {
  if (!notices.length) return "";
  const lines = [];
  let used = 0;
  for (const [index, notice] of notices.entries()) {
    const line = noticeLine(notice, index);
    if (lines.length && used + line.length > max) {
      lines.push(`${index + 1}. and ${notices.length - index} more.`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}
