// The state bus. Each work item is a folder under stateDir with a `manifest.json` status cursor and
// accumulating `NN-*.md` artifacts. This module is the single writer of manifest.json so its schema
// stays consistent no matter which stage writes it. Stages coordinate ONLY through these folders.
import fs from "node:fs";
import path from "node:path";

/** ISO-8601 timestamp, the format used throughout a manifest. */
function nowIso() {
  return new Date().toISOString();
}

/** Absolute path to an item's dossier directory. */
export function dossierDir(cfg, slug) {
  return path.join(cfg.stateDir, slug);
}

/** Absolute path to an item's manifest file. */
function manifestPath(cfg, slug) {
  return path.join(dossierDir(cfg, slug), "manifest.json");
}

/** Reads and parses an item's manifest; throws if the item does not exist. */
export function readManifest(cfg, slug) {
  const file = manifestPath(cfg, slug);
  if (!fs.existsSync(file)) throw new Error(`no such item: ${slug}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Writes an item's manifest, stamping updatedAt and creating the dossier dir if needed. */
function writeManifest(cfg, slug, manifest) {
  manifest.updatedAt = nowIso();
  fs.mkdirSync(dossierDir(cfg, slug), { recursive: true });
  fs.writeFileSync(manifestPath(cfg, slug), JSON.stringify(manifest, null, 2) + "\n");
}

/** Every readable manifest under stateDir, oldest-first by createdAt (unreadable ones skipped). */
export function allManifests(cfg) {
  if (!fs.existsSync(cfg.stateDir)) return [];
  return fs.readdirSync(cfg.stateDir)
    .map((slug) => {
      try { return readManifest(cfg, slug); } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
}

/** Slugs currently sitting in a given status, oldest-first. */
export function listByStatus(cfg, status) {
  return allManifests(cfg).filter((m) => m.status === status).map((m) => m.slug);
}

/** Creates a new item in the first status (the feedback inbox) and returns its dossier dir. */
export function createItem(cfg, { slug, title, feedback = [], extra = {} }) {
  if (fs.existsSync(manifestPath(cfg, slug))) throw new Error(`item already exists: ${slug}`);
  const manifest = {
    slug,
    title: title || slug,
    status: cfg.statuses[0],
    sourceFeedbackIds: feedback,
    blockedOn: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    stageLog: [{ status: cfg.statuses[0], at: nowIso(), note: "created" }],
    ...extra
  };
  writeManifest(cfg, slug, manifest);
  return dossierDir(cfg, slug);
}

/** Advances an item to a new status, appending a stage-log entry and optional block/unblock note. */
export function advance(cfg, slug, status, { note, block, unblock } = {}) {
  if (!cfg.statuses.includes(status)) throw new Error(`unknown status "${status}". one of: ${cfg.statuses.join(", ")}`);
  const manifest = readManifest(cfg, slug);
  manifest.status = status;
  if (unblock) manifest.blockedOn = null;
  if (block) manifest.blockedOn = String(block);
  manifest.stageLog.push({ status, at: nowIso(), note: note || "" });
  writeManifest(cfg, slug, manifest);
  return manifest;
}
