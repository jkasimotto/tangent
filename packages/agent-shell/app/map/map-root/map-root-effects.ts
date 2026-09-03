// The Map's effects: the controller subscription, the projection push, the announce clock, the
// resource cadence and the bridge the host holds.
//
// Each one is a plain function that installs something and returns the function that removes it, so
// `MapRoot.tsx` calls it from one `useEffect` and the dependency list stays readable. Nothing here
// renders and nothing here decides: the projection push asks the kernel whether Excalidraw is
// already showing what the controller wants, and the announce clock only advances a pure store.

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { asSceneElements, selectedIds } from "../canvas/projection.ts";
import type { Projection } from "../canvas/projection.ts";
import type { IconFileRegistry } from "../canvas/icon-files.ts";
import { MAP_THEME, prepareFigureIconImages } from "../canvas/icon-files.ts";
import { requestResource } from "../surfaces/resources/resources-effects.ts";
import type { ResourceEffects } from "../surfaces/resources/resources-effects.ts";
import { PointerSession } from "../input/pointer-session.ts";
import { elementRect } from "../input/hit-test.ts";
import type { AppState } from "@excalidraw/excalidraw/types";
import { point } from "../units/frames.ts";
import type { Camera, Point } from "../units/frames.ts";
import { rectContains, toScene } from "../units/scalar-math.ts";
import { scenePx, screenPx, zoom as zoomOf } from "../units/units.ts";
import { areaMapProjectionUpdate, authoredFingerprint } from "../kernel/kernel-boundary.ts";
import type { AreaMapController, MapKindsCatalog, SceneElement, Snapshot } from "../kernel/kernel-types.ts";
import { LAYOUT } from "../layout/layout-tokens.ts";
import type { AnnounceAction } from "../surfaces/announce/announce-store.ts";
import type { SurfaceId } from "../surfaces/surface-registry.ts";
import type { SurfaceStack, SurfaceStackAction } from "../surfaces/surface-stack.ts";
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

/**
 * Lowers the mount flag once Excalidraw has settled the scene it was given. Until it does, every
 * change callback is Excalidraw reporting the scene the Map handed it, not a person editing, and
 * publishing one would rewrite every shard from Excalidraw's own copy.
 */
export function settleMount(session: MapSession, api: ExcalidrawImperativeAPI): void {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    session.fingerprint = authoredFingerprint(asSceneElements(api.getSceneElements()));
    session.initializing = false;
  }));
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

/** What the double-click listener needs to answer one double click. */
export type DoubleClickDeps = {
  readonly session: MapSession;
  readonly controller: AreaMapController;
  /** The Block that is the whole live selection, or null. */
  readonly selectedBlock: () => SceneElement | null;
  /** Runs one Block's primary action from the row or the canvas. */
  readonly openBlock: (block: SceneElement, opener: HTMLElement) => void;
};

/** The canvas Excalidraw draws on, which is where a double click lands. */
const INTERACTIVE_CANVAS = ".excalidraw canvas.interactive";

/** The scene point one mouse event landed on, from Excalidraw's own view offsets. */
function eventScenePoint(event: MouseEvent, canvas: Element, appState: AppState): Point<"scene"> {
  const box = canvas.getBoundingClientRect();
  const left = appState.offsetLeft || box.left;
  const top = appState.offsetTop || box.top;
  const camera: Camera = { scrollX: scenePx(appState.scrollX), scrollY: scenePx(appState.scrollY), zoom: zoomOf(appState.zoom.value) };
  return toScene(point("screen", screenPx(event.clientX - left), screenPx(event.clientY - top)), camera);
}

/**
 * Opens the one selected Block when a double click lands on it. Every other double click is left to
 * Excalidraw, which is how a double click on empty canvas still starts text. The Map ignores the
 * double click it dispatches itself to open a placed Block's label.
 */
export function installBlockDoubleClick(host: HTMLElement, deps: DoubleClickDeps): Uninstall {
  /** Claims one double click for the selected Block, or leaves it to Excalidraw. */
  const onDoubleClick = (event: MouseEvent): void => {
    const block = deps.selectedBlock();
    const canvas = event.target instanceof Element ? event.target.closest(INTERACTIVE_CANVAS) : null;
    const appState = deps.session.api?.getAppState();
    if (deps.session.openingLabel || block === null || canvas === null || appState === undefined) return;
    if (!rectContains(elementRect(block), eventScenePoint(event, canvas, appState), scenePx(0))) return;
    event.preventDefault();
    event.stopPropagation();
    deps.openBlock(block, canvas as HTMLElement);
  };
  host.addEventListener("dblclick", onDoubleClick, true);
  return () => host.removeEventListener("dblclick", onDoubleClick, true);
}

/** The route the Map kinds definition is read from. */
const MAP_KINDS_PATH = "/api/areas/map-kinds";

/**
 * Re-reads the Map kinds definition Julian owns and installs it in the controller. The catalog says
 * which icon each kind draws, so its image icons are prepared for the theme before it is installed,
 * and a read that fails leaves the catalog the Map already has.
 */
export function readMapKinds(effects: ResourceEffects, controller: AreaMapController): Uninstall {
  let cancelled = false;
  void requestResource(effects, MAP_KINDS_PATH)
    .then((catalog) => prepareFigureIconImages(catalog as MapKindsCatalog | null, MAP_THEME))
    .then((catalog) => {
      if (!cancelled) controller.setMapKinds(catalog);
    }, () => undefined);
  return () => { cancelled = true; };
}

/** Which surfaces the stores say are open, by registry id. */
export type OpenSurfaces = ReadonlyMap<SurfaceId, boolean>;

/**
 * Keeps the surface stack in step with the stores that own each surface's own state. A surface can
 * open or close from its own effect (the picker closes itself once a Block is placed, the Resources
 * panel opens from a row's Details), and the stack is what the keyboard, the backdrop and Escape
 * read, so the two must never disagree.
 */
export function reconcileSurfaces(stack: SurfaceStack, open: OpenSurfaces, dispatch: (action: SurfaceStackAction) => void): void {
  for (const [id, isOpen] of open) {
    const onStack = stack.includes(id);
    if (isOpen && !onStack) dispatch({ type: "open", id });
    else if (!isOpen && onStack) dispatch({ type: "close", id });
  }
}
