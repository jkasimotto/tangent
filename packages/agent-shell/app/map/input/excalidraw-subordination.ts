// What Excalidraw may hold selected, decided from the press and applied before its first move frame.
//
// Excalidraw drags whatever it holds selected as soon as the pointer moves. When a press means
// something other than dragging that selection, the person watches an outline follow the cursor
// and then snap back on release, because the Map solved nothing and threw the dragged rectangle
// away. The old component corrected this in four places inside one pointer-down handler, each
// writing `selectedElementIds` back into Excalidraw with its own condition, and the fourth was
// added as a bug fix. Here the correction is one table: a `PressMeaning` names the selection
// Excalidraw must hold, and one function applies it.
//
// This module and `canvas/projection.ts` are the only writers of Excalidraw's selection, and the
// selection-write-confinement lint holds them to that. Every write goes through the projection, so
// it carries `captureUpdate: "NEVER"` and is fenced like every other push: Excalidraw never owns
// the Map's history.
//
// Design: docs/design/area-map-rebuild/code.md, "Pointer authority".

import type { Projection, ProjectionReason, ProjectionToken } from "../canvas/projection.ts";
import type { SceneElement, Selection } from "../kernel/kernel-types.ts";
import type { AreaKey, RuntimeId } from "../units/ids.ts";
import { regionAreaOf } from "./hit-test.ts";
import type { PressMeaning } from "./press-meaning.ts";

/** The selection Excalidraw must hold for one press, and the reason the projection records for the write. */
export type Subordination = {
  readonly ids: Selection;
  readonly reason: ProjectionReason;
};

/** The one part of the projection a subordination uses: the push that carries the selection. */
export type SelectionWriter = Pick<Projection, "project">;

/** Nothing to hold: a rubber band and a pan start from an empty selection. */
const NOTHING: Selection = new Set<RuntimeId>();

/** The Area region elements of one scene, by the Area each stands for. `move-area` names an Area, and this is what turns it into the id Excalidraw holds. */
export function regionIdsOf(elements: readonly SceneElement[]): ReadonlyMap<AreaKey, RuntimeId> {
  const ids = new Map<AreaKey, RuntimeId>();
  for (const element of elements) {
    const area = regionAreaOf(element);
    if (area !== null) ids.set(area, element.id);
  }
  return ids;
}

/** The subordination that leaves one Area's region alone in the selection, or none when that region is not in the scene. */
function regionAlone(area: AreaKey, regions: ReadonlyMap<AreaKey, RuntimeId>, reason: ProjectionReason): Subordination | null {
  const id = regions.get(area);
  return id === undefined ? null : { ids: new Set([id]), reason };
}

/**
 * The element the press grabs, alone. A press on an element that is already part of the selection
 * keeps the whole selection instead, because that press is the person dragging the group they
 * built, and narrowing it to one element would throw the rest of their work away.
 */
function grabbedElement(id: RuntimeId, stableSelection: Selection): Subordination {
  const ids = stableSelection.has(id) ? stableSelection : new Set([id]);
  return { ids, reason: "stale-region-release" };
}

/**
 * The selection Excalidraw must hold before its first move frame, or null when the press has no
 * opinion and whatever Excalidraw holds stands. `move-area` selects that region alone, which is
 * how a press inside a sub-Area takes the gesture away from its selected parent. `grab-element`
 * takes the element, `add-to-selection` adds it, `rubber-band` and `pan` clear, `resize-area`
 * keeps the region it is dragging, and every remaining meaning keeps the current selection.
 */
export function selectionForMeaning(meaning: PressMeaning, stableSelection: Selection, regions: ReadonlyMap<AreaKey, RuntimeId>): Subordination | null {
  if (meaning.kind === "move-area") return regionAlone(meaning.area, regions, "pointer-down-selection");
  if (meaning.kind === "resize-area") return regionAlone(meaning.area, regions, "pointer-down-selection");
  if (meaning.kind === "grab-element") return grabbedElement(meaning.id, stableSelection);
  if (meaning.kind === "add-to-selection") return { ids: new Set([...stableSelection, meaning.id]), reason: "additive-pointer-selection" };
  if (meaning.kind === "rubber-band" || meaning.kind === "pan") return { ids: NOTHING, reason: "stale-region-release" };
  return null;
}

/**
 * Writes the subordinated selection into Excalidraw through the projection. This is the one write
 * of `selectedElementIds` an input event may cause, and it happens inside the pointer-down handler,
 * before the first move frame. A null subordination writes nothing and whatever Excalidraw holds
 * stands. The returned token is the echo the projection fence will swallow.
 */
export function applySubordination(projection: SelectionWriter, selection: Subordination | null): ProjectionToken | null {
  if (selection === null) return null;
  return projection.project({ selection: selection.ids }, selection.reason);
}
