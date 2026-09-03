// What every Resources view is given, and the pure reads they share. The views are thin `.tsx`
// files: they take one state record and one ports record, read a row through `resource-rows.ts`,
// and call the commands. Everything here is data or a pure function over it, so the decisions the
// views make (which rows the filter keeps, which sentence an empty inventory shows, which control
// focus returns to) are tested under Node instead of only in a browser.

import type { MapKindsCatalog, ResourceLocator, ResourcePanelProjection, ResourcePanelRow, ResourceResolution, World } from "../../kernel/kernel-types.ts";
import { resourceLocatorKey } from "../../kernel/kernel-boundary.ts";
import { RESOURCES_PANEL } from "../../copy.ts";
import type { MapEntityFacts } from "../../kernel/kernel-types.ts";
import { areaKey } from "../../units/ids.ts";
import type { AreaKey, ShardOwner } from "../../units/ids.ts";
import { panelIsConfidentlyEmpty, resolutionForRow, resourceRowFacts, rowMatchesFilter } from "./resource-rows.ts";
import type { ResourceEffects } from "./resources-effects.ts";
import { resourceWritesAvailable } from "./resources-state.ts";
import type { ResourceFocusRequest, ResourcesState } from "./resources-state.ts";

/** Everything the Resources views are given besides the panel state. `MapRoot.tsx` builds one per render. */
export type ResourcePanelPorts = {
  readonly effects: ResourceEffects;
  /** The Map kinds catalog every surface resolves a Block through. */
  readonly kinds: MapKindsCatalog | null;
  /** The loaded world, read for the live Map state of a row. */
  readonly world: World;
  /** The display name of one Area: its Area document's title, else its leaf name. */
  readonly areaName: (area: AreaKey | ShardOwner) => string;
  /** Shows, restores or places one row on the Map. Owned by `../placement/`. */
  readonly placeOnMap: (row: ResourcePanelRow) => void;
  /** True while a placement is open, so the open panel stops taking the pointer. */
  readonly placementActive: boolean;
  /** Closes the panel. The Map root pops the surface stack and restores focus. */
  readonly close: () => void;
};

/** One row resolved once: the facts store's resolution and the Block facts both the row and its details read. */
export type RowFacts = {
  readonly resolution: ResourceResolution | null;
  readonly facts: MapEntityFacts | null;
};

/** Whether the panel may write, and whether its read controls are available at all. */
export type PanelControlFlags = {
  /** True when a write or a placement may start: current facts, current transport, nothing busy. */
  readonly writable: boolean;
  /** True when the resource-write rollout is open, which also gates Discover and Refresh. */
  readonly controls: boolean;
};

/** Resolves one row into its cached resolution and its Block facts. */
export function rowFactsFor(state: ResourcesState, ports: ResourcePanelPorts, row: ResourcePanelRow): RowFacts {
  const resolution = resolutionForRow(state.resolutions, row);
  return { resolution, facts: resourceRowFacts(row, resolution, ports.kinds) };
}

/** The write and control flags every disabled attribute in the panel reads. */
export function panelControlFlags(state: ResourcesState, effects: ResourceEffects): PanelControlFlags {
  const controls = effects.writesEnabled();
  return { writable: resourceWritesAvailable(state, controls), controls };
}

/** The rows the filter keeps, in projection order. An empty filter keeps every row. */
export function matchingResourceRows(state: ResourcesState, ports: ResourcePanelPorts): ResourcePanelRow[] {
  const rows = state.projection?.rows ?? [];
  if (!state.filter.trim()) return [...rows];
  return rows.filter((row) => rowMatchesFilter(rowFactsFor(state, ports, row).facts, state.filter));
}

/** The Areas of one Area key, outermost first, so the breadcrumb is one button per ancestor. */
export function resourceBreadcrumb(area: AreaKey | null): AreaKey[] {
  if (!area) return [];
  const crumbs: AreaKey[] = [];
  let key = "";
  for (const part of String(area).split("/").filter(Boolean)) {
    key = key ? `${key}/${part}` : part;
    crumbs.push(areaKey(key));
  }
  return crumbs;
}

/** The value a Show or Place control carries: the locator as `owner/id`, percent-encoded once. */
export function resourceControlValue(locator: ResourceLocator): string {
  return encodeURIComponent(`${locator.owner}/${locator.id}`);
}

/** Percent-decodes a key that may already be encoded, so encoding it again is idempotent. */
function decodedKey(key: string): string {
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

/** The selector the reopened panel focuses: the row control a Show or a cancelled placement left. */
export function resourceFocusSelector(focus: ResourceFocusRequest | null): string | undefined {
  if (!focus) return undefined;
  return `[data-resource-${focus.control}="${encodeURIComponent(decodedKey(focus.key))}"]`;
}

/**
 * The sentence an inventory with no visible rows shows. A filter that hides every row says so; an
 * Area with nothing confirmed says so only when the read is exact, because a partial read, a
 * pending Suggestion and a pending legacy review are each a reason the Area is not empty.
 */
export function inventoryMessage(state: ResourcesState, matched: readonly ResourcePanelRow[]): string {
  if (state.transport.state !== "current" || matched.length > 0) return "";
  if (state.filter.trim()) return (state.projection?.rows.length ?? 0) > 0 ? RESOURCES_PANEL.noMatch : "";
  return panelIsConfidentlyEmpty(state.projection) ? RESOURCES_PANEL.empty : "";
}

/** The row one locator names in the installed projection, or null when the projection has none. */
export function rowForLocator(projection: ResourcePanelProjection | null, locator: ResourceLocator | undefined): ResourcePanelRow | null {
  const key = resourceLocatorKey(locator);
  if (!key) return null;
  return projection?.rows.find((row) => resourceLocatorKey(row.entity.locator) === key) ?? null;
}

/** The frame class of the panel: the side panel or the modal sheet, muted while a placement runs. */
export function panelFrameClass(narrow: boolean, placementActive: boolean): string {
  const modality = narrow ? "is-modal" : "is-panel";
  return placementActive ? `tangent-map-resources-backdrop ${modality} placement-active` : `tangent-map-resources-backdrop ${modality}`;
}
