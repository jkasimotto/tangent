// Moving browser focus onto the Map's canvas.
//
// The canvas is where every Map key is typed, so the Map focuses it on mount and puts focus back
// there whenever a dialog over it closes. Excalidraw's own container is the focusable element; its
// canvases are not. The kit owns this because the kit is the one owner of `.focus(`.

/** Excalidraw's container, the focusable element the Map's keys are typed into. */
const CANVAS_SELECTOR = ".excalidraw";

/** The Map's canvas element, or null before Excalidraw has mounted. */
export function mapCanvasElement(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>(CANVAS_SELECTOR);
}

/** Moves browser focus onto the Map's canvas. False when Excalidraw has not mounted yet. */
export function focusMapCanvas(host: HTMLElement): boolean {
  const canvas = mapCanvasElement(host);
  if (canvas === null) return false;
  canvas.focus({ preventScroll: true });
  return true;
}
