// Figures: a Map Block whose kind has an icon renders as one large icon with a
// caption beside it. An icon is either an Excalidraw drawing or an image file
// (PNG, SVG, WebP, JPEG); both end as locked ephemeral scene elements. This
// module owns the shared vocabulary of the Map kinds definition (states, verbs,
// built-in ids, icon file types) and the pure geometry that turns one icon into
// those elements. It performs no I/O, imports nothing, and is read by both the
// server parser and the browser projection.
// Design: docs/design/map-resource-icons/code.md

/** The inset between the Block edge and the icon square. */
const FIGURE_INSET = 14;
/** The vertical margin above and below the icon square. */
const FIGURE_MARGIN = 12;
/** The gap between the icon square and the caption. */
const CAPTION_GAP = 10;
/** The most icon elements one drawing may hold before Tangent warns. */
export const ICON_ELEMENT_WARNING = 200;
/** The most icon elements one drawing may hold at all. */
export const ICON_ELEMENT_LIMIT = 1_000;

/** The Excalidraw file types one icon name can resolve to. */
export const MAP_ICON_DRAWING_EXTENSIONS = Object.freeze([".excalidraw", ".excalidrawlib"]);

/**
 * The image file types one icon name can resolve to, with the media type each
 * one carries into Excalidraw. Julian draws icons where he likes and drops the
 * picture in, so a name resolves to whichever of these files carries it.
 */
export const MAP_ICON_IMAGE_TYPES = Object.freeze({
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
});

/** The target types one kind entry can declare. */
export const MAP_KIND_TARGETS = Object.freeze(["path", "url", "vault"]);

/** The state words Tangent reports for every target type. */
const SHARED_STATES = Object.freeze(["gone", "unresolved", "duplicate", "checking", "last-known", "unavailable"]);

/** The state words Tangent reports for one target type, beside the shared words. */
export const MAP_KIND_STATES = Object.freeze({
  shared: SHARED_STATES,
  path: Object.freeze(["available", "missing", "not-a-worktree", "access-denied", "branch", "detached", "bare", "clean", "dirty"]),
  url: Object.freeze(["success", "neutral", "muted", "unreachable"]),
  vault: Object.freeze(["live"]),
});

/** The click verbs allowed for one target type. Each is an existing Map action. */
export const MAP_KIND_VERBS = Object.freeze({
  path: Object.freeze(["copy-path", "details"]),
  url: Object.freeze(["open", "details"]),
  vault: Object.freeze(["open-document", "open-goal", "open-brain"]),
});

/** The kind ids Tangent already knows, with the target each one always has. */
export const BUILT_IN_MAP_KINDS = Object.freeze({
  worktree: Object.freeze({ target: "path", provider: null }),
  repository: Object.freeze({ target: "path", provider: null }),
  link: Object.freeze({ target: "url", provider: null }),
  "github-pr": Object.freeze({ target: "url", provider: "github-pr" }),
  "phabricator-revision": Object.freeze({ target: "url", provider: "phabricator-revision" }),
  commit: Object.freeze({ target: "vault", provider: null }),
  goal: Object.freeze({ target: "vault", provider: null }),
  document: Object.freeze({ target: "vault", provider: null }),
  area: Object.freeze({ target: "vault", provider: null }),
  brain: Object.freeze({ target: "vault", provider: null }),
  agent: Object.freeze({ target: "vault", provider: null }),
});

/** Reports whether one `when` word is a state Tangent can report for a target. */
export function isMapKindState(target, word) {
  return SHARED_STATES.includes(word) || (MAP_KIND_STATES[target] ?? []).includes(word);
}

/** Reports whether one verb is allowed for a target type. */
export function isMapKindVerb(target, verb) {
  return (MAP_KIND_VERBS[target] ?? []).includes(verb);
}

/** Returns the side of the square the icon fills inside one Block. */
export function figureIconBox(block) {
  return Math.max(24, Number(block?.height ?? 0) - FIGURE_MARGIN * 2);
}

/** Returns the caption geometry that puts the bound text beside the icon. */
export function figureCaptionGeometry(block) {
  const iconBox = figureIconBox(block);
  return {
    x: Number(block.x) + FIGURE_INSET + iconBox + CAPTION_GAP,
    y: Number(block.y) + FIGURE_MARGIN,
    width: Math.max(40, Number(block.width) - iconBox - FIGURE_INSET * 2 - CAPTION_GAP),
    height: Math.max(24, Number(block.height) - FIGURE_MARGIN * 2),
    textAlign: "left",
    verticalAlign: "middle",
  };
}

/**
 * Returns the icon name one entry gives a Block in these states: the first
 * `icons` rule whose `when` state is present, else the entry's default icon.
 * An entry with a problem never draws a figure.
 */
export function figureIconName(entry, states = []) {
  if (!entry || (entry.problems ?? []).length) return null;
  const present = new Set(states);
  for (const rule of entry.icons ?? []) if (rule?.when && present.has(rule.when)) return rule.icon;
  return entry.icon ?? null;
}

/**
 * Returns the entry and icon drawing one fact resolves to, or null when the
 * Block stays a card: no catalog, no entry, an entry with a problem, no icon
 * name, or an icon name that names no drawing.
 */
export function figureForFact(figures, fact) {
  const entry = figures?.kinds?.get?.(fact?.kindId) ?? null;
  const iconName = figureIconName(entry, fact?.states ?? []);
  const icon = iconName ? figures?.icons?.[iconName] ?? null : null;
  return icon ? { entry, iconName, icon } : null;
}

// The Map runs Excalidraw's dark theme, which puts `invert(93%)
// hue-rotate(180deg)` on the canvas element, while the Map's own ground stays
// light. A filled card survives that: its light-blue fill lands dark and its
// ink lands white on top. A figure has no fill, so ink drawn the ordinary way
// lands near-white on a near-white ground and disappears. The projection
// therefore stores the colour the filter turns back into the drawn colour, so
// an icon renders as Julian drew it.
const THEME_INVERT = 0.93;
const HUE_ROTATE_HALF_TURN = [
  [-0.574, 1.430, 0.144],
  [0.426, 0.430, 0.144],
  [0.426, 1.430, -0.856],
];

/** Returns one plain hex colour as red, green, and blue, or null. */
function hexChannels(value) {
  const text = String(value ?? "").trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(text);
  if (short) return [short[1], short[2], short[3]].map((part) => Number.parseInt(`${part}${part}`, 16));
  if (long) return [long[1], long[2], long[3]].map((part) => Number.parseInt(part, 16));
  return null;
}

/** Returns the colour to store so the Map's theme filter renders the drawn colour. */
export function themeInkColor(value) {
  const channels = hexChannels(value);
  if (!channels) return value;
  const inverted = channels.map((channel) => channel * (1 - THEME_INVERT) + (255 - channel) * THEME_INVERT);
  const rotated = HUE_ROTATE_HALF_TURN.map((row) => row.reduce((total, weight, index) => total + weight * inverted[index], 0));
  return `#${rotated.map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")).join("")}`;
}

/** Scales one point list without changing its origin. */
function scalePoints(points, scale) {
  return points.map((point) => (Array.isArray(point) ? point.map((value) => Number(value) * scale) : point));
}

/**
 * Returns the bounding box of one icon's elements, so a drawing made at any
 * size and origin scales into the Block's icon square.
 */
export function iconBounds(elements) {
  const boxes = elements.map((element) => ({
    minX: Number(element.x ?? 0), minY: Number(element.y ?? 0),
    maxX: Number(element.x ?? 0) + Number(element.width ?? 0), maxY: Number(element.y ?? 0) + Number(element.height ?? 0),
  }));
  if (!boxes.length) return { x: 0, y: 0, width: 1, height: 1 };
  const minX = Math.min(...boxes.map((box) => box.minX));
  const minY = Math.min(...boxes.map((box) => box.minY));
  return {
    x: minX, y: minY,
    width: Math.max(1, Math.max(...boxes.map((box) => box.maxX)) - minX),
    height: Math.max(1, Math.max(...boxes.map((box) => box.maxY)) - minY),
  };
}

/**
 * Returns the Excalidraw file id one image icon's bytes are registered under.
 * Excalidraw draws an image element by looking its `fileId` up in the files it
 * holds, so the id has to be the same on every frame the icon is drawn, and it
 * has to change when the bytes change. The name and the content hash give both.
 */
export function figureIconFileId(iconName, contentHash) {
  return `tangent-icon-${String(iconName ?? "icon")}-${String(contentHash ?? "0")}`;
}

/** Returns the customData every element of one figure icon carries. */
function figureIconCustomData({ block, iconName, owner, sourceId, index }) {
  return {
    tangentWorldEphemeral: { kind: "resource-figure-icon", sourceId: block.id, icon: String(iconName ?? "") },
    ...(owner ? { tangentWorld: { owner, sourceId: `${sourceId ?? block.id}-icon-${index}` } } : {}),
  };
}

/**
 * Creates the one locked image element that draws an image icon. The picture
 * keeps its aspect ratio inside the Block's icon square, and the square is the
 * same square a drawing fills, so an image icon and a drawn icon sit alike.
 */
function createImageFigureElement({ block, icon, iconName, opacity, owner, sourceId }) {
  const iconBox = figureIconBox(block);
  const width = Math.max(1, Number(icon.width));
  const height = Math.max(1, Number(icon.height));
  const scale = Math.min(iconBox / width, iconBox / height);
  const drawnWidth = width * scale;
  const drawnHeight = height * scale;
  return [{
    id: `${block.id}-tangent-icon-0`,
    type: "image",
    x: Number(block.x) + FIGURE_INSET + (iconBox - drawnWidth) / 2,
    y: Number(block.y) + (Number(block.height) - drawnHeight) / 2,
    width: drawnWidth,
    height: drawnHeight,
    angle: 0,
    strokeColor: "transparent",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    roundness: null,
    opacity,
    groupIds: [],
    frameId: null,
    boundElements: null,
    link: null,
    locked: true,
    isDeleted: false,
    seed: 1,
    version: 1,
    versionNonce: 1,
    updated: 1,
    index: null,
    fileId: figureIconFileId(iconName, icon.contentHash),
    status: "saved",
    scale: [1, 1],
    crop: null,
    customData: figureIconCustomData({ block, iconName, owner, sourceId, index: 0 }),
  }];
}

/**
 * Returns the Excalidraw `files` entries the image icons in one projection
 * need. Excalidraw draws an image element only once its file id is registered,
 * so the Map registers these before it hands the elements to the canvas.
 */
export function figureIconFiles(elements, icons = {}, created = 0) {
  const files = new Map();
  for (const element of elements ?? []) {
    if (element?.type !== "image" || element.isDeleted || !element.fileId) continue;
    const ephemeral = element.customData?.tangentWorldEphemeral;
    if (ephemeral?.kind !== "resource-figure-icon") continue;
    const icon = icons?.[ephemeral.icon] ?? null;
    if (icon?.kind !== "image" || !icon.dataURL || files.has(element.fileId)) continue;
    files.set(element.fileId, { id: element.fileId, mimeType: icon.mimeType, dataURL: icon.dataURL, created });
  }
  return [...files.values()];
}

/**
 * Creates the locked ephemeral elements that draw one icon inside a Block.
 * They carry the same customData shape as the success rail, so every consumer
 * that already drops, hides, or ignores an ephemeral element handles them.
 */
export function createFigureElements({ block, icon, iconName, opacity = 100, owner = null, sourceId = null }) {
  if (icon?.kind === "image") {
    return icon.dataURL ? createImageFigureElement({ block, icon, iconName, opacity, owner, sourceId }) : [];
  }
  const elements = icon?.elements ?? [];
  if (!elements.length) return [];
  const iconBox = figureIconBox(block);
  const scale = Math.min(iconBox / Math.max(1, Number(icon.width)), iconBox / Math.max(1, Number(icon.height)));
  const originX = Number(block.x) + FIGURE_INSET + (iconBox - Number(icon.width) * scale) / 2;
  const originY = Number(block.y) + (Number(block.height) - Number(icon.height) * scale) / 2;
  const ids = new Map(elements.map((element, index) => [element.id, `${block.id}-tangent-icon-${index}`]));
  /** Keeps a binding only when it points at another element of the same icon. */
  const bound = (id) => (id && ids.has(id) ? ids.get(id) : null);
  return elements.map((element, index) => {
    const next = structuredClone(element);
    next.id = ids.get(element.id);
    next.x = originX + Number(element.x ?? 0) * scale;
    next.y = originY + Number(element.y ?? 0) * scale;
    next.width = Math.max(0, Number(element.width ?? 0) * scale);
    next.height = Math.max(0, Number(element.height ?? 0) * scale);
    if (Array.isArray(element.points)) next.points = scalePoints(element.points, scale);
    if (Array.isArray(element.lastCommittedPoint)) next.lastCommittedPoint = scalePoints([element.lastCommittedPoint], scale)[0];
    if (element.type === "text") next.fontSize = Math.max(1, Number(element.fontSize ?? 20) * scale);
    next.containerId = bound(element.containerId);
    next.boundElements = Array.isArray(element.boundElements)
      ? element.boundElements.filter((binding) => bound(binding?.id)).map((binding) => ({ ...binding, id: bound(binding.id) }))
      : null;
    for (const field of ["startBinding", "endBinding"]) {
      const binding = element[field];
      next[field] = binding?.elementId && bound(binding.elementId) ? { ...binding, elementId: bound(binding.elementId) } : null;
    }
    next.strokeColor = themeInkColor(element.strokeColor);
    if (element.backgroundColor && element.backgroundColor !== "transparent") next.backgroundColor = themeInkColor(element.backgroundColor);
    next.groupIds = [];
    next.frameId = null;
    next.link = null;
    next.locked = true;
    next.isDeleted = false;
    next.opacity = opacity;
    next.version = 1;
    next.versionNonce = Number(element.versionNonce ?? element.seed ?? 1) || 1;
    next.customData = figureIconCustomData({ block, iconName, owner, sourceId, index });
    return next;
  });
}

/** Returns the cache key that identifies one drawn icon instance exactly. */
export function figureCacheKey(block, iconName, opacity) {
  return [block.id, iconName, block.x, block.y, block.width, block.height, opacity].join(" ");
}

/**
 * Returns the composed presentation this figure replaced, so `publish` can put
 * it back. The marker holds the exact composed values, which makes the restore
 * independent of the composition the projection ran on.
 */
export function figurePresentationMarker(element, fields) {
  return Object.fromEntries(fields.map((field) => [field, element[field]]));
}

/**
 * Puts the composed body style, opacity, and caption geometry back on every
 * element the projection turned into a figure, and removes the marker. Nothing
 * a definition owns may reach a source shard.
 *
 * A caption records its offset from its Block, never an absolute point: the
 * Block may have moved since the projection, and the caption has to land where
 * the drag left it.
 */
export function restoreFigurePresentation(elements) {
  const byId = new Map((elements ?? []).map((element) => [element.id, element]));
  return (elements ?? []).map((element) => {
    const marker = element?.customData?.tangentWorldFigure;
    if (!marker || typeof marker !== "object") return element;
    const { containerId = null, dx = 0, dy = 0, ...fields } = marker;
    const customData = { ...element.customData };
    delete customData.tangentWorldFigure;
    const next = { ...element, ...fields, customData };
    const container = containerId ? byId.get(containerId) : null;
    if (container) { next.x = Number(container.x) + dx; next.y = Number(container.y) + dy; }
    return next;
  });
}

export default {
  BUILT_IN_MAP_KINDS,
  ICON_ELEMENT_LIMIT,
  ICON_ELEMENT_WARNING,
  MAP_ICON_DRAWING_EXTENSIONS,
  MAP_ICON_IMAGE_TYPES,
  MAP_KIND_STATES,
  MAP_KIND_TARGETS,
  MAP_KIND_VERBS,
  createFigureElements,
  figureCacheKey,
  figureIconFileId,
  figureIconFiles,
  figureCaptionGeometry,
  figureForFact,
  figureIconBox,
  figureIconName,
  figurePresentationMarker,
  iconBounds,
  isMapKindState,
  themeInkColor,
  isMapKindVerb,
  restoreFigurePresentation,
};
