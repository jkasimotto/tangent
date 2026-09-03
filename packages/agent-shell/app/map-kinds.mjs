// The Map kinds catalog: what each kind of thing looks like on a Map and what
// one click does with it. The server owns the definition (`map-kinds.md`) and
// the icon drawings (`map-icons/`) in the vault, reads them per request the way
// the harness registry is read, and serves one catalog. The browser never
// parses an Excalidraw file.
// Design: docs/design/map-resource-icons/code.md

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { validateSceneElements } from "./area-canvas.mjs";
import { fencedBlock } from "./launch-environment.mjs";
import { MAP_KINDS_STARTER_TEXT, starterMapIconFiles } from "./map-kind-starters.mjs";
import {
  BUILT_IN_MAP_KINDS, ICON_ELEMENT_LIMIT, ICON_ELEMENT_WARNING, MAP_KIND_TARGETS,
  iconBounds, isMapKindState, isMapKindVerb,
} from "./public/area-map-figures.js";

export const MAP_KINDS_FILE = "map-kinds.md";
export const MAP_ICONS_FOLDER = "map-icons";
export const MAP_KINDS_TAG = "tangent.map-kinds.v1";

const SAFE_KIND_ID = /^[a-z][a-z0-9-]{0,63}$/;
const SAFE_ICON_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ICON_EXTENSIONS = new Set([".excalidraw", ".excalidrawlib"]);
const REJECTED_ICON_TYPES = new Set(["image", "embeddable", "iframe"]);
const MAX_ICON_BYTES = 2 * 1024 * 1024;

/** Returns the 1-based line the fenced definition block starts on. */
function blockStartLine(text, tag) {
  const index = String(text).indexOf(`\`\`\`${tag}`);
  return index < 0 ? 1 : String(text).slice(0, index).split("\n").length;
}

/** Returns the definition-file line one JSON parse error points at. */
function jsonErrorLine(text, tag, message) {
  const inside = /line (\d+)/.exec(String(message));
  return blockStartLine(text, tag) + (inside ? Number(inside[1]) : 0);
}

/** Reads one entry's ordered per-state icon rules and reports every bad rule. */
function entryIconRules(entry, target, provider, problems) {
  const rules = [];
  if (entry.icons !== undefined && !Array.isArray(entry.icons)) { problems.push("icons must be a list"); return rules; }
  for (const rule of entry.icons ?? []) {
    if (!rule || typeof rule !== "object" || typeof rule.when !== "string" || typeof rule.icon !== "string") { problems.push("each icons entry needs a when state and an icon"); continue; }
    // A provider prints its own word, such as Merged, and Julian may name it.
    if (!isMapKindState(target, rule.when) && !provider) problems.push(`unknown state \`${rule.when}\``);
    rules.push({ when: rule.when, icon: rule.icon });
  }
  return rules;
}

/** Normalizes one definition entry and collects every problem it carries. */
function normalizeEntry(entry, { seen, iconNames }) {
  const problems = [];
  const id = typeof entry?.id === "string" ? entry.id : "";
  if (!SAFE_KIND_ID.test(id)) return { id: id || "(unnamed)", label: id || "Kind", target: "vault", provider: null, builtIn: false, icon: null, icons: [], click: null, problems: ["id must be lower case letters, digits, and dashes"] };
  if (seen.has(id)) problems.push("a later entry repeats this id");
  const builtIn = BUILT_IN_MAP_KINDS[id] ?? null;
  if (builtIn && entry.target !== undefined && entry.target !== builtIn.target) problems.push(`${id} always has the ${builtIn.target} target`);
  const target = builtIn ? builtIn.target : entry.target;
  if (!builtIn && !MAP_KIND_TARGETS.includes(target)) problems.push("a new id needs a target of path, url, or vault");
  const label = typeof entry.label === "string" && entry.label ? entry.label : "";
  if (!label) problems.push("an entry needs a label");
  const provider = builtIn ? builtIn.provider : (["github-pr", "phabricator-revision"].includes(entry.provider) ? entry.provider : null);
  const safeTarget = MAP_KIND_TARGETS.includes(target) ? target : "vault";
  const icon = typeof entry.icon === "string" ? entry.icon : null;
  const icons = entryIconRules(entry, safeTarget, provider, problems);
  const click = entry.click === undefined || entry.click === null ? null : String(entry.click);
  // An entry with no usable target already says so; a second problem about its
  // verb would name a target Julian never wrote.
  if (click && MAP_KIND_TARGETS.includes(target) && !isMapKindVerb(safeTarget, click)) problems.push(`a ${safeTarget} kind cannot run \`${click}\``);
  if (iconNames) {
    for (const name of [icon, ...icons.map((rule) => rule.icon)].filter(Boolean)) {
      if (!iconNames.has(name)) problems.push(`icon \`${name}\` not found`);
    }
  }
  return { id, label: label || id, target: safeTarget, provider, builtIn: Boolean(builtIn), icon, icons, click, problems };
}

/**
 * Parses the fenced `tangent.map-kinds.v1` block. A block that does not parse
 * yields one error and no entries, so every kind falls back to a card. A bad
 * entry keeps its problems and only that kind falls back.
 */
export function parseMapKinds(text, iconNames = null) {
  const raw = fencedBlock(text, MAP_KINDS_TAG);
  if (raw === null) return { kinds: [] };
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (error) { return { error: `${MAP_KINDS_FILE} line ${jsonErrorLine(text, MAP_KINDS_TAG, error.message)}: ${error.message}`, kinds: [] }; }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.kinds)) {
    return { error: `${MAP_KINDS_FILE} line ${blockStartLine(text, MAP_KINDS_TAG)}: the block needs a kinds list`, kinds: [] };
  }
  const seen = new Set();
  const kinds = [];
  for (const entry of parsed.kinds) {
    const normalized = normalizeEntry(entry, { seen, iconNames });
    seen.add(normalized.id);
    kinds.push(normalized);
  }
  return { kinds };
}

/** Returns the non-deleted elements one icon file holds, or a problem. */
function iconElements(name, parsed, extension) {
  if (extension === ".excalidraw") {
    if (parsed?.type !== "excalidraw" || !Array.isArray(parsed.elements)) return { problem: `${name}: not an Excalidraw scene` };
    return { elements: parsed.elements };
  }
  if (parsed?.type !== "excalidrawlib") return { problem: `${name}: not an Excalidraw library` };
  const items = Array.isArray(parsed.libraryItems) ? parsed.libraryItems : Array.isArray(parsed.library) ? parsed.library : null;
  if (!items) return { problem: `${name}: the library holds no item` };
  if (items.length !== 1) return { problem: `${name}: a library icon must hold exactly one item` };
  const elements = Array.isArray(items[0]) ? items[0] : items[0]?.elements;
  if (!Array.isArray(elements)) return { problem: `${name}: the library item holds no elements` };
  return { elements };
}

/**
 * Reads one icon file into the normal form the projection draws: elements
 * translated so their bounds start at the origin, with the size they were
 * drawn at. An icon Tangent cannot use is a problem on the file, and every
 * kind that names it falls back to a card.
 */
export function readMapIcon(name, text, extension) {
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (error) { return { problem: `${name}: ${error.message}` }; }
  const read = iconElements(name, parsed, extension);
  if (read.problem) return read;
  const elements = read.elements.filter((element) => element?.isDeleted !== true);
  if (!elements.length) return { problem: `${name}: the drawing is empty` };
  if (elements.length > ICON_ELEMENT_LIMIT) return { problem: `${name}: more than ${ICON_ELEMENT_LIMIT} elements` };
  const rejected = elements.find((element) => REJECTED_ICON_TYPES.has(element?.type));
  if (rejected) return { problem: `${name}: an icon cannot hold a ${rejected.type} element` };
  const checked = validateSceneElements(elements);
  if (!checked.ok) return { problem: `${name}: ${checked.errors[0]}` };
  const bounds = iconBounds(elements);
  return {
    icon: {
      name,
      width: bounds.width,
      height: bounds.height,
      elements: elements.map((element) => ({ ...element, x: Number(element.x ?? 0) - bounds.x, y: Number(element.y ?? 0) - bounds.y })),
      elementCount: elements.length,
      warning: elements.length > ICON_ELEMENT_WARNING ? `${name}: more than ${ICON_ELEMENT_WARNING} elements, which can slow the Map` : null,
    },
  };
}

/**
 * Creates the reader for the definition and the icon folder. It reads from
 * disk per call, like the harness registry, and memoizes each file by its
 * modification time and size so a Map cadence re-parses nothing unchanged.
 */
export function createMapKindsCatalog({ root, repository = null, commit = null, stage = null, writable = true, reportError = console.error }) {
  const definitionPath = path.join(root, MAP_KINDS_FILE);
  const iconsPath = path.join(root, MAP_ICONS_FOLDER);
  const memo = new Map();
  let starterWrite = null;

  /** Reads one file through the modification-time memo, or null when absent. */
  async function readMemoized(file, project) {
    let info;
    try { info = await stat(file); }
    catch (error) { if (error.code === "ENOENT" || error.code === "ENOTDIR") { memo.delete(file); return null; } throw error; }
    if (info.size > MAX_ICON_BYTES) return { value: null, problem: `${path.basename(file)}: the file is too large` };
    const hit = memo.get(file);
    if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size) return hit.entry;
    const text = await readFile(file, "utf8");
    const entry = { text, value: project(text) };
    memo.set(file, { mtimeMs: info.mtimeMs, size: info.size, entry });
    return entry;
  }

  /** Lists the icon files in the folder, newest read wins; an absent folder is empty. */
  async function listIconFiles() {
    let names = [];
    try { names = await readdir(iconsPath); }
    catch (error) { if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error; return []; }
    return names
      .map((entry) => ({ name: path.basename(entry, path.extname(entry)), extension: path.extname(entry), file: path.join(iconsPath, entry) }))
      .filter((entry) => ICON_EXTENSIONS.has(entry.extension) && SAFE_ICON_NAME.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /** Writes one starter file atomically without disturbing a file already there. */
  async function writeStarterFile(file, text) {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tangent-${process.pid}-${Date.now()}.tmp`;
    await writeFile(temporary, text, "utf8");
    await rename(temporary, file);
  }

  /**
   * Writes the starter definition and the starter icons once per process, and
   * only into a vault that has neither. A failed write is a problem on the
   * catalog, never a failed Map load.
   */
  async function writeStarters(needDefinition, needIcons) {
    starterWrite ??= (async () => {
      const written = [];
      if (needDefinition) {
        if (repository) await repository.writeMarkdown(MAP_KINDS_FILE, MAP_KINDS_STARTER_TEXT);
        else await writeStarterFile(definitionPath, MAP_KINDS_STARTER_TEXT);
        written.push(MAP_KINDS_FILE);
      }
      if (needIcons) {
        for (const icon of starterMapIconFiles()) {
          await writeStarterFile(path.join(iconsPath, icon.file), icon.text);
          written.push(`${MAP_ICONS_FOLDER}/${icon.file}`);
        }
      }
      for (const file of written) await stage?.(file);
      if (written.length && commit) await commit(written, "add: machine map kinds starter", "machine", null);
      return written;
    })().catch((error) => {
      reportError(`map kinds starter write failed: ${String(error?.message ?? error).slice(0, 200)}`);
      return null;
    });
    return starterWrite;
  }

  /** Reads the definition and every icon into one catalog with its revision. */
  async function read() {
    const problems = [];
    let definition = await readMemoized(definitionPath, (text) => text);
    let files = await listIconFiles();
    let source = "vault";
    if ((!definition || !files.length) && writable) {
      const written = await writeStarters(!definition, !files.length);
      if (written === null) {
        problems.push({ scope: "definition", name: null, message: "Could not write the starter definition" });
        source = "starter";
      }
      definition = await readMemoized(definitionPath, (text) => text);
      files = await listIconFiles();
    }
    const text = definition?.text ?? (definition ? "" : MAP_KINDS_STARTER_TEXT);
    if (!definition) source = "starter";
    const icons = {};
    const parts = [text];
    for (const entry of files) {
      const loaded = await readMemoized(entry.file, (body) => readMapIcon(entry.name, body, entry.extension));
      if (!loaded) continue;
      parts.push(loaded.text ?? "");
      const value = loaded.value ?? { problem: loaded.problem };
      if (value.problem) { problems.push({ scope: "icon", name: entry.name, message: value.problem }); continue; }
      if (value.icon.warning) problems.push({ scope: "icon", name: entry.name, message: value.icon.warning });
      icons[entry.name] = value.icon;
    }
    const parsed = parseMapKinds(text, new Set(Object.keys(icons)));
    if (parsed.error) problems.push({ scope: "definition", name: null, message: parsed.error });
    for (const entry of parsed.kinds) {
      for (const problem of entry.problems) problems.push({ scope: "entry", name: entry.id, message: problem });
    }
    return {
      revision: createHash("sha256").update(parts.join(" ")).digest("hex"),
      source,
      kinds: parsed.kinds,
      icons,
      problems,
    };
  }

  return { read };
}

export default { MAP_ICONS_FOLDER, MAP_KINDS_FILE, MAP_KINDS_TAG, createMapKindsCatalog, parseMapKinds, readMapIcon };
