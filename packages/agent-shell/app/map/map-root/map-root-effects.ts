// The Map's effects: the controller subscription, the projection push, the announce clock, the
// resource cadence and the bridge the host holds.
//
// Each one is a plain function that installs something and returns the function that removes it, so
// `MapRoot.tsx` calls it from one `useEffect` and the dependency list stays readable. Nothing here
// renders and nothing here decides: the projection push asks the kernel whether Excalidraw is
// already showing what the controller wants, and the announce clock only advances a pure store.

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { selectedIds } from "../canvas/projection.ts";
import type { Projection } from "../canvas/projection.ts";
import type { IconFileRegistry } from "../canvas/icon-files.ts";
import { PointerSession } from "../input/pointer-session.ts";
import { areaMapProjectionUpdate } from "../kernel/kernel-boundary.ts";
import type { AreaMapController, SceneElement, Snapshot } from "../kernel/kernel-types.ts";
import { LAYOUT } from "../layout/layout-tokens.ts";
import type { AnnounceAction } from "../surfaces/announce/announce-store.ts";
import type { MapSession } from "./map-session.ts";

/** Removes what an installer installed. */
export type Uninstall = () => void;

/** Mirrors the controller's newest snapshot into React after the current lifecycle returns. */
export function subscribeSnapshots(controller: AreaMapController, apply: (snapshot: Snapshot) => void): Uninstall {
  let active = true;
  let queued = false;
  let latest = controller.snapshot();
  const unsubscribe = controller.subscribe((value) => {
    latest = value;
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (active) apply(latest);
    });
  });
  return () => {
    active = false;
    unsubscribe();
  };
}

/** Advances the announce store's clock so every announcement clears when its time runs out. */
export function installAnnounceClock(dispatch: (action: AnnounceAction) => void): Uninstall {
  const timer = setInterval(() => dispatch({ kind: "expire", elapsed: LAYOUT.announceTick }), LAYOUT.announceTick);
  return () => clearInterval(timer);
}

/** Everything the projection push reads. */
export type ProjectionPushDeps = {
  readonly api: ExcalidrawImperativeAPI | null;
  readonly controller: AreaMapController;
  readonly projection: Projection;
  readonly pointer: PointerSession;
  readonly session: MapSession;
  readonly icons: IconFileRegistry;
  readonly snapshot: Snapshot;
  /** The dashed preview elements drawn beside the composed scene, empty when nothing is being placed. */
  readonly placementElements: readonly SceneElement[];
  /** One string that changes exactly when that preview must be redrawn. */
  readonly placementKey: string;
  /** True while Excalidraw's text editor holds a buffered edit, which the push must not disturb. */
  readonly textEditActive: boolean;
};

/**
 * Pushes the controller's scene and selection into Excalidraw when it is not already showing them.
 * The icon bytes go first, because Excalidraw draws an image element only once its file id is
 * registered and a figure can appear without any authored element changing.
 */
export function pushProjection(deps: ProjectionPushDeps): void {
  const api = deps.api;
  if (api === null) return;
  deps.icons.register(deps.snapshot.scene.elements, deps.snapshot.mapKinds?.icons ?? {});
  if (deps.textEditActive && api.getAppState().editingTextElement) return;
  // A brand-new Excalidraw element has no baseline selection. Let Excalidraw own that live pointer
  // frame and project once the release fence closes.
  if (deps.pointer.isOpen() && deps.session.pointerSelected.size === 0) return;
  const update = areaMapProjectionUpdate({
    appliedFingerprint: deps.projection.appliedFingerprint(),
    currentSelection: selectedIds(api.getAppState()),
    scene: deps.snapshot.scene,
    selection: deps.snapshot.selection,
  });
  const placementChanged = deps.session.placementProjection !== deps.placementKey;
  if (update === null && !placementChanged) return;
  const sceneChanged = update?.sceneChanged === true;
  if (sceneChanged) api.addFiles(Object.values(deps.snapshot.scene.files ?? {}));
  deps.session.placementProjection = deps.placementKey;
  const elements = sceneChanged || placementChanged ? { elements: [...deps.snapshot.scene.elements, ...deps.placementElements] } : {};
  deps.projection.defer({ ...elements, selection: deps.snapshot.selection }, placementChanged ? "resource-placement-preview" : "projection");
}

/** The shell elements a modal Map surface makes inert, and their state before it did. */
export type InertGuard = { readonly element: Element; readonly was: boolean };

/** The shell surfaces outside the Map that a modal surface must make inert. */
const SHELL_SELECTORS = ["#brain-pane", "#global-controls", "#splitter", "[data-split-pane=\"brain\"]", "[role=\"separator\"]"];

/** Makes the shell and the canvas inert while a modal Map surface owns the screen, and restores them after. */
export function installInertGuard(host: HTMLElement, modal: boolean): Uninstall {
  if (!modal) return () => undefined;
  const document = host.ownerDocument;
  const targets: InertGuard[] = [];
  for (const selector of [...SHELL_SELECTORS, ".excalidraw"]) {
    for (const element of document.querySelectorAll(selector)) {
      targets.push({ element, was: element.hasAttribute("inert") });
      element.setAttribute("inert", "");
    }
  }
  return () => {
    for (const guard of targets) if (!guard.was) guard.element.removeAttribute("inert");
  };
}
