// Starting Excalidraw's own text editor on a Block's bound label.
//
// A Block placed from the picker opens its label for typing, so a person names it without a second
// gesture. Excalidraw offers no api for that: its editor opens on a double click over the text, so
// the Map dispatches exactly that event at the label's centre and moves focus into the textarea it
// opens. The focus call is why this lives in the kit; the kit is the only owner of `.focus(`.

import type { AppState } from "@excalidraw/excalidraw/types";
import { LAYOUT } from "../layout/layout-tokens.ts";
import { count } from "../units/units.ts";
import type { Count } from "../units/units.ts";
import type { Rect } from "../units/frames.ts";
import { rectCenter } from "../units/scalar-math.ts";
import { toScreen } from "../units/scalar-math.ts";
import type { Camera } from "../units/frames.ts";

/** The canvas Excalidraw draws on and takes its pointer events through. */
const CANVAS_SELECTOR = ".excalidraw canvas.interactive";

/** Excalidraw's own text editor, once it is open. */
const EDITOR_SELECTOR = 'textarea[data-type="wysiwyg"]';

/** The app state fields the screen conversion reads. */
export type CanvasViewState = Pick<AppState, "offsetLeft" | "offsetTop">;

/** Opens Excalidraw's text editor over one label rectangle and moves focus into it. */
export function startCanvasTextEdit(host: HTMLElement, camera: Camera, view: CanvasViewState, label: Rect<"scene">): boolean {
  const canvas = host.querySelector(CANVAS_SELECTOR);
  if (canvas === null) return false;
  const box = canvas.getBoundingClientRect();
  const at = toScreen(rectCenter(label), camera);
  const clientX = (view.offsetLeft || box.left) + at.x;
  const clientY = (view.offsetTop || box.top) + at.y;
  canvas.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX, clientY, button: 0, detail: LAYOUT.doubleClickDetail, view: host.ownerDocument.defaultView }));
  focusEditorWhenOpen(host, LAYOUT.textEditFocusFrames);
  return true;
}

/**
 * Moves focus into Excalidraw's text editor once it exists. Excalidraw opens the editor a frame or
 * two after the double click and can take focus back as it settles, so the Map keeps asking for a
 * bounded number of frames and stops as soon as the editor holds it.
 */
function focusEditorWhenOpen(host: HTMLElement, framesLeft: Count): void {
  if (framesLeft <= 0) return;
  requestAnimationFrame(() => {
    const editor = host.querySelector<HTMLElement>(EDITOR_SELECTOR);
    editor?.focus({ preventScroll: true });
    if (editor !== null && host.ownerDocument.activeElement === editor) return;
    focusEditorWhenOpen(host, count(framesLeft - 1));
  });
}
