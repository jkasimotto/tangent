import { createHash } from "node:crypto";
import path from "node:path";
import { createEmptyScene, legacyCanvasToExcalidraw, splitReference, tangentOf } from "./public/area-board-core.js";
import { isSafeResourceId } from "./public/area-map-entities.js";

export const EMPTY_AREA_CANVAS = Object.freeze(createEmptyScene());
export const AREA_BOARD_VIEW_SCHEMA = "area-board-view.v1";

const ELEMENT_TYPES = new Set(["rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text", "frame", "magicframe", "image", "embeddable", "iframe"]);
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ELEMENTS = 5_000;
const MAX_FILES = 200;

/** Returns the optimistic-concurrency hash for serialized scene text. */
export const canvasHash = (text) => createHash("sha256").update(text).digest("hex");

/** Resolves one canonical Excalidraw path for an Area. */
export function areaCanvasPath(area) {
  if (typeof area !== "string" || !area || area.startsWith("/") || area.includes("\\")) return null;
  const normalized = path.posix.normalize(area);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../") || normalized !== area) return null;
  const leaf = path.posix.basename(normalized);
  return `${normalized}/${leaf}.excalidraw`;
}

/** Resolves the former JSON Canvas path for one migration read. */
export function legacyAreaCanvasPath(area) {
  const scene = areaCanvasPath(area);
  return scene ? scene.replace(/\.excalidraw$/, ".canvas") : null;
}

/** Resolves a vault-relative Area-map path without traversal. */
export function safeCanvasPath(root, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || !/\.(?:excalidraw|canvas)$/.test(relative) || relative.includes("\\")) return null;
  const normalized = path.posix.normalize(relative);
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) return null;
  const absolute = path.resolve(root, normalized);
  return absolute.startsWith(`${path.resolve(root)}${path.sep}`) ? { relative: normalized, absolute } : null;
}

/** Records an error when a scene coordinate is not finite and bounded. */
function finite(value, name, errors) {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 100_000_000) errors.push(`${name} must be a finite scene number`);
}

/** Records an error when an authored string is absent, unsafe, or too large. */
function safeString(value, name, errors, { required = false, max = 100_000 } = {}) {
  if ((required || value !== undefined && value !== null) && (typeof value !== "string" || required && !value || value.length > max || value.includes("\0"))) errors.push(`${name} must be ${required ? "a non-empty " : "a "}safe string`);
}

/** Validates the Excalidraw envelope while preserving forward-compatible element fields. */
export function validateAreaCanvas(scene) {
  const errors = [];
  const warnings = [];
  if (!scene || typeof scene !== "object" || Array.isArray(scene)) return { ok: false, errors: ["scene must be an object"], warnings };
  if (scene.type !== "excalidraw") errors.push("scene.type must be excalidraw");
  if (!Number.isInteger(scene.version) || scene.version < 1 || scene.version > 100) errors.push("scene.version must be a supported integer");
  safeString(scene.source, "scene.source", errors, { max: 2_000 });
  if (scene.tangent !== undefined && (!scene.tangent || typeof scene.tangent !== "object" || Array.isArray(scene.tangent) || !Number.isInteger(scene.tangent.format) || scene.tangent.format < 1)) errors.push("scene.tangent.format must be a positive integer");
  if (!Array.isArray(scene.elements)) errors.push("scene.elements must be an array");
  if (!scene.appState || typeof scene.appState !== "object" || Array.isArray(scene.appState)) errors.push("scene.appState must be an object");
  if (!scene.files || typeof scene.files !== "object" || Array.isArray(scene.files)) errors.push("scene.files must be an object");
  if (!Array.isArray(scene.elements)) return { ok: false, errors, warnings };
  if (scene.elements.length > MAX_ELEMENTS) errors.push(`scene must contain at most ${MAX_ELEMENTS} elements`);
  if (scene.files && typeof scene.files === "object" && Object.keys(scene.files).length > MAX_FILES) errors.push(`scene must contain at most ${MAX_FILES} files`);
  const ids = new Set();
  for (const [index, element] of scene.elements.entries()) {
    const at = `elements[${index}]`;
    if (!element || typeof element !== "object" || Array.isArray(element)) { errors.push(`${at} must be an object`); continue; }
    safeString(element.id, `${at}.id`, errors, { required: true, max: 256 });
    if (ids.has(element.id)) errors.push(`duplicate id: ${element.id}`); else ids.add(element.id);
    if (!ELEMENT_TYPES.has(element.type)) errors.push(`${at}.type is unsupported`);
    for (const field of ["x", "y", "width", "height", "angle", "opacity", "strokeWidth", "roughness"]) finite(element[field], `${at}.${field}`, errors);
    if (typeof element.width === "number" && element.width < 0 || typeof element.height === "number" && element.height < 0) errors.push(`${at} dimensions cannot be negative`);
    safeString(element.strokeColor, `${at}.strokeColor`, errors, { max: 100 });
    safeString(element.backgroundColor, `${at}.backgroundColor`, errors, { max: 100 });
    safeString(element.link, `${at}.link`, errors, { max: 8_000 });
    if (element.type === "text") { safeString(element.text, `${at}.text`, errors, { max: 500_000 }); safeString(element.originalText, `${at}.originalText`, errors, { max: 500_000 }); }
    const tangent = element.customData?.tangent;
    if (tangent !== undefined && !tangentOf(element)) errors.push(`${at}.customData.tangent must contain a supported kind and string ref`);
    else if (tangent?.kind === "resource" && !isSafeResourceId(tangent.ref)) errors.push(`${at}.customData.tangent resource ref must be a safe opaque ID`);
  }
  const bindings = [];
  for (const element of scene.elements) {
    for (const binding of [element.startBinding, element.endBinding]) if (binding?.elementId) bindings.push([element.id, binding.elementId]);
    if (element.containerId) bindings.push([element.id, element.containerId]);
    for (const bound of element.boundElements ?? []) if (bound?.id) bindings.push([element.id, bound.id]);
  }
  for (const [from, to] of bindings) if (!ids.has(to)) warnings.push(`${from} binds to missing element ${to}`);
  return { ok: errors.length === 0, errors, warnings };
}

/** Parses one Excalidraw scene without normalizing authored fields or order. */
export function parseAreaCanvas(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_BYTES) return { ok: false, errors: [`scene must be at most ${MAX_BYTES} bytes`], warnings: [] };
  let scene;
  try { scene = JSON.parse(text); } catch (error) { return { ok: false, errors: [`invalid JSON: ${error.message}`], warnings: [] }; }
  const result = validateAreaCanvas(scene);
  return { ...result, ...(result.ok ? { canvas: scene, scene } : {}) };
}

/** Serializes one complete Excalidraw scene. */
export function serializeAreaCanvas(scene) {
  const result = validateAreaCanvas(scene);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return `${JSON.stringify(scene, null, 2)}\n`;
}

/** Projects the authored scene into the compact read model used by Area detail. */
export function areaCanvasSummary(scene) {
  const elements = Array.isArray(scene?.elements) ? scene.elements.filter((element) => !element.isDeleted) : [];
  const byId = new Map(elements.map((element) => [element.id, element]));
  return {
    references: elements.flatMap((element) => {
      const tangent = tangentOf(element);
      if (!tangent) return [];
      if (tangent.kind === "resource") return [{ id: element.id, resourceId: tangent.ref }];
      const reference = splitReference(tangent.ref);
      return reference.url ? [{ id: element.id, url: reference.url }] : [{ id: element.id, file: reference.file, subpath: reference.subpath ?? null }];
    }),
    ink: elements.filter((element) => element.type === "text" && !element.containerId).map((element) => ({ id: element.id, text: element.text })),
    frames: elements.filter((element) => element.type === "frame").map((element) => ({ id: element.id, label: element.name ?? "" })),
    arrows: elements.filter((element) => element.type === "arrow").map((element) => {
      const label = (element.boundElements ?? []).map((binding) => byId.get(binding.id)).find((bound) => bound?.type === "text")?.text ?? element.customData?.label ?? "";
      return { id: element.id, from: element.startBinding?.elementId ?? null, to: element.endBinding?.elementId ?? null, label };
    }),
  };
}

/** Parses the former JSON Canvas only for one-way conversion. */
export function parseLegacyAreaCanvas(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_BYTES) return { ok: false, errors: ["legacy canvas is too large"] };
  try {
    const legacy = JSON.parse(text);
    if (!legacy || typeof legacy !== "object" || !Array.isArray(legacy.nodes ?? []) || !Array.isArray(legacy.edges ?? [])) return { ok: false, errors: ["legacy canvas is invalid"] };
    return { ok: true, canvas: legacyCanvasToExcalidraw(legacy) };
  } catch (error) { return { ok: false, errors: [`invalid legacy JSON: ${error.message}`] }; }
}

/** Returns private viewport defaults kept outside the authored scene. */
export function defaultAreaBoardView() {
  return { schema: AREA_BOARD_VIEW_SCHEMA, pan: { x: 0, y: 0 }, zoom: 1, foldedGroupIds: [], openInlineAreaNodeIds: [], hiddenKinds: [], showDone: false };
}
