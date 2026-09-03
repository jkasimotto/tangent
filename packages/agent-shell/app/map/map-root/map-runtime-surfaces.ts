// The environments each surface declared, built from the shared reads.
//
// Find, the picker, the placement layers and the Resources panel each named the doors they need out
// of the Map. This file opens exactly those doors and no others: everything a surface can do to the
// controller, the canvas or another surface passes through one of the records below, so a surface
// never reaches for a global and the Map root stays the only place the wiring is written.

import type { Projection } from "../canvas/projection.ts";
import { visibleSceneFromSnapshot } from "../input/hit-test.ts";
import { placementSpotOf } from "../surfaces/picker/picker-effects.ts";
import type { PickerEnvironment, PlacementView } from "../surfaces/picker/picker-effects.ts";
import type { FindEnvironment } from "../surfaces/find/find-effects.ts";
import type { FindAction } from "../surfaces/find/find-store.ts";
import type { PickerAction, PlacementSpot } from "../surfaces/picker/picker-store.ts";
import type { PlacementAction } from "../surfaces/placement/placement-store.ts";
import type { PlacementPorts, PlacementTarget } from "../surfaces/placement/placement-effects.ts";
import type { CanvasView } from "../surfaces/placement/placement-view-layer.ts";
import type { ResourceEffects } from "../surfaces/resources/resources-effects.ts";
import type { ResourcePanelPorts } from "../surfaces/resources/resources-views.ts";
import type { BlockChoice, ResourcePanelRow } from "../kernel/kernel-types.ts";
import type { ResourceChoiceFacts } from "../surfaces/picker/picker-choices.ts";
import type { RuntimeCore, RuntimeReads } from "./map-runtime.ts";
import type { AreaKey, RuntimeId } from "../units/ids.ts";

/** The dispatchers the surface stores were given, so an effect can change its own store. */
export type SurfaceDispatch = {
  readonly find: (action: FindAction) => void;
  readonly picker: (action: PickerAction) => void;
  readonly placement: (action: PlacementAction) => void;
};

/** What every surface environment is built from. */
export type SurfaceInput = Pick<PlacementPorts, "writesAvailable" | "narrowResources" | "opener" | "closeSurfaces" | "returnTo"> & {
  readonly core: RuntimeCore;
  readonly reads: RuntimeReads;
  readonly dispatch: SurfaceDispatch;
  /** The Resource rows of one Area with their resolved facts, from the Resources surface. */
  readonly resourceChoices: (area: AreaKey) => readonly ResourceChoiceFacts[];
  /** Hands a Resource choice to the placement layer, which owns Resource placement. */
  readonly placeResource: (row: ResourcePanelRow) => void;
  /** Adds one chosen Block to the owning shard through the Resources chain's mutation. */
  readonly placeBlock: (choice: BlockChoice, target: PlacementTarget) => void;
  /** Starts editing a newly placed Block's label on the canvas. */
  readonly editLabel: (labelId: RuntimeId) => void;
  /** Selects one Area's region and pushes the selection into Excalidraw. */
  readonly selectArea: (area: AreaKey) => void;
  /** Asks the Resources surface to load one Area's rows. */
  readonly loadResources: (area: AreaKey) => void;
  /** Ends an open Show on Map layer, because a new view replaces the one it captured. */
  readonly releaseShowOnMap: () => void;
  readonly resourceEffects: ResourceEffects;
  readonly resourcePorts: ResourcePanelPorts;
};

/** Pushes a camera or a selection into Excalidraw with no history entry. */
function projectView(projection: Projection, view: CanvasView): void {
  projection.project({
    ...(view.selection === undefined ? {} : { selection: view.selection }),
    ...(view.camera === undefined ? {} : { camera: view.camera }),
  }, "view-return");
}

/** What the Map shows now, from which the placement point is derived. */
export function placementView(input: SurfaceInput): PlacementView {
  const snapshot = input.core.controller.snapshot();
  return {
    camera: input.reads.liveCamera() ?? snapshot.camera,
    viewport: input.reads.viewport(),
    lastPointer: input.core.session.lastPointer,
    scene: visibleSceneFromSnapshot(snapshot),
    locatedArea: snapshot.locatedArea,
  };
}

/** Where B, paste and Place land now. */
export function currentPlacementSpot(input: SurfaceInput): PlacementSpot {
  return placementSpotOf(placementView(input));
}

/** Builds the environment Find runs in. */
export function buildFindEnvironment(input: SurfaceInput): FindEnvironment {
  const { core, reads } = input;
  return {
    controller: core.controller,
    /** The vault documents the Map paints facts from. */
    documents: () => reads.view.documents,
    resolveBlock: reads.view.resolveBlock,
    areaName: reads.view.areaName,
    scrollTo: reads.scrollTo,
    /** Puts Excalidraw's camera back where Cancel wants it, without entering history. */
    moveCamera: (camera) => core.controller.setCamera(camera),
    reducedMotion: reads.reducedMotion,
    releaseShowOnMap: input.releaseShowOnMap,
    /** Speaks one sentence without showing it as the toast. */
    announce: (text: string) => reads.announce(text, false),
    dispatch: input.dispatch.find,
  };
}

/** Builds the environment the picker runs in. */
export function buildPickerEnvironment(input: SurfaceInput): PickerEnvironment {
  const { core, reads } = input;
  return {
    controller: core.controller,
    /** The vault documents the picker chooses from. */
    documents: () => reads.view.documents,
    /** What the Map shows now, from which the placement spot is derived. */
    placementView: () => placementView(input),
    resourceChoices: input.resourceChoices,
    ...(core.options.searchDocuments ? { searchDocuments: core.options.searchDocuments } : {}),
    placeResource: input.placeResource,
    selectArea: input.selectArea,
    loadResources: input.loadResources,
    editLabel: input.editLabel,
    /** Speaks one sentence without showing it as the toast. */
    announce: (text: string) => reads.announce(text, false),
    dispatch: input.dispatch.picker,
  };
}

/** Builds the ports the placement layers run on. */
export function buildPlacementPorts(input: SurfaceInput): PlacementPorts {
  const { core, reads } = input;
  return {
    controller: core.controller,
    liveCamera: reads.liveCamera,
    /** Pushes a camera or a selection into Excalidraw with no history entry. */
    projectView: (view: CanvasView) => projectView(core.projection, view),
    dispatch: input.dispatch.placement,
    /** Speaks and shows one sentence about the placement. */
    announce: (text: string) => reads.announce(text),
    /** Scrolls the canvas to fit the elements. */
    scrollTo: (elements, motion) => reads.scrollTo(elements, motion === "animate" && !reads.reducedMotion()),
    /** Where a Block lands when the owner has no rectangle yet. */
    fallbackPoint: () => currentPlacementSpot(input).point,
    placeBlock: input.placeBlock,
    writesAvailable: input.writesAvailable,
    narrowResources: input.narrowResources,
    opener: input.opener,
    closeSurfaces: input.closeSurfaces,
    returnTo: input.returnTo,
  };
}

