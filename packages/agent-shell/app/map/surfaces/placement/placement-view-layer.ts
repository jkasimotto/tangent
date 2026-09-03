// The view layer under a temporary resource surface. Placing a resource Block and Show on Map both
// lift Only, clear the Focus mask, unfold the owning Area's ancestors and fit the Area, so the
// Block is visible while the layer is open. What they changed is captured first and restored
// exactly when the layer ends: camera, selection, restriction, Focus and the folds set by hand.
// The three functions here are that capture, that restore, and the reveal between them.

import type { AreaMapController, ResourceLocator, SceneElement, Selection, Snapshot } from "../../kernel/kernel-types.ts";
import type { Camera } from "../../units/frames.ts";
import { areaKey } from "../../units/ids.ts";
import type { AreaKey } from "../../units/ids.ts";
import type { ViewLayer } from "./placement-store.ts";

/** The parts of Excalidraw's view a layer pushes back: the camera, the selection, or both. */
export type CanvasView = {
  readonly camera?: Camera;
  readonly selection?: Selection;
};

/** What the layer functions need: the controller and two doors to the canvas that `canvas/projection.ts` owns. */
export type LayerPorts = {
  readonly controller: AreaMapController;
  /** Excalidraw's camera right now, which runs ahead of the controller's during a pan; null before mount. */
  readonly liveCamera: () => Camera | null;
  /** Pushes a camera or a selection into Excalidraw with no history entry. The reason names the write in diagnostics. */
  readonly projectView: (view: CanvasView, reason: string) => void;
};

/** The Area a resource's catalog belongs to. A catalog owner is always an Area. */
export function ownerArea(locator: ResourceLocator): AreaKey {
  return areaKey(locator.owner);
}

/** The last segment of an Area key, the word the announcements use for it. */
export function areaLeaf(area: AreaKey): string {
  return area.split("/").at(-1) || area;
}

/** Captures everything a resource layer will change, with the camera Excalidraw holds now rather than the controller's last poll. */
export function captureViewLayer(ports: LayerPorts): ViewLayer {
  const snapshot = ports.controller.snapshot();
  const view = ports.controller.captureView();
  const live = ports.liveCamera();
  return {
    view: live ? { ...view, camera: live } : view,
    focus: { ...snapshot.focus, areas: [...(snapshot.focus.areas ?? [])] },
    manualFolded: new Set(snapshot.manualFolded),
  };
}

/** Puts back the exact restriction, folds, Focus, camera and selection a layer replaced, and pushes the view into Excalidraw. */
export function restoreViewLayer(ports: LayerPorts, layer: ViewLayer): Snapshot {
  const controller = ports.controller;
  controller.setRestriction(null);
  const folded = controller.snapshot().manualFolded;
  for (const area of new Set([...folded, ...layer.manualFolded])) {
    if (folded.has(area) !== layer.manualFolded.has(area)) controller.toggleFold(area);
  }
  controller.setFocus(layer.focus);
  const restored = controller.restoreView(layer.view);
  ports.projectView({ camera: restored.camera, selection: restored.selection }, "view-return");
  return restored;
}

/** True when `area` is `ancestor` or lies below it. */
function isWithin(area: AreaKey, ancestor: AreaKey): boolean {
  return area === ancestor || area.startsWith(`${ancestor}/`);
}

/** Brings the owning Area into view: lifts Only when it hides the owner, clears the Focus mask, unfolds every folded ancestor, fits the Area. */
export function revealOwner(ports: LayerPorts, owner: AreaKey): SceneElement | null {
  const controller = ports.controller;
  const snapshot = controller.snapshot();
  if (!snapshot.scopedAreas.has(owner)) controller.setRestriction(null);
  controller.setFocus({ only: false, activeOnly: false, areas: [] });
  for (const area of snapshot.manualFolded) if (isWithin(owner, area)) controller.toggleFold(area);
  return controller.fitArea(owner, { push: true, select: false });
}
