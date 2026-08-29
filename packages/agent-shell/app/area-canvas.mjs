import { createHash } from "node:crypto";
import path from "node:path";

export const EMPTY_AREA_CANVAS = Object.freeze({ nodes: [], edges: [] });
export const AREA_BOARD_VIEW_SCHEMA = "area-board-view.v1";

const NODE_FIELDS = {
  text: new Set(["id", "type", "text", "x", "y", "width", "height", "color"]),
  file: new Set(["id", "type", "file", "subpath", "x", "y", "width", "height", "color"]),
  link: new Set(["id", "type", "url", "x", "y", "width", "height", "color"]),
  group: new Set(["id", "type", "label", "background", "backgroundStyle", "x", "y", "width", "height", "color"]),
};
const EDGE_FIELDS = new Set(["id", "fromNode", "fromSide", "fromEnd", "toNode", "toSide", "toEnd", "color", "label"]);
const SIDES = new Set(["top", "right", "bottom", "left"]);
const ENDS = new Set(["none", "arrow"]);
const BACKGROUND_STYLES = new Set(["cover", "ratio", "repeat"]);
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ITEMS = 10_000;
const MAX_TEXT = 100_000;

export const canvasHash = (text) => createHash("sha256").update(text).digest("hex");

/** Resolves one canonical canvas path for an Area. */
export function areaCanvasPath(area) {
  if (typeof area !== "string" || !area || area.startsWith("/") || area.includes("\\")) return null;
  const normalized = path.posix.normalize(area);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../") || normalized !== area) return null;
  const leaf = path.posix.basename(normalized);
  return `${normalized}/${leaf}.canvas`;
}

/** Resolves a vault-relative JSON Canvas path without traversal. */
export function safeCanvasPath(root, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || !relative.endsWith(".canvas") || relative.includes("\\")) return null;
  const normalized = path.posix.normalize(relative);
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) return null;
  const absolute = path.resolve(root, normalized);
  return absolute.startsWith(`${path.resolve(root)}${path.sep}`) ? { relative: normalized, absolute } : null;
}

function finite(value, name, errors) {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1_000_000) errors.push(`${name} must be a finite canvas coordinate`);
}

function shortString(value, name, errors, { required = false, max = MAX_TEXT } = {}) {
  if ((required || value !== undefined) && (typeof value !== "string" || (required && !value) || value.length > max || value.includes("\0"))) errors.push(`${name} must be ${required ? "a non-empty " : "a "}safe string`);
}

function unknownFields(value, allowed) {
  return Object.keys(value).filter((field) => !allowed.has(field));
}

/** Validates the standards-only JSON Canvas 1.0 profile. */
export function validateAreaCanvas(canvas) {
  const errors = [];
  const warnings = [];
  if (!canvas || typeof canvas !== "object" || Array.isArray(canvas)) return { ok: false, errors: ["canvas must be an object"], warnings };
  const envelopeUnknown = Object.keys(canvas).filter((field) => field !== "nodes" && field !== "edges");
  if (envelopeUnknown.length) errors.push(`unsupported canvas fields: ${envelopeUnknown.join(", ")}`);
  const nodes = canvas.nodes ?? [];
  const edges = canvas.edges ?? [];
  if (!Array.isArray(nodes)) errors.push("nodes must be an array");
  if (!Array.isArray(edges)) errors.push("edges must be an array");
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return { ok: false, errors, warnings };
  if (nodes.length > MAX_ITEMS || edges.length > MAX_ITEMS) errors.push(`canvas must contain at most ${MAX_ITEMS} nodes and edges`);
  const ids = new Set();
  for (const [index, node] of nodes.entries()) {
    const at = `nodes[${index}]`;
    if (!node || typeof node !== "object" || Array.isArray(node) || !NODE_FIELDS[node.type]) { errors.push(`${at} has an unsupported node type`); continue; }
    const unknown = unknownFields(node, NODE_FIELDS[node.type]);
    if (unknown.length) errors.push(`${at} has unsupported fields: ${unknown.join(", ")}`);
    shortString(node.id, `${at}.id`, errors, { required: true, max: 200 });
    if (ids.has(node.id)) errors.push(`duplicate id: ${node.id}`); else ids.add(node.id);
    for (const field of ["x", "y", "width", "height"]) finite(node[field], `${at}.${field}`, errors);
    if (typeof node.width === "number" && node.width <= 0 || typeof node.height === "number" && node.height <= 0) errors.push(`${at} dimensions must be positive`);
    shortString(node.color, `${at}.color`, errors, { max: 100 });
    if (node.type === "text") shortString(node.text, `${at}.text`, errors, { required: true });
    if (node.type === "file") { shortString(node.file, `${at}.file`, errors, { required: true, max: 2_000 }); shortString(node.subpath, `${at}.subpath`, errors, { max: 2_000 }); if (node.subpath !== undefined && !node.subpath.startsWith("#")) errors.push(`${at}.subpath must start with #`); }
    if (node.type === "link") shortString(node.url, `${at}.url`, errors, { required: true, max: 8_000 });
    if (node.type === "group") { shortString(node.label, `${at}.label`, errors); shortString(node.background, `${at}.background`, errors, { max: 8_000 }); if (node.backgroundStyle !== undefined && !BACKGROUND_STYLES.has(node.backgroundStyle)) errors.push(`${at}.backgroundStyle is unsupported`); }
  }
  for (const [index, edge] of edges.entries()) {
    const at = `edges[${index}]`;
    if (!edge || typeof edge !== "object" || Array.isArray(edge)) { errors.push(`${at} must be an object`); continue; }
    const unknown = unknownFields(edge, EDGE_FIELDS);
    if (unknown.length) errors.push(`${at} has unsupported fields: ${unknown.join(", ")}`);
    shortString(edge.id, `${at}.id`, errors, { required: true, max: 200 });
    if (ids.has(edge.id)) errors.push(`duplicate id: ${edge.id}`); else ids.add(edge.id);
    for (const endpoint of ["fromNode", "toNode"]) { shortString(edge[endpoint], `${at}.${endpoint}`, errors, { required: true, max: 200 }); if (!nodes.some((node) => node.id === edge[endpoint])) errors.push(`${at}.${endpoint} does not name a node`); }
    for (const side of ["fromSide", "toSide"]) if (edge[side] !== undefined && !SIDES.has(edge[side])) errors.push(`${at}.${side} is unsupported`);
    for (const end of ["fromEnd", "toEnd"]) if (edge[end] !== undefined && !ENDS.has(edge[end])) errors.push(`${at}.${end} is unsupported`);
    shortString(edge.color, `${at}.color`, errors, { max: 100 }); shortString(edge.label, `${at}.label`, errors);
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** Parses JSON Canvas text without normalizing authored field or array order. */
export function parseAreaCanvas(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_BYTES) return { ok: false, errors: [`canvas must be at most ${MAX_BYTES} bytes`], warnings: [] };
  let canvas;
  try { canvas = JSON.parse(text); } catch (error) { return { ok: false, errors: [`invalid JSON: ${error.message}`], warnings: [] }; }
  const result = validateAreaCanvas(canvas);
  return { ...result, ...(result.ok ? { canvas } : {}) };
}

export function serializeAreaCanvas(canvas) {
  const result = validateAreaCanvas(canvas);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return `${JSON.stringify(canvas, null, 2)}\n`;
}

export function defaultAreaBoardView() {
  return { schema: AREA_BOARD_VIEW_SCHEMA, pan: { x: 0, y: 0 }, zoom: 1, foldedGroupIds: [], openInlineAreaNodeIds: [], hiddenKinds: [], showDone: false };
}
