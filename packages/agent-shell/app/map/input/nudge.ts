// The arrow keys, run as a pointer move.
//
// A keyboard move and a pointer move change the same things and must land in history the same way,
// so this module opens the same `PointerSession` a press opens and closes it the same way. What a
// nudge means is read from the selection exactly as a press reads it from the point: a selected
// Area region is an Area move and goes through the kernel's solver, and anything else is the
// selected elements displaced by the step. There is no second gesture path and no second history
// word for the keyboard.
//
// The step itself is not decided here. `key-routes.ts` reads `LAYOUT.nudge` and `LAYOUT.nudgeFast`,
// the one place those distances are named, and hands the displacement over as the `nudge-selection`
// command. This module moves by whatever it is given.
//
// Design: docs/design/area-map-rebuild/code.md, "Pointer authority" and "Keyboard".

import type { SceneElement, Selection } from "../kernel/kernel-types.ts";
import type { Delta, Point } from "../units/frames.ts";
import { point } from "../units/frames.ts";
import type { AreaKey, RuntimeId } from "../units/ids.ts";
import { add, translate } from "../units/scalar-math.ts";
import { scenePx } from "../units/units.ts";
import { selectedVisibleArea } from "./hit-test.ts";
import type { VisibleScene } from "./hit-test.ts";
import type { PointerPreview, PointerSession } from "./pointer-session.ts";
import type { PressMeaning } from "./press-meaning.ts";

/**
 * Where a keyboard gesture starts. A nudge has no pointer, so the gesture begins at the scene
 * origin and the whole move is the displacement handed to `preview`. The solver reads only the
 * displacement, so the point it is measured from never shows.
 */
const NUDGE_ORIGIN: Point<"scene"> = point("scene", scenePx(0), scenePx(0));

/** What the Map is asked to nudge: the visible scene, what is selected in it, and how far to move. */
export type NudgeInput = {
  readonly scene: VisibleScene;
  readonly selection: Selection;
  readonly delta: Delta<"scene">;
};

/** What a nudge did, and what the caller must paint for it. */
export type NudgeResult =
  | { readonly kind: "area"; readonly area: AreaKey; readonly preview: PointerPreview | null }
  | { readonly kind: "elements"; readonly elements: readonly SceneElement[] }
  | { readonly kind: "none" };

/** Nothing was selected, so nothing moved. */
const NO_NUDGE: NudgeResult = Object.freeze({ kind: "none" });

/**
 * What an arrow key means for the current selection, in the same union a press answers in. A
 * visible selected Area region is an Area move; anything else selected is grabbed as elements.
 * Null when nothing is selected, which is when the arrows are not the Map's to take.
 */
export function nudgeMeaning(scene: VisibleScene, selection: Selection): PressMeaning | null {
  const area = selectedVisibleArea(scene, selection);
  if (area !== null) return { kind: "move-area", area };
  const [first] = selection;
  return first === undefined ? null : { kind: "grab-element", id: first };
}

/** The ids one nudge moves: everything selected, and the labels and arrows bound to it, which travel with their element. */
export function nudgedIds(elements: readonly SceneElement[], selection: Selection): ReadonlySet<RuntimeId> {
  const moving = new Set<RuntimeId>(selection);
  for (const element of elements) {
    if (!selection.has(element.id)) continue;
    for (const bound of element.boundElements ?? []) moving.add(bound.id);
  }
  return moving;
}

/** The scene with every moving element displaced. Elements that do not move are returned as they were. */
export function displacedElements(elements: readonly SceneElement[], moving: ReadonlySet<RuntimeId>, by: Delta<"scene">): SceneElement[] {
  return elements.map((element) => (moving.has(element.id) ? { ...element, x: add(element.x, by.dx), y: add(element.y, by.dy) } : element));
}

/**
 * Runs one arrow-key move through the pointer session. An open pointer gesture is settled first,
 * because a new keyboard command supersedes the release fence and owns the next word. An Area move
 * is solved by the kernel through `preview`, which is the same call a drag makes; anything else is
 * displaced here and published into the open word, because Excalidraw never saw the key and so has
 * moved nothing of its own.
 */
export function nudgeSelection(session: PointerSession, input: NudgeInput): NudgeResult {
  if (session.isOpen() || session.isSettling()) session.settle();
  const meaning = nudgeMeaning(input.scene, input.selection);
  if (meaning === null) return NO_NUDGE;
  session.begin(meaning, { point: NUDGE_ORIGIN, selection: input.selection });
  if (meaning.kind === "move-area") {
    const preview = session.preview(translate(NUDGE_ORIGIN, input.delta));
    session.settle();
    return { kind: "area", area: meaning.area, preview };
  }
  const moved = displacedElements(input.scene.elements, nudgedIds(input.scene.elements, input.selection), input.delta);
  session.publishScene(moved, input.selection);
  session.settle();
  return { kind: "elements", elements: moved };
}
