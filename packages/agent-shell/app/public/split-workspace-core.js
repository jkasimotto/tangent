export const AREA_WORKSPACE_LAYOUT_KEY = "agent-shell.area-workspace-layout.v1";
export const LEGACY_MAP_BRAIN_WIDTH_KEY = "agent-shell.map-brain-width";
export const AREA_WORKSPACE_LAYOUT_SCHEMA = "area-workspace-layout.v1";

/** Returns a finite integer at or above one pane minimum. */
function validSize(value, minimum, fallback = minimum) {
  const number = Number(value);
  if (Number.isFinite(number)) return Math.max(minimum, Math.round(number));
  const fallbackNumber = Number(fallback);
  return Number.isFinite(fallbackNumber) ? Math.max(minimum, Math.round(fallbackNumber)) : minimum;
}

/** True when an order contains each registered pane exactly once. */
function validOrder(order, paneIds) {
  return Array.isArray(order)
    && order.length === paneIds.length
    && new Set(order).size === paneIds.length
    && paneIds.every((id) => order.includes(id));
}

/** Reads the versioned layout preference and migrates the former Brain width. */
export function readSplitLayoutPreference(storage, {
  paneIds = ["map", "brain"],
  minSizePx = { map: 560, brain: 420 },
  defaultSizePx = { map: 560, brain: 560 },
} = {}) {
  /** Reads one local value without letting disabled storage block navigation. */
  const get = (key) => {
    try { return storage?.getItem?.(key) ?? null; }
    catch { return null; }
  };
  let parsed = null;
  try { parsed = JSON.parse(get(AREA_WORKSPACE_LAYOUT_KEY) || "null"); }
  catch {}
  const order = parsed?.schema === AREA_WORKSPACE_LAYOUT_SCHEMA && validOrder(parsed.order, paneIds)
    ? [...parsed.order]
    : [...paneIds];
  const legacyBrainWidth = get(LEGACY_MAP_BRAIN_WIDTH_KEY);
  const preferred = parsed?.schema === AREA_WORKSPACE_LAYOUT_SCHEMA ? parsed.sizePx ?? {} : {};
  const sizePx = Object.fromEntries(paneIds.map((id) => {
    const fallback = id === "brain" && legacyBrainWidth !== null ? legacyBrainWidth : defaultSizePx[id];
    return [id, validSize(preferred[id], minSizePx[id], fallback)];
  }));
  return { order, sizePx, companion: parsed?.companion === true };
}

/** Writes only reusable layout preference and keeps the rollback width current. */
export function writeSplitLayoutPreference(storage, layout) {
  const record = {
    schema: AREA_WORKSPACE_LAYOUT_SCHEMA,
    order: [...layout.order],
    sizePx: { brain: Math.round(layout.sizePx.brain) },
    companion: layout.companion === true,
  };
  try {
    storage?.setItem?.(AREA_WORKSPACE_LAYOUT_KEY, JSON.stringify(record));
    storage?.setItem?.(LEGACY_MAP_BRAIN_WIDTH_KEY, String(record.sizePx.brain));
  } catch {}
  return record;
}

/** Creates one valid visit state without coupling entry, focus, or order. */
export function createSplitLayout({
  paneIds = ["map", "brain"],
  entryPane,
  preference = { order: paneIds, sizePx: {} },
  minSizePx = { map: 560, brain: 420 },
  defaultSizePx = { map: 560, brain: 560 },
}) {
  if (!paneIds.includes(entryPane)) throw new Error(`Unknown entry pane: ${entryPane}`);
  const order = validOrder(preference.order, paneIds) ? [...preference.order] : [...paneIds];
  const sizePx = Object.fromEntries(paneIds.map((id) => [id, validSize(preference.sizePx?.[id], minSizePx[id], defaultSizePx[id])]));
  const companion = preference.companion === true;
  return {
    order,
    open: new Set(companion ? paneIds : [entryPane]),
    primary: entryPane,
    focused: entryPane,
    lastSinglePane: entryPane,
    sizePx,
    companion,
    presentation: { kind: "single", active: entryPane },
  };
}

/** Chooses wide or single presentation from the container's measured width. */
export function reconcileSplitPresentation(layout, availableWidth, minSizePx, separatorPx = 6) {
  const next = { ...layout, open: new Set(layout.open), order: [...layout.order], sizePx: { ...layout.sizePx } };
  const open = next.order.filter((id) => next.open.has(id));
  const canShowWide = open.length === 2
    && Number(availableWidth) >= open.reduce((sum, id) => sum + minSizePx[id], separatorPx);
  if (canShowWide) {
    if (layout.presentation?.kind === "single" && open.includes(layout.presentation.active)) {
      next.lastSinglePane = layout.presentation.active;
    }
    next.presentation = { kind: "wide" };
    return next;
  }
  const previous = layout.presentation?.kind === "single" ? layout.presentation.active : layout.lastSinglePane;
  const active = open.includes(previous) ? previous : open.includes(next.primary) ? next.primary : open[0];
  next.presentation = { kind: "single", active };
  next.lastSinglePane = active;
  next.focused = active;
  return next;
}

/** Opens one stable pane. Narrow presentation makes the new companion active. */
export function showSplitPane(layout, id, { focus = false, availableWidth, minSizePx, separatorPx = 6 } = {}) {
  if (!layout.order.includes(id)) return layout;
  let next = { ...layout, open: new Set(layout.open), order: [...layout.order], sizePx: { ...layout.sizePx } };
  next.open.add(id);
  next = reconcileSplitPresentation(next, availableWidth, minSizePx, separatorPx);
  if (next.presentation.kind === "single") {
    next.presentation = { kind: "single", active: id };
    next.lastSinglePane = id;
    next.focused = id;
  } else if (focus) {
    next.focused = id;
  }
  return next;
}

/**
 * Enters one pane alone. Arriving at a surface is not a request for a split,
 * so the sibling closes and the entered pane becomes this visit's primary.
 */
export function enterSplitPane(layout, id, { availableWidth, minSizePx, separatorPx = 6 } = {}) {
  if (!layout.order.includes(id)) return layout;
  const next = {
    ...layout,
    open: new Set([id]),
    order: [...layout.order],
    sizePx: { ...layout.sizePx },
    primary: id,
    focused: id,
    lastSinglePane: id,
  };
  return reconcileSplitPresentation(next, availableWidth, minSizePx, separatorPx);
}

/** Hides a companion but never hides the visit's primary pane. */
export function hideSplitPane(layout, id, { availableWidth, minSizePx, separatorPx = 6 } = {}) {
  if (id === layout.primary || !layout.open.has(id)) return layout;
  const next = { ...layout, open: new Set(layout.open), order: [...layout.order], sizePx: { ...layout.sizePx } };
  next.open.delete(id);
  if (next.focused === id) next.focused = next.primary;
  return reconcileSplitPresentation(next, availableWidth, minSizePx, separatorPx);
}

/** Changes keyboard focus without changing primary, order, or size. */
export function focusSplitPane(layout, id) {
  if (!layout.open.has(id)) return layout;
  const next = { ...layout, open: new Set(layout.open), order: [...layout.order], sizePx: { ...layout.sizePx }, focused: id };
  if (next.presentation.kind === "single") {
    next.presentation = { kind: "single", active: id };
    next.lastSinglePane = id;
  }
  return next;
}

/** Changes pane order without changing pane identity or content state. */
export function orderSplitPanes(layout, order) {
  if (!validOrder(order, layout.order)) return layout;
  return { ...layout, open: new Set(layout.open), order: [...order], sizePx: { ...layout.sizePx } };
}

/** Clamps a pane size against its sibling's usable minimum. */
export function sizeSplitPane(layout, id, value, { availableWidth, minSizePx, separatorPx = 6 } = {}) {
  if (!layout.order.includes(id)) return layout;
  const sibling = layout.order.find((paneId) => paneId !== id);
  const maximum = Number.isFinite(availableWidth)
    ? Math.max(minSizePx[id], Math.floor(availableWidth - minSizePx[sibling] - separatorPx))
    : Number.POSITIVE_INFINITY;
  const size = Math.min(maximum, validSize(value, minSizePx[id]));
  return { ...layout, open: new Set(layout.open), order: [...layout.order], sizePx: { ...layout.sizePx, [id]: size } };
}

export default {
  AREA_WORKSPACE_LAYOUT_KEY,
  LEGACY_MAP_BRAIN_WIDTH_KEY,
  AREA_WORKSPACE_LAYOUT_SCHEMA,
  readSplitLayoutPreference,
  writeSplitLayoutPreference,
  createSplitLayout,
  reconcileSplitPresentation,
  showSplitPane,
  enterSplitPane,
  hideSplitPane,
  focusSplitPane,
  orderSplitPanes,
  sizeSplitPane,
};
