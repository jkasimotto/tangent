// The presentation of an Area outline, which belongs to the Area tree and never to the person.
//
// An Area outline is composed from the tree: the controller re-derives its stroke, its
// near-transparent fill and its opacity every time the world is composed. Excalidraw knows none of
// that. It offers its ordinary shape properties for whatever is selected, and one click on a
// Background swatch writes that colour into the outline element. The write is not a change the Map
// can record anywhere, so nothing undoes it and the Area stays painted.
//
// Two rules live here. `onlyAreaOutlinesHeld` says when the whole selection is outlines, which is
// when the Map hides Excalidraw's shape properties, so the controls are never offered for something
// no person authored. `areaOutlineRestyled` says when a change Excalidraw reports gave an outline a
// presentation the composed scene did not, which is how every remaining path, such as a selection
// that catches an outline beside a Block, is refused and re-projected.

import { regionAreaOf } from "../input/hit-test.ts";
import type { SceneElement, Selection } from "../kernel/kernel-types.ts";
import type { RuntimeId } from "../units/ids.ts";

/** What an Area outline looks like: every field Excalidraw's shape properties write and the composition owns. */
type OutlinePresentation = {
  readonly strokeColor: SceneElement["strokeColor"];
  readonly backgroundColor: SceneElement["backgroundColor"];
  readonly fillStyle: SceneElement["fillStyle"];
  readonly strokeWidth: SceneElement["strokeWidth"];
  readonly strokeStyle: SceneElement["strokeStyle"];
  readonly roughness: SceneElement["roughness"];
  readonly opacity: SceneElement["opacity"];
  readonly link: SceneElement["link"];
  readonly locked: SceneElement["locked"];
};

/** Reads one element's presentation, which is all of it this module compares. */
function presentationOf(element: SceneElement): OutlinePresentation {
  return {
    strokeColor: element.strokeColor,
    backgroundColor: element.backgroundColor,
    fillStyle: element.fillStyle,
    strokeWidth: element.strokeWidth,
    strokeStyle: element.strokeStyle,
    roughness: element.roughness,
    opacity: element.opacity,
    link: element.link,
    locked: element.locked,
  };
}

/** True when two presentations disagree about any field. */
function presentationDiffers(composed: OutlinePresentation, incoming: OutlinePresentation): boolean {
  return composed.strokeColor !== incoming.strokeColor
    || composed.backgroundColor !== incoming.backgroundColor
    || composed.fillStyle !== incoming.fillStyle
    || composed.strokeWidth !== incoming.strokeWidth
    || composed.strokeStyle !== incoming.strokeStyle
    || composed.roughness !== incoming.roughness
    || composed.opacity !== incoming.opacity
    || composed.link !== incoming.link
    || composed.locked !== incoming.locked;
}

/** The Area outlines of one element list, by the id Excalidraw holds them under. */
function outlinesById(elements: readonly SceneElement[]): Map<RuntimeId, SceneElement> {
  const outlines = new Map<RuntimeId, SceneElement>();
  for (const element of elements) {
    if (regionAreaOf(element) !== null) outlines.set(element.id, element);
  }
  return outlines;
}

/**
 * True when the incoming scene gives an Area outline a presentation the composed scene did not.
 * Position is not presentation: an Area the person drags moves, and this stays false for it. An
 * outline the change dropped altogether is a delete, which the outline protection answers, so an id
 * that is missing from either side is not a restyle.
 */
export function areaOutlineRestyled(composed: readonly SceneElement[], incoming: readonly SceneElement[]): boolean {
  const before = outlinesById(composed);
  if (before.size === 0) return false;
  for (const [id, element] of outlinesById(incoming)) {
    const original = before.get(id);
    if (original === undefined) continue;
    if (presentationDiffers(presentationOf(original), presentationOf(element))) return true;
  }
  return false;
}

/**
 * True when the selection is Area outlines and nothing else. Excalidraw's shape properties apply to
 * a shape a person drew; every control on that island, from the swatches to Duplicate and Delete,
 * would edit geometry the Area tree owns, so the Map hides the island for this selection alone. A
 * selection that also holds a Block keeps the island, because the Block is the person's to style.
 */
export function onlyAreaOutlinesHeld(elements: readonly SceneElement[], selection: Selection): boolean {
  if (selection.size === 0) return false;
  const outlines = outlinesById(elements);
  for (const id of selection) {
    if (!outlines.has(id)) return false;
  }
  return true;
}
