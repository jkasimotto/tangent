// The one function that decides what a pointer press means.
//
// The old component spread this decision across the gesture start, the pointer-down handler, the
// paste handler, the placement point and the keyboard listener's Space handling, and each computed
// its own hit. Here one pure function reads one context, what the press can see, and returns one
// value from a closed union. `excalidraw-subordination.ts` turns that value into the selection
// Excalidraw must hold before its first move frame, and `pointer-session.ts` opens the gesture it
// names. Nothing else interprets a press; the `pointer-confinement` lint and the module guide keep
// it that way.
//
// The rules are one ordered list and the order is the product rule. Each rule is a small named
// function that answers or passes. A later product decision changes one entry of `PRESS_RULES`:
// the open question on rule 8, whether a plain press inside an unselected Area should rubber-band
// its Blocks rather than move the Area, is one line there.
//
// Design: docs/design/area-map-rebuild/code.md, "Pointer authority".

import type { ActiveTool } from "@excalidraw/excalidraw/types";
import type { PointerCommand, Selection } from "../kernel/kernel-types.ts";
import type { Point } from "../units/frames.ts";
import type { AreaKey, ResizeHandle, RuntimeId } from "../units/ids.ts";
import type { SceneHit } from "./hit-test.ts";

/** What a press means. Exactly the union in the design; every consumer switches over `kind`. */
export type PressMeaning =
  | { kind: "pan" }
  | { kind: "place-resource"; point: Point<"scene"> }
  | { kind: "text"; point: Point<"scene"> }
  | { kind: "rubber-band" }
  | { kind: "grab-element"; id: RuntimeId }
  | { kind: "add-to-selection"; id: RuntimeId }
  | { kind: "move-area"; area: AreaKey }
  | { kind: "resize-area"; area: AreaKey; handle: ResizeHandle }
  | { kind: "ignore"; reason: "rotation" | "hidden" | "editing-text" };

/** The modifier keys held at the press. Shift and Cmd or Ctrl both make a press additive. */
export type PressModifiers = {
  readonly shift: boolean;
  readonly cmdOrCtrl: boolean;
};

/** Excalidraw's active tool at the press: its own tool names, or `custom`. */
export type PressTool = ActiveTool["type"];

/**
 * Everything a press can see. Built once at pointer down by `pointer-session.ts` from the session
 * flags, Excalidraw's app state and pointer-down state, the controller's stable selection, and
 * `hit-test.ts` over the visible scene. `selectedArea` comes from `selectedVisibleArea` there, so
 * it is null whenever the selected region is one fold or scope has hidden.
 */
export type PressContext = {
  /** Where the press landed, in the scene. */
  readonly point: Point<"scene">;
  readonly modifiers: PressModifiers;
  /** True while Space is held, a session flag the keyboard dispatcher keeps. */
  readonly spaceHeld: boolean;
  readonly tool: PressTool;
  /** True while a Place on Map placement is open. */
  readonly placementOpen: boolean;
  /** True while Excalidraw is editing a text element. */
  readonly editingText: boolean;
  /** The selection the controller held before the press. */
  readonly selection: Selection;
  /** The visible Area whose region is selected, or null. */
  readonly selectedArea: AreaKey | null;
  /** What Excalidraw reported the press starts: a move, a resize from a handle, or something the Map ignores, such as rotation. */
  readonly command: PointerCommand;
  /** What `hit-test.ts` found under the point. */
  readonly hit: SceneHit;
};

/** One rule: a name for the table and a decision that answers or passes to the next rule. */
export type PressRule = {
  readonly name: string;
  readonly decide: (context: PressContext) => PressMeaning | null;
};

/** The meaning every press falls back to; the last rule always answers with it. */
const RUBBER_BAND: PressMeaning = Object.freeze({ kind: "rubber-band" });

/** True when Shift or Cmd or Ctrl is held. */
function isAdditive(context: PressContext): boolean {
  return context.modifiers.shift || context.modifiers.cmdOrCtrl;
}

/** True when the selection tool is active, the only tool whose press the Map interprets structurally. */
function isSelectionTool(context: PressContext): boolean {
  return context.tool === "selection";
}

/** Rule 1. Space held, or the hand tool: the press pans, before any selection is considered. */
function panWhenSpaceOrHand(context: PressContext): PressMeaning | null {
  return context.spaceHeld || context.tool === "hand" ? { kind: "pan" } : null;
}

/** Rule 2. A placement is open: the press places the resource where it landed. */
function placeWhenPlacementOpen(context: PressContext): PressMeaning | null {
  return context.placementOpen ? { kind: "place-resource", point: context.point } : null;
}

/** Rule 3. The text tool: the press starts text where it landed. */
function textWhenTextTool(context: PressContext): PressMeaning | null {
  return context.tool === "text" ? { kind: "text", point: context.point } : null;
}

/** Rule 4. Text is being edited: the press belongs to the editor, and the Map does nothing. */
function ignoreWhileEditingText(context: PressContext): PressMeaning | null {
  return context.editingText ? { kind: "ignore", reason: "editing-text" } : null;
}

/** Rule 5. Shift or Cmd with an authored element under the point, grab padding included: add it to the selection. */
function addToSelectionWithModifier(context: PressContext): PressMeaning | null {
  if (!isSelectionTool(context) || !isAdditive(context) || context.hit.element === null) return null;
  return { kind: "add-to-selection", id: context.hit.element.id };
}

/** Rule 6. The selected Area's resize handle resizes it. Its rotation handle, which Excalidraw reports as a command the Map ignores, is refused. */
function transformSelectedArea(context: PressContext): PressMeaning | null {
  if (!isSelectionTool(context) || context.selectedArea === null) return null;
  if (context.command.kind === "resize") return { kind: "resize-area", area: context.selectedArea, handle: context.command.handle };
  if (context.command.kind === "ignore") return { kind: "ignore", reason: "rotation" };
  return null;
}

/** Rule 7. An authored element under the point, inside its body, or inside its grab padding when it is already held: grab it. */
function grabAuthoredElement(context: PressContext): PressMeaning | null {
  const element = context.hit.element;
  if (!isSelectionTool(context) || element === null) return null;
  return context.hit.inside || context.selection.has(element.id) ? { kind: "grab-element", id: element.id } : null;
}

/**
 * Rule 8. The deepest visible Area under the point moves, whether it is already selected or the
 * press selects it. Shift with nothing under the point starts a rubber band instead. This is the
 * rule the open product decision sits on: if a plain press inside an unselected Area should
 * rubber-band its Blocks, this entry changes and nothing else does.
 */
function moveDeepestArea(context: PressContext): PressMeaning | null {
  if (!isSelectionTool(context) || isAdditive(context) || context.hit.area === null) return null;
  return { kind: "move-area", area: context.hit.area };
}

/** Rule 9. Nothing under the point, or a tool the Map does not interpret: Excalidraw's own rubber band, holding nothing of the Map's. */
function rubberBand(): PressMeaning {
  return RUBBER_BAND;
}

/** The nine rules, in the order the design gives them. The first rule that answers decides. */
export const PRESS_RULES: readonly PressRule[] = Object.freeze([
  { name: "pan", decide: panWhenSpaceOrHand },
  { name: "place-resource", decide: placeWhenPlacementOpen },
  { name: "text", decide: textWhenTextTool },
  { name: "editing-text", decide: ignoreWhileEditingText },
  { name: "add-to-selection", decide: addToSelectionWithModifier },
  { name: "transform-selected-area", decide: transformSelectedArea },
  { name: "grab-element", decide: grabAuthoredElement },
  { name: "move-deepest-area", decide: moveDeepestArea },
  { name: "rubber-band", decide: rubberBand },
]);

/** What a press means: the answer of the first rule in `PRESS_RULES` that decides. Total, pure, and the only decider. */
export function meaningOfPress(context: PressContext): PressMeaning {
  for (const rule of PRESS_RULES) {
    const meaning = rule.decide(context);
    if (meaning !== null) return meaning;
  }
  return RUBBER_BAND;
}
