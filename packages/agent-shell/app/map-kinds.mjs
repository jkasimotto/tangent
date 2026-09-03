// The Map kinds catalog: what each kind of thing looks like on a Map and what
// one click does with it. The server owns the definition (`map-kinds.md`) and
// the icons (`map-icons/`) in the vault, reads them per request the way the
// harness registry is read, and serves one catalog. An icon is either an
// Excalidraw drawing or an image file; both arrive at the browser ready to
// draw, so the browser parses no icon file of its own.
// Design: docs/design/map-resource-icons/code.md

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { validateSceneElements } from "./area-canvas.mjs";
import { fencedBlock } from "./launch-environment.mjs";
import { MAP_KINDS_STARTER_TEXT } from "./map-kind-starters.mjs";
import {
  BUILT_IN_MAP_KINDS, ICON_ELEMENT_LIMIT, ICON_ELEMENT_WARNING,
  MAP_ICON_DRAWING_EXTENSIONS, MAP_ICON_IMAGE_TYPES, MAP_KIND_TARGETS,
  iconBounds, isMapKindState, isMapKindVerb,
} from "./public/area-map-figures.js";

export const MAP_KINDS_FILE = "map-kinds.md";
export const MAP_ICONS_FOLDER = "map-icons";
export const MAP_KINDS_TAG = "tangent.map-kinds.v1";

const SAFE_KIND_ID = /^[a-z][a-z0-9-]{0,63}$/;
const SAFE_ICON_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ICON_EXTENSIONS = new Set([...MAP_ICON_DRAWING_EXTENSIONS, ...Object.keys(MAP_ICON_IMAGE_TYPES)]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** The CSS pixels one length unit an SVG may name is worth. */
const SVG_UNIT_PIXELS = Object.freeze({ px: 1, pt: 96 / 72, pc: 16, cm: 96 / 2.54, mm: 96 / 25.4, in: 96, q: 96 / 101.6 });
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
      kind: "drawing",
      width: bounds.width,
      height: bounds.height,
      elements: elements.map((element) => ({ ...element, x: Number(element.x ?? 0) - bounds.x, y: Number(element.y ?? 0) - bounds.y })),
      elementCount: elements.length,
      warning: elements.length > ICON_ELEMENT_WARNING ? `${name}: more than ${ICON_ELEMENT_WARNING} elements, which can slow the Map` : null,
    },
  };
}

/**
 * Reads the pixel size out of a PNG IHDR chunk. The signature is checked first,
 * so a file that only claims the extension is a problem, never a broken picture.
 */
function pngSize(bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (bytes.toString("latin1", 12, 16) !== "IHDR") return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Reads the pixel size out of the first frame header of a JPEG. */
function jpegSize(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    // The standalone markers carry no length word, so they are stepped over.
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { at += 2; continue; }
    const length = bytes.readUInt16BE(at + 2);
    if (length < 2) return null;
    // C0 to CF are the frame headers, apart from the three table markers among them.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const height = bytes.readUInt16BE(at + 5);
      const width = bytes.readUInt16BE(at + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    at += 2 + length;
  }
  return null;
}

/** Reads the pixel size out of a WebP VP8, VP8L, or VP8X chunk. */
function webpSize(bytes) {
  if (bytes.length < 26 || bytes.toString("latin1", 0, 4) !== "RIFF" || bytes.toString("latin1", 8, 12) !== "WEBP") return null;
  const chunk = bytes.toString("latin1", 12, 16);
  if (chunk === "VP8 ") {
    if (bytes.length < 30 || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return null;
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    if (bytes.length < 30) return null;
    return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  }
  return null;
}

/** Returns the attributes of one XML start tag, by lower-case name. */
function xmlAttributes(text) {
  const attributes = {};
  const pattern = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match = pattern.exec(String(text ?? ""));
  while (match) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? "";
    match = pattern.exec(String(text ?? ""));
  }
  return attributes;
}

/**
 * Returns the single root element of one XML document, or null when the text is
 * not well-formed XML. An SVG icon has to really be XML with an `svg` root: a
 * file that only claims the extension is a problem, never a broken picture.
 */
function xmlRoot(text) {
  const body = String(text)
    .replace(/<\?[\s\S]*?\?>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, " ")
    .replace(/<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?[^>]*>/gi, " ");
  const tag = /<\s*(\/?)([A-Za-z_][\w.:-]*)((?:[^<>"']|"[^"]*"|'[^']*')*?)(\/?)\s*>/g;
  const open = [];
  let root = null;
  let read = 0;
  let match = tag.exec(body);
  while (match) {
    if (body.slice(read, match.index).includes("<")) return null;
    read = tag.lastIndex;
    const [, closing, name, attributes, selfClosing] = match;
    if (closing) {
      if (open.pop() !== name) return null;
    } else {
      if (!open.length) {
        if (root) return null;
        root = { name, attributes: xmlAttributes(attributes) };
      }
      if (!selfClosing) open.push(name);
    }
    match = tag.exec(body);
  }
  if (body.slice(read).includes("<")) return null;
  return open.length ? null : root;
}

/** Returns one SVG length in CSS pixels, or null for a percentage or a bad value. */
function svgLength(value) {
  const match = /^\s*([+-]?\d*\.?\d+(?:e[+-]?\d+)?)\s*(px|pt|pc|cm|mm|in|q)?\s*$/i.exec(String(value ?? ""));
  if (!match) return null;
  const size = Number(match[1]) * SVG_UNIT_PIXELS[(match[2] ?? "px").toLowerCase()];
  return Number.isFinite(size) && size > 0 ? size : null;
}

/** Reads the drawn size of one SVG from its width and height, else its viewBox. */
function svgSize(text) {
  const root = xmlRoot(text);
  if (!root || root.name.replace(/^.*:/, "").toLowerCase() !== "svg") return null;
  const width = svgLength(root.attributes.width);
  const height = svgLength(root.attributes.height);
  if (width && height) return { width, height };
  const box = String(root.attributes.viewbox ?? "").trim().split(/[\s,]+/).map(Number);
  if (box.length === 4 && box.every((value) => Number.isFinite(value)) && box[2] > 0 && box[3] > 0) return { width: box[2], height: box[3] };
  return null;
}

/** Returns the intrinsic size one image file's own header declares. */
function imageSize(bytes, mimeType) {
  if (mimeType === "image/png") return pngSize(bytes);
  if (mimeType === "image/jpeg") return jpegSize(bytes);
  if (mimeType === "image/webp") return webpSize(bytes);
  return svgSize(bytes.toString("utf8"));
}

/**
 * Reads one image icon into the normal form the projection draws: the bytes as
 * a data URL, with the intrinsic size read out of the file's own header. Node
 * decodes no picture here, so a file that lies about its type, and a truncated
 * one, are both a problem on the file, and every kind that names it stays a
 * card rather than showing a broken picture.
 */
export function readMapImageIcon(name, bytes, extension) {
  const mimeType = MAP_ICON_IMAGE_TYPES[extension] ?? null;
  if (!mimeType) return { problem: `${name}: ${extension} is not an icon file type` };
  const size = imageSize(bytes, mimeType);
  if (!size) return { problem: `${name}: not a readable ${mimeType.replace("image/", "").replace("+xml", "").toUpperCase()} image` };
  return {
    icon: {
      name,
      kind: "image",
      mimeType,
      dataURL: `data:${mimeType};base64,${bytes.toString("base64")}`,
      width: size.width,
      height: size.height,
      contentHash: createHash("sha256").update(bytes).digest("hex").slice(0, 16),
      warning: null,
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
  async function readMemoized(file, project, { binary = false } = {}) {
    let info;
    try { info = await stat(file); }
    catch (error) { if (error.code === "ENOENT" || error.code === "ENOTDIR") { memo.delete(file); return null; } throw error; }
    if (info.size > MAX_ICON_BYTES) return { value: null, problem: `${path.basename(file)}: the file is too large` };
    const hit = memo.get(file);
    if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size) return hit.entry;
    const body = await readFile(file, binary ? undefined : "utf8");
    // An image is bytes, not text, so the revision watches its digest instead.
    const entry = binary
      ? { digest: createHash("sha256").update(body).digest("hex"), value: project(body) }
      : { text: body, value: project(body) };
    memo.set(file, { mtimeMs: info.mtimeMs, size: info.size, entry });
    return entry;
  }

  /**
   * Lists one icon file per name; an absent folder is empty. An image wins over
   * a drawing of the same name, because Julian asked for pictures. The drawing
   * stays on disk, and the ambiguity is a problem that names both files, so the
   * Map says which one it drew.
   */
  async function listIconFiles() {
    let names = [];
    try { names = await readdir(iconsPath); }
    catch (error) { if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error; return { files: [], problems: [] }; }
    const byName = new Map();
    for (const entry of names) {
      const extension = path.extname(entry).toLowerCase();
      const name = path.basename(entry, path.extname(entry));
      if (!ICON_EXTENSIONS.has(extension) || !SAFE_ICON_NAME.test(name)) continue;
      const group = byName.get(name) ?? [];
      group.push({ name, extension, image: extension in MAP_ICON_IMAGE_TYPES, file: path.join(iconsPath, entry), fileName: entry });
      byName.set(name, group);
    }
    const files = [];
    const problems = [];
    for (const [name, group] of [...byName].sort(([left], [right]) => left.localeCompare(right))) {
      group.sort((left, right) => (left.image === right.image ? left.fileName.localeCompare(right.fileName) : left.image ? -1 : 1));
      files.push(group[0]);
      if (group.length > 1) problems.push({ scope: "icon", name, message: `${name}: ${group.map((entry) => entry.fileName).join(" and ")} share this icon name, so the Map draws ${group[0].fileName}` });
    }
    return { files, problems };
  }

  /** Writes one starter file atomically without disturbing a file already there. */
  async function writeStarterFile(file, text) {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tangent-${process.pid}-${Date.now()}.tmp`;
    await writeFile(temporary, text, "utf8");
    await rename(temporary, file);
  }

  /**
   * Writes the starter definition once per process, and only into a vault that
   * has none. Tangent writes no icon: `map-icons/` is Julian's own folder and
   * stays empty until he puts a file in it. A failed write is a problem on the
   * catalog, never a failed Map load.
   */
  async function writeStarterDefinition() {
    starterWrite ??= (async () => {
      if (repository) await repository.writeMarkdown(MAP_KINDS_FILE, MAP_KINDS_STARTER_TEXT);
      else await writeStarterFile(definitionPath, MAP_KINDS_STARTER_TEXT);
      await stage?.(MAP_KINDS_FILE);
      if (commit) await commit([MAP_KINDS_FILE], "add: machine map kinds starter", "machine", null);
      return [MAP_KINDS_FILE];
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
    const listed = await listIconFiles();
    let source = "vault";
    if (!definition && writable) {
      const written = await writeStarterDefinition();
      if (written === null) {
        problems.push({ scope: "definition", name: null, message: "Could not write the starter definition" });
        source = "starter";
      }
      definition = await readMemoized(definitionPath, (text) => text);
    }
    const text = definition?.text ?? (definition ? "" : MAP_KINDS_STARTER_TEXT);
    if (!definition) source = "starter";
    problems.push(...listed.problems);
    const icons = {};
    const parts = [text];
    for (const entry of listed.files) {
      /** Reads one icon file as the drawing or the image its extension says it is. */
      const project = (body) => (entry.image ? readMapImageIcon(entry.name, body, entry.extension) : readMapIcon(entry.name, body, entry.extension));
      const loaded = await readMemoized(entry.file, project, { binary: entry.image });
      if (!loaded) continue;
      parts.push(loaded.text ?? loaded.digest ?? "");
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

export default { MAP_ICONS_FOLDER, MAP_KINDS_FILE, MAP_KINDS_TAG, createMapKindsCatalog, parseMapKinds, readMapIcon, readMapImageIcon };
