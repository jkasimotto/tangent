// What one key press on the Map host means, decided as a table of named routes. This file is pure:
// it reads a `KeyPress` (what the event said) and `KeyFacts` (what the Map knows) and answers with
// a `KeyDecision`. `keyboard-dispatch.ts` gathers the two inputs from the DOM and acts on the
// decision; nothing here touches an element. The order of the routes is the product rule: a
// composing key is ignored; an open surface is asked first (a modal owns every key, a panel owns
// the keys typed inside it, the placement bar owns Enter and the arrows, Escape always pops the
// stack); then the canvas keys run in the order the old component ran them; then Excalidraw and
// the text fields keep whatever is left. The chords themselves are named in `ui/key-bindings.ts`.

import { LAYOUT } from "../layout/layout-tokens.ts";
import { hasModalSurface, isSurfaceOpen, topSurface } from "../surfaces/surface-stack.ts";
import type { SurfaceStack } from "../surfaces/surface-stack.ts";
import type { SurfaceId } from "../surfaces/surface-registry.ts";
import { isMapKey } from "../ui/key-bindings.ts";
import type { ChordInput, KeyModifiers } from "../ui/key-bindings.ts";
import { delta } from "../units/frames.ts";
import type { Delta } from "../units/frames.ts";
import type { AreaKey } from "../units/ids.ts";
import { subtract } from "../units/scalar-math.ts";
import { scenePx } from "../units/units.ts";
import type { ScenePx } from "../units/units.ts";

/** What the event itself said, gathered once by the dispatcher. */
export type KeyPress = {
  readonly key: string;
  readonly modifiers: KeyModifiers;
  /** True on the auto-repeat of a held key. A fold runs once per press, not once per repeat. */
  readonly repeat: boolean;
  /** True while an IME composition is unfinished; such a key belongs to nobody on the Map. */
  readonly composing: boolean;
  /** True when the key was typed into a text field, a select, or an editable element. */
  readonly targetIsTextEntry: boolean;
  /** The open surface the event target sits inside, or null when it sits on the canvas or the host. */
  readonly targetSurface: SurfaceId | null;
};

/** What the Map knows at the moment of the press. `MapRoot.tsx` answers these from its state. */
export type KeyFacts = {
  readonly surfaces: SurfaceStack;
  /** True while Excalidraw edits a text element. */
  readonly editingText: boolean;
  /** The Area whose region is selected, or null. */
  readonly selectedArea: AreaKey | null;
  /** True when the whole selection is one semantic Block. */
  readonly hasSelectedBlock: boolean;
  /** True when Excalidraw holds anything selected, which is what an arrow key nudges. */
  readonly hasSelection: boolean;
  /** True while Find holds a query, which is when n and N step through its matches. */
  readonly findActive: boolean;
};

/** The word the Map's history records for an Excalidraw command the dispatcher lets through. */
export type ExcalidrawCommandWord = "duplicate" | "delete";

/** The closed set of things a routed key asks the Map to do. `MapRoot.tsx` runs each one. */
export type KeyCommand =
  | { readonly kind: "escape" }
  | { readonly kind: "open-find" }
  | { readonly kind: "open-help" }
  | { readonly kind: "open-picker" }
  | { readonly kind: "toggle-outline" }
  | { readonly kind: "undo" }
  | { readonly kind: "redo" }
  | { readonly kind: "nudge-selection"; readonly delta: Delta<"scene"> }
  | { readonly kind: "commit-placement" }
  | { readonly kind: "move-placement"; readonly delta: Delta<"scene"> }
  | { readonly kind: "finish-text-edit" }
  | { readonly kind: "fit-selected-area"; readonly area: AreaKey }
  | { readonly kind: "fold-selected-area"; readonly area: AreaKey }
  | { readonly kind: "refuse-area-delete" }
  | { readonly kind: "open-selected-block"; readonly verb: "open" | "read" }
  | { readonly kind: "hide-selected-block" }
  | { readonly kind: "toggle-only"; readonly area: AreaKey | null }
  | { readonly kind: "step-find"; readonly direction: "next" | "previous" }
  | { readonly kind: "expect-excalidraw-command"; readonly word: ExcalidrawCommandWord };

/**
 * How much of the event the Map takes. `stop` prevents the default and stops propagation, so
 * neither Excalidraw nor the shell sees the key. `prevent` only prevents the default, so Excalidraw
 * still sees the key held: Space folds and is also the pan modifier. `none` leaves the event alone.
 */
export type KeyConsume = "stop" | "prevent" | "none";

/** What the dispatcher does with one press. */
export type KeyDecision =
  | { readonly owner: "ignored" }
  | { readonly owner: "surface"; readonly surface: SurfaceId }
  | { readonly owner: "native" }
  | { readonly owner: "map"; readonly route: string; readonly command: KeyCommand; readonly consume: KeyConsume };

/** One named canvas route: the decision it makes for a press, or null when the press is not its key. */
export type KeyRoute = (press: KeyPress, facts: KeyFacts) => KeyDecision | null;

const IGNORED: KeyDecision = { owner: "ignored" };
const NATIVE: KeyDecision = { owner: "native" };

/** Builds the decision for a route that ran. */
function mapDecision(route: string, command: KeyCommand, consume: KeyConsume): KeyDecision {
  return { owner: "map", route, command, consume };
}

/** The key and modifiers of a press in the shape the chord matcher reads. */
function chordInput(press: KeyPress): ChordInput {
  return { key: press.key, ...press.modifiers };
}

/** The scene displacement an arrow key asks for at one step, or null for any other key. */
export function arrowDelta(press: KeyPress, step: ScenePx): Delta<"scene"> | null {
  const none = scenePx(0);
  const back = subtract(none, step);
  const input = chordInput(press);
  if (isMapKey("left", input)) return delta("scene", back, none);
  if (isMapKey("right", input)) return delta("scene", step, none);
  if (isMapKey("up", input)) return delta("scene", none, back);
  if (isMapKey("down", input)) return delta("scene", none, step);
  return null;
}

/** Escape while anything is open pops the stack, whatever the target and whatever the modality. */
function surfaceEscape(press: KeyPress): KeyDecision | null {
  return isMapKey("escape", chordInput(press)) ? mapDecision("surface-escape", { kind: "escape" }, "stop") : null;
}

/** The placement bar owns Enter and the arrows; every other key stays native while it is open. */
function placementRoute(press: KeyPress): KeyDecision {
  const input = chordInput(press);
  if (isMapKey("activate", input)) return mapDecision("placement-commit", { kind: "commit-placement" }, "stop");
  const step = press.modifiers.shiftKey ? LAYOUT.placementStepFine : LAYOUT.placementStep;
  const moved = arrowDelta(press, step);
  if (moved !== null) return mapDecision("placement-move", { kind: "move-placement", delta: moved }, "stop");
  return NATIVE;
}

/**
 * Asks the open surfaces. A modal surface owns every key. A panel owns the keys typed inside it and
 * nothing typed on the canvas beside it. The placement bar owns its own keys. Escape always pops
 * the stack. Null means no surface claimed the key and the canvas routes run.
 */
function surfaceDecision(press: KeyPress, facts: KeyFacts): KeyDecision | null {
  const top = topSurface(facts.surfaces);
  if (top === null) return null;
  const escaped = surfaceEscape(press);
  if (escaped !== null) return escaped;
  if (hasModalSurface(facts.surfaces)) return { owner: "surface", surface: top };
  if (press.targetSurface !== null && isSurfaceOpen(facts.surfaces, press.targetSurface)) {
    return { owner: "surface", surface: press.targetSurface };
  }
  if (isSurfaceOpen(facts.surfaces, "placement")) return placementRoute(press);
  return null;
}

/** While Excalidraw edits text, Escape and Cmd or Ctrl Enter settle the buffered edit; the key itself stays native. */
function textEditDecision(press: KeyPress): KeyDecision {
  const input = chordInput(press);
  if (isMapKey("escape", input) || isMapKey("finishTextEdit", input)) {
    return mapDecision("finish-text-edit", { kind: "finish-text-edit" }, "none");
  }
  return NATIVE;
}

/** Cmd or Ctrl F and slash open Find. */
function findRoute(press: KeyPress): KeyDecision | null {
  return isMapKey("find", chordInput(press)) ? mapDecision("find", { kind: "open-find" }, "stop") : null;
}

/** Cmd or Ctrl Z undoes; with Shift it redoes. */
function historyRoute(press: KeyPress): KeyDecision | null {
  const input = chordInput(press);
  if (isMapKey("redo", input)) return mapDecision("redo", { kind: "redo" }, "stop");
  if (isMapKey("undo", input)) return mapDecision("undo", { kind: "undo" }, "stop");
  return null;
}

/** Cmd or Ctrl D is Excalidraw's duplicate; the Map only names the history word and lets it through. */
function duplicateRoute(press: KeyPress): KeyDecision | null {
  if (!isMapKey("duplicate", chordInput(press))) return null;
  return mapDecision("duplicate", { kind: "expect-excalidraw-command", word: "duplicate" }, "none");
}

/** Cmd or Ctrl Shift O toggles the Outline. */
function outlineRoute(press: KeyPress): KeyDecision | null {
  return isMapKey("outline", chordInput(press)) ? mapDecision("outline", { kind: "toggle-outline" }, "stop") : null;
}

/** Backspace and Delete never remove an Area region; on anything else they are Excalidraw's delete. */
function removeRoute(press: KeyPress, facts: KeyFacts): KeyDecision | null {
  if (!isMapKey("remove", chordInput(press))) return null;
  if (facts.selectedArea !== null) return mapDecision("refuse-area-delete", { kind: "refuse-area-delete" }, "stop");
  return mapDecision("delete", { kind: "expect-excalidraw-command", word: "delete" }, "none");
}

/** The arrows nudge the selection by one scene pixel, or ten with Shift, through the pointer session's path. */
function nudgeRoute(press: KeyPress, facts: KeyFacts): KeyDecision | null {
  if (!facts.hasSelection) return null;
  const moved = arrowDelta(press, press.modifiers.shiftKey ? LAYOUT.nudgeFast : LAYOUT.nudge);
  return moved === null ? null : mapDecision("nudge", { kind: "nudge-selection", delta: moved }, "stop");
}

/** Escape on the bare canvas runs the Map's Escape order: the selection, the camera trail, then the opener. */
function escapeRoute(press: KeyPress): KeyDecision | null {
  return isMapKey("escape", chordInput(press)) ? mapDecision("escape", { kind: "escape" }, "stop") : null;
}

/** Question mark opens the keys dialog. */
function helpRoute(press: KeyPress): KeyDecision | null {
  return isMapKey("help", chordInput(press)) ? mapDecision("help", { kind: "open-help" }, "stop") : null;
}

/** Enter fits the selected Area or opens the selected Block; with nothing selected it stays native. */
function activateRoute(press: KeyPress, facts: KeyFacts): KeyDecision | null {
  if (!isMapKey("activate", chordInput(press))) return null;
  if (facts.selectedArea !== null) return mapDecision("fit-area", { kind: "fit-selected-area", area: facts.selectedArea }, "stop");
  if (facts.hasSelectedBlock) return mapDecision("open-block", { kind: "open-selected-block", verb: "open" }, "stop");
  return null;
}

/** With a Block selected, X hides it and O reads it. */
function blockVerbRoute(press: KeyPress, facts: KeyFacts): KeyDecision | null {
  if (!facts.hasSelectedBlock) return null;
  const input = chordInput(press);
  if (isMapKey("hide", input)) return mapDecision("hide-block", { kind: "hide-selected-block" }, "stop");
  if (isMapKey("read", input)) return mapDecision("read-block", { kind: "open-selected-block", verb: "read" }, "stop");
  return null;
}

/** Space folds the selected Area once per press. Only the default is prevented, so Excalidraw still sees Space held for the pan. */
function foldRoute(press: KeyPress, facts: KeyFacts): KeyDecision | null {
  if (facts.selectedArea === null || press.repeat || !isMapKey("fold", chordInput(press))) return null;
  return mapDecision("fold", { kind: "fold-selected-area", area: facts.selectedArea }, "prevent");
}

/** Shift O with no Block selected toggles Only for the selected Area, or the located one. */
function onlyRoute(press: KeyPress, facts: KeyFacts): KeyDecision | null {
  if (facts.hasSelectedBlock || !isMapKey("only", chordInput(press))) return null;
  return mapDecision("only", { kind: "toggle-only", area: facts.selectedArea }, "stop");
}

/** While Find holds a query, n steps to the next match and N to the previous. */
function findStepRoute(press: KeyPress, facts: KeyFacts): KeyDecision | null {
  if (!facts.findActive) return null;
  const input = chordInput(press);
  if (isMapKey("findNext", input)) return mapDecision("find-next", { kind: "step-find", direction: "next" }, "stop");
  if (isMapKey("findPrevious", input)) return mapDecision("find-previous", { kind: "step-find", direction: "previous" }, "stop");
  return null;
}

/** B opens the Block picker at the placement point. */
function pickerRoute(press: KeyPress): KeyDecision | null {
  return isMapKey("picker", chordInput(press)) ? mapDecision("picker", { kind: "open-picker" }, "stop") : null;
}

/** The canvas routes in the order they are tried. The first that answers wins. */
export const CANVAS_ROUTES: readonly KeyRoute[] = [
  findRoute,
  historyRoute,
  duplicateRoute,
  outlineRoute,
  removeRoute,
  nudgeRoute,
  escapeRoute,
  helpRoute,
  activateRoute,
  blockVerbRoute,
  foldRoute,
  onlyRoute,
  findStepRoute,
  pickerRoute
];

/** The canvas keys: a text edit or a text field keeps its keys, otherwise the first matching route decides. */
function canvasDecision(press: KeyPress, facts: KeyFacts): KeyDecision {
  if (facts.editingText) return textEditDecision(press);
  if (press.targetIsTextEntry) return NATIVE;
  for (const route of CANVAS_ROUTES) {
    const decision = route(press, facts);
    if (decision !== null) return decision;
  }
  return NATIVE;
}

/** Decides what one press means: ignored while composing, a surface's, the Map's, or native. */
export function routeKey(press: KeyPress, facts: KeyFacts): KeyDecision {
  if (press.composing) return IGNORED;
  return surfaceDecision(press, facts) ?? canvasDecision(press, facts);
}
