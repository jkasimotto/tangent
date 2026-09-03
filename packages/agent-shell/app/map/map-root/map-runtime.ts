// Everything the Map root wires together, built once per render.
//
// `MapRoot.tsx` owns the React state and the long-lived objects; this file turns them into the
// dependency records every module asked for. It is a plain function, not a hook, so the wiring is
// readable in one place and each surface still receives only the doors it declared. The order below
// follows the order the modules need each other: the shared reads first, then the publish and
// canvas dependencies, then the commands, then the surfaces' own environments.

import { RESOURCE_ANNOUNCEMENTS } from "../copy.ts";
import type { Projection } from "../canvas/projection.ts";
import type { TextEditBuffer } from "../canvas/text-edit.ts";
import { deepestVisibleArea, visibleSceneFromSnapshot } from "../input/hit-test.ts";
import type { VisibleScene } from "../input/hit-test.ts";
import { PointerSession } from "../input/pointer-session.ts";
import { runMapEntityAction, setBlockHidden } from "../kernel/kernel-boundary.ts";
import type { AreaMapController, MapEntityAction, MapEntityFacts, SceneElement, Snapshot } from "../kernel/kernel-types.ts";
import { LAYOUT } from "../layout/layout-tokens.ts";
import type { WorldMountOptions } from "../mount-options.ts";
import type { AnnounceAction } from "../surfaces/announce/announce-store.ts";
import type { SurfaceId } from "../surfaces/surface-registry.ts";
import { point, size } from "../units/frames.ts";
import type { Camera, Point, Size } from "../units/frames.ts";
import { areaKey, shardOwner } from "../units/ids.ts";
import type { AreaKey, ShardOwner } from "../units/ids.ts";
import { scenePx, screenPx, zoom as zoomOf } from "../units/units.ts";
import type { MapSession } from "./map-session.ts";
import type { MapView } from "./map-root-view.ts";
import { selectionAppState } from "../canvas/projection.ts";
import type { PublishRequest } from "../input/pointer-session.ts";
import { publishCurrentState, publishToWorld } from "./map-publish.ts";
import type { PublishDeps } from "./map-publish.ts";

/** The long-lived objects the Map root keeps for its whole life. */
export type RuntimeCore = {
  readonly host: HTMLElement;
  readonly options: WorldMountOptions;
  readonly controller: AreaMapController;
  readonly session: MapSession;
  readonly pointer: PointerSession;
  readonly projection: Projection;
  readonly buffer: TextEditBuffer;
};

/**
 * What both the shared reads and the key commands can do to a Block and to the surface stack. It is
 * one type because a toolbar button and its key must run exactly the same code.
 */
export type BlockActions = {
  /** Runs one Block action and reports what happened, opening a recovery when the browser refused. */
  readonly runAction: (facts: MapEntityFacts, action: MapEntityAction, opener: HTMLElement | null) => void;
  /** Hides one Block through the Map's own command path. */
  readonly hideBlock: (block: SceneElement) => void;
  /** Opens or closes one registered surface. */
  readonly openSurface: (id: SurfaceId) => void;
  readonly closeSurface: (id: SurfaceId) => void;
};

/** The reads every surface shares, built once per render from the snapshot and the view. */
export type RuntimeReads = BlockActions & {
  readonly snapshot: Snapshot;
  readonly view: MapView;
  readonly scene: VisibleScene;
  readonly announce: (text: string, visible?: boolean) => void;
  /** The deepest visible Area at a scene point, or the located Area. */
  readonly ownerAt: (at: Point<"scene">) => ShardOwner;
  /** The size of the Map's canvas in screen pixels, which every placement is kept inside. */
  readonly viewport: () => Size<"screen">;
  /** Excalidraw's live camera, which runs ahead of the controller's during a pan. */
  readonly liveCamera: () => Camera | null;
  /** Scrolls Excalidraw so the elements fit the view. */
  readonly scrollTo: (elements: readonly SceneElement[], animate: boolean) => void;
  /** True when the person asked for reduced motion. */
  readonly reducedMotion: () => boolean;
};

/** What `buildReads` is given: the core objects, this render's state, and the surface dispatchers. */
export type ReadsInput = {
  readonly core: RuntimeCore;
  readonly snapshot: Snapshot;
  readonly view: MapView;
  readonly announceAction: (action: AnnounceAction) => void;
  readonly openSurface: (id: SurfaceId) => void;
  readonly closeSurface: (id: SurfaceId) => void;
  /** Opens the recovery dialog a refused copy or open needs. */
  readonly openActionRecovery: (facts: MapEntityFacts, action: MapEntityAction, message: string) => void;
  /** Runs a shell navigation the browser cannot do itself. */
  readonly runShellAction: (facts: MapEntityFacts, action: MapEntityAction, opener: HTMLElement | null) => boolean;
};

/** The Block actions the browser itself performs; everything else is the shell's. */
const BROWSER_ACTIONS: ReadonlySet<string> = new Set(["copy-path", "copy-url", "open-url"]);

/** The size of one element in screen pixels, or a zero size before the canvas is measured. */
function measure(host: HTMLElement): Size<"screen"> {
  const box = host.getBoundingClientRect();
  return size("screen", screenPx(box.width), screenPx(box.height));
}

/** The words spoken and shown after one Block action the browser refused. */
function refusalMessage(facts: MapEntityFacts, action: MapEntityAction): string {
  if (action.kind === "open-url") return RESOURCE_ANNOUNCEMENTS.refreshFailed(facts.display.label);
  return RESOURCE_ANNOUNCEMENTS.copiedPath(facts.display.label);
}

/** Builds the reads every surface shares. */
export function buildReads(input: ReadsInput): RuntimeReads {
  const { core, snapshot } = input;
  const scene = visibleSceneFromSnapshot(snapshot);
  /** Speaks one sentence, and shows it as the toast unless the caller asked for speech only. */
  const announce = (text: string, visible = true): void => {
    input.announceAction({ kind: "announce", text, visible, ttl: LAYOUT.announceTtl });
  };
  /** Excalidraw's camera right now, which the controller's poll may not have caught up with. */
  const liveCamera = (): Camera | null => {
    const state = core.session.api?.getAppState();
    return state === undefined ? null : { scrollX: scenePx(state.scrollX), scrollY: scenePx(state.scrollY), zoom: zoomOf(state.zoom.value) };
  };
  /** Scrolls Excalidraw and keeps the overlays on the same live camera. */
  const scrollTo = (elements: readonly SceneElement[], animate: boolean): void => {
    const api = core.session.api;
    if (api === null || elements.length === 0) return;
    api.scrollToContent(elements as never, { fitToContent: true, animate });
    const camera = liveCamera();
    if (camera !== null) core.controller.setCamera(camera);
  };
  /** Runs one Block action: a browser effect here, a shell navigation through the host. */
  const runAction = (facts: MapEntityFacts, action: MapEntityAction, opener: HTMLElement | null): void => {
    if (!BROWSER_ACTIONS.has(action.kind)) {
      input.runShellAction(facts, action, opener);
      return;
    }
    void runMapEntityAction(action).then((result) => {
      if (result.kind === "done") {
        announce(RESOURCE_ANNOUNCEMENTS.copiedPath(facts.display.label));
        return;
      }
      input.openActionRecovery(facts, action, refusalMessage(facts, action));
    });
  };
  /** Hides one Block and its bound label through the shared world command path. */
  const hideBlock = (block: SceneElement): void => {
    const owner = block.customData?.tangentWorld?.owner;
    const source = block.customData?.tangentWorld?.sourceId;
    const node = owner === undefined ? undefined : core.controller.world().areas.find((entry) => entry.key === areaKey(owner));
    if (node?.shard.scene === undefined || node.shard.scene === null || source === undefined) return;
    const world = core.controller.world();
    const next = {
      ...world,
      areas: world.areas.map((entry) => entry.key === node.key ? { ...entry, shard: { ...entry.shard, scene: setBlockHidden(entry.shard.scene as never, source, true) } } : entry),
    };
    core.controller.commitWorld(next, { changedOwners: [shardOwner(node.key)] }, "hide");
    core.controller.setSelection([]);
    core.session.programmaticSelection = null;
  };
  return {
    snapshot,
    view: input.view,
    scene,
    announce,
    /** The deepest visible Area at a scene point, or the located Area when the point is over none. */
    ownerAt: (at: Point<"scene">) => shardOwner(deepestVisibleArea(scene, at) ?? snapshot.locatedArea),
    /** The Map's own size in screen pixels. */
    viewport: () => measure(core.host),
    liveCamera,
    scrollTo,
    /** True when the person asked for reduced motion. */
    reducedMotion: () => globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches,
    runAction,
    hideBlock,
    openSurface: input.openSurface,
    closeSurface: input.closeSurface,
  };
}

/** Builds the dependency record every publish takes. */
export function buildPublishDeps(core: RuntimeCore, reads: RuntimeReads, nonPointer: { begin: (kind: string) => void; settle: () => void }): PublishDeps {
  return {
    controller: core.controller,
    session: core.session,
    pointer: core.pointer,
    projection: core.projection,
    /** Speaks and shows one sentence about what the publish did. */
    announce: (text: string) => reads.announce(text),
    ownerAt: reads.ownerAt,
    beginNonPointer: nonPointer.begin,
    settleNonPointer: nonPointer.settle,
  };
}

/** The pointer session's publish callback: a released drag publishes what Excalidraw holds. */
export function buildPointerPublish(deps: PublishDeps): (request: PublishRequest) => void {
  return (request) => {
    if (request.elements === null) {
      publishCurrentState(deps);
      return;
    }
    publishToWorld(deps, request.elements, { ...selectionAppState(request.selection ?? []), editingTextElement: null });
  };
}

/** The Area an Only toggle or a Resources opening targets: the selected Area, else the located one. */
export function targetArea(snapshot: Snapshot, scene: VisibleScene): AreaKey {
  for (const element of snapshot.composition.scene.elements) {
    const tangent = element.customData?.tangent;
    if (snapshot.selection.has(element.id) && tangent?.role === "area-region" && tangent.area !== undefined && scene.scopedAreas.has(tangent.area)) return tangent.area;
  }
  return snapshot.locatedArea;
}

