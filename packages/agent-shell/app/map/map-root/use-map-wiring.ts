// The Map root's wiring, built fresh on every render.
//
// `MapRoot.tsx` owns the state and the long-lived objects. This hook turns them into the records
// every module declared: the shared reads, the publish and canvas dependencies, the command
// dependencies, and one environment per surface. It is written as a hook only so it can hold the
// Resources effects context, which owns the in-flight fences of the panel and must outlive a
// repaint; everything else it returns is derived and changes with the render.

import { useRef } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { CANVAS_ANNOUNCEMENTS } from "../copy.ts";
import { finishBufferedTextEdit, browserSettle } from "../canvas/text-edit.ts";
import type { CanvasHandlers } from "../canvas/MapCanvas.tsx";
import { asSceneElements } from "../canvas/projection.ts";
import { createResourceEffects, loadResources } from "../surfaces/resources/resources-effects.ts";
import type { ResourceEffects } from "../surfaces/resources/resources-effects.ts";
import { closeResourceDetails, closeResourceRecovery, closeSceneRecovery, holdResourceDraft, viewResourceArea } from "../surfaces/resources/resource-actions.ts";
import { hideResourceOnMap } from "../surfaces/resources/resources-scene-mutations.ts";
import { resolutionForRow, resourceEntityForRow, resourceRowFacts } from "../surfaces/resources/resource-rows.ts";
import { representationForRow } from "../surfaces/resources/resources-scene-mutations.ts";
import { cancelPlacement, commitPlacement, movePlacement, placeResourceOnMap, returnFromShow } from "../surfaces/placement/placement-effects.ts";
import type { PlacementTarget } from "../surfaces/placement/placement-effects.ts";
import { cancelFind, findMatches, openFind, stepFind } from "../surfaces/find/find-effects.ts";
import { openPicker, pasteReference, placeBlock } from "../surfaces/picker/picker-effects.ts";
import type { ResourceChoiceFacts } from "../surfaces/picker/picker-choices.ts";
import { operationId } from "../units/ids.ts";
import { areaKey } from "../units/ids.ts";
import type { AreaKey, RuntimeId, ShardOwner } from "../units/ids.ts";
import { translate } from "../units/scalar-math.ts";
import type { Point } from "../units/frames.ts";
import type { BlockChoice, MapEntityAction, MapEntityFacts, MapKindsCatalog, ResourcePanelRow, SceneElement, Snapshot, World } from "../kernel/kernel-types.ts";
import type { SurfaceId } from "../surfaces/surface-registry.ts";
import type { MapStores } from "./use-map-stores.ts";
import type { MapCore } from "./use-map-core.ts";
import type { MapView } from "./map-root-view.ts";
import { buildPublishDeps, buildPointerPublish, buildReads, targetArea } from "./map-runtime.ts";
import type { RuntimeReads } from "./map-runtime.ts";
import { buildFindEnvironment, buildPickerEnvironment, buildPlacementPorts } from "./map-runtime-surfaces.ts";
import type { SurfaceInput } from "./map-runtime-surfaces.ts";
import { createCanvasHandlers } from "./map-root-canvas.ts";
import type { CanvasDeps } from "./map-root-canvas.ts";
import { runKeyCommand } from "./map-root-commands.ts";
import type { CommandDeps } from "./map-root-commands.ts";
import { buildCommandDeps, buildEscape } from "./map-root-wiring-commands.ts";
import { elementRect } from "../input/hit-test.ts";
import { startCanvasTextEdit } from "../ui/canvas-text-edit.ts";
import { mapCanvasElement } from "../ui/canvas-focus.ts";

/** Everything one render of the Map root is wired with. */
export type MapWiring = {
  readonly reads: RuntimeReads;
  readonly canvas: CanvasDeps;
  readonly handlers: CanvasHandlers;
  readonly commands: CommandDeps;
  readonly surfaces: SurfaceInput;
  readonly effects: ResourceEffects;
  readonly escape: () => { readonly kind: string };
  readonly openResources: (area: AreaKey, opener: HTMLElement | null) => void;
  readonly openSurface: (id: SurfaceId, opener?: HTMLElement | null) => void;
  readonly closeSurface: (id: SurfaceId) => void;
  readonly runCommand: (command: Parameters<typeof runKeyCommand>[1]) => void;
};

/** What the wiring needs from the root. */
export type WiringInput = {
  readonly core: MapCore;
  readonly stores: MapStores;
  readonly snapshot: Snapshot;
  readonly view: MapView;
  readonly setApi: (api: ExcalidrawImperativeAPI) => void;
};

/** Builds every dependency record one render of the Map root needs. */
export function useMapWiring(input: WiringInput): MapWiring {
  const { core, stores, snapshot, view } = input;
  /** Opens one surface and remembers the control focus returns to. */
  const openSurface = (id: SurfaceId, opener: HTMLElement | null = null): void => {
    core.session.openers.set(id, opener);
    stores.dispatchStack({ type: "open", id });
  };
  /** Closes one surface and everything opened above it. */
  const closeSurface = (id: SurfaceId): void => {
    stores.dispatchStack({ type: "close", id });
  };
  const reads = buildReads({
    core, snapshot, view,
    announceAction: stores.dispatchAnnounce,
    openSurface,
    closeSurface,
    /** Opens the dialog a refused copy or open needs. */
    openActionRecovery: (facts: MapEntityFacts, action: MapEntityAction, message: string) => {
      stores.dispatchResources({ type: "set-recovery", recovery: { result: { kind: "unavailable" }, entity: facts, action, message } });
      openSurface("resourceRecovery");
    },
    /** Runs a shell navigation the browser cannot do itself. */
    runShellAction: (facts, action, opener) => runShellAction(input, action, facts, opener),
  });
  const nonPointer = buildNonPointer(core);
  const publishDeps = buildPublishDeps(core, reads, nonPointer);
  core.publishRef.current = buildPointerPublish(publishDeps);
  const effectsRef = useRef<ResourceEffects | null>(null);
  if (effectsRef.current === null) effectsRef.current = buildResourceEffects(input, reads);
  const effects = effectsRef.current;
  const surfaces = buildSurfaceInput(input, reads, effects, openSurface, closeSurface);
  const commands = buildCommandDeps(input, reads, publishDeps, surfaces, openSurface, closeSurface);
  const canvas: CanvasDeps = {
    ...publishDeps,
    buffer: core.buffer,
    /** True while a resource placement waits for its point. */
    placementOpen: () => stores.placement.placing !== null,
    /** Commits the open placement at one scene point. */
    commitPlacement: (at: Point<"scene">) => { commitPlacement(buildPlacementPorts(surfaces), stores.placement, at, "pointer"); },
    /** Moves the open placement preview to one scene point. */
    movePlacement: (at: Point<"scene">) => movePlacement(buildPlacementPorts(surfaces), stores.placement, at),
    /** Claims a pasted Tangent reference for the Map. */
    claimPaste: (text: string) => pasteReference(buildPickerEnvironment(surfaces), text),
    /** Drops a Show on Map layer once the person changes the world themselves. */
    onUserChange: () => { if (stores.placement.locating !== null) returnFromShow(buildPlacementPorts(surfaces), stores.placement); },
  };
  const escape = buildEscape(input, surfaces, commands);
  return {
    reads, canvas, handlers: createCanvasHandlers(canvas, input.setApi), commands: { ...commands, escape }, surfaces, effects, escape,
    /** Opens the Resources panel on one Area. */
    openResources: (area: AreaKey, opener: HTMLElement | null) => {
      stores.dispatchResources({ type: "open", area });
      openSurface("resources", opener);
      void loadResources(effects, area);
    },
    openSurface,
    closeSurface,
    /** Runs one routed key command. */
    runCommand: (command) => runKeyCommand({ ...commands, escape }, command),
  };
}

/** Opens and closes the one non-pointer command a change outside a pointer gesture lands in. */
function buildNonPointer(core: MapCore): { begin: (kind: string) => void; settle: () => void } {
  return {
    /** Opens the command, unless a pointer gesture already owns the change. */
    begin: (kind: string) => {
      if (core.pointer.isOpen() || core.session.nonPointer !== null) return;
      core.session.nonPointer = { kind, baseline: core.controller.beginGesture(kind) };
    },
    /** Closes the command once Excalidraw has settled, unless a text editor is still open. */
    settle: () => {
      browserSettle(() => {
        const open = core.session.nonPointer;
        if (open === null || core.session.api?.getAppState().editingTextElement) return;
        core.session.nonPointer = null;
        core.controller.endGesture(open.kind);
      });
    },
  };
}

/** Builds the Resources effects context, which holds the panel's in-flight fences for the Map's life. */
function buildResourceEffects(input: WiringInput, reads: RuntimeReads): ResourceEffects {
  const { core, stores } = input;
  return createResourceEffects({
    api: core.options.api ?? null,
    dispatch: stores.dispatchResources,
    /** The panel state as it is now, read at call time so an effect never sees a stale copy. */
    getState: () => stores.resources,
    controller: core.controller,
    announce: reads.announce,
    /** Mints the id one mutation is retried under. */
    mintOperationId: () => operationId(crypto.randomUUID()),
    /** The workspace rollout flag for resource writes. */
    writesEnabled: () => Boolean(core.options.api),
    scheduler: {
      /** Runs the callback on an interval and returns the stopper. */
      every: (callback, interval) => {
        const timer = setInterval(callback, interval);
        return () => clearInterval(timer);
      },
    },
    /** Hides one composed Block through the Map's own hide command. */
    hideBlock: (block: SceneElement) => reads.hideBlock(block),
  });
}

/** Builds the record every surface environment is made from. */
function buildSurfaceInput(input: WiringInput, reads: RuntimeReads, effects: ResourceEffects, openSurface: (id: SurfaceId, opener?: HTMLElement | null) => void, closeSurface: (id: SurfaceId) => void): SurfaceInput {
  const { core, stores } = input;
  const ports = {
    effects,
    kinds: input.snapshot.mapKinds ?? null,
    world: input.snapshot.world,
    /** The display name of one Area or shard owner. */
    areaName: (area: AreaKey | ShardOwner) => reads.view.areaName(areaKey(area)),
    /** Shows, restores or places one row on the Map. */
    placeOnMap: (row: ResourcePanelRow) => placeRow(surfaceInput, row, null),
    placementActive: stores.placement.placing !== null,
    /** Closes the panel and pops its surface. */
    close: () => {
      stores.dispatchResources({ type: "close" });
      closeSurface("resources");
    },
  };
  const surfaceInput: SurfaceInput = {
    core, reads,
    dispatch: { find: stores.dispatchFind, picker: stores.dispatchPicker, placement: stores.dispatchPlacement },
    /** The Resource rows of one Area with their resolved facts. */
    resourceChoices: (area: AreaKey) => resourceChoicesOf(stores, input.snapshot.mapKinds ?? null, input.snapshot.world, area),
    /** Hands a Resource choice to the placement layer. */
    placeResource: (row: ResourcePanelRow) => placeRow(surfaceInput, row, null),
    /** Adds one chosen Block to the owning shard through the controller. */
    placeBlock: (choice: BlockChoice, target: PlacementTarget) => { void placeBlock(buildPickerEnvironment(surfaceInput), { ...choice }, { area: target.area, point: target.point }, false); },
    /** Starts editing a newly placed Block's label on the canvas, once the projection has drawn it. */
    editLabel: (labelId: RuntimeId) => editPlacedLabel(core, labelId),
    /** Selects one Area's region without moving the camera. */
    selectArea: (area: AreaKey) => selectArea(input, area),
    /** Asks the Resources surface to load one Area's rows. */
    loadResources: (area: AreaKey) => { void loadResources(effects, area); },
    /** Ends an open Show on Map layer. */
    releaseShowOnMap: () => { if (stores.placement.locating !== null) returnFromShow(buildPlacementPorts(surfaceInput), stores.placement); },
    /** True when the catalog and transport allow a Map representation change. */
    writesAvailable: () => Boolean(core.options.api),
    /** True while the Resources surface is the narrow modal sheet. */
    narrowResources: () => stores.resources.narrow,
    /** What is open now, with the control that asked. */
    opener: (element: HTMLElement | null) => ({ element, resources: stores.resources.open ? { area: stores.resources.area, details: stores.resources.details } : null, picker: stores.picker.target !== null }),
    /** Closes the surfaces a layer replaces. */
    closeSurfaces: (which) => {
      if (which.picker) closeSurface("picker");
      if (which.resources) closeSurface("resources");
    },
    /** Reopens what a layer replaced. */
    returnTo: (target) => {
      if (target.kind !== "resources" || target.area === null) return;
      stores.dispatchResources({ type: "open", area: target.area });
      openSurface("resources");
    },
    resourceEffects: effects,
    resourcePorts: ports,
  };
  return surfaceInput;
}

/** Shows, restores or places one Resource row on the Map. */
function placeRow(input: SurfaceInput, row: ResourcePanelRow, element: HTMLElement | null): void {
  const entity = resourceEntityForRow(row);
  if (entity === null) return;
  placeResourceOnMap(buildPlacementPorts(input), { entity, representation: representationForRow(input.core.controller.world(), row), element });
}

/** The picker's Resource choices for one Area: its rows with the facts the panel resolved. */
function resourceChoicesOf(stores: MapStores, kinds: MapKindsCatalog | null, world: World, area: AreaKey): ResourceChoiceFacts[] {
  if (stores.resources.area !== area) return [];
  const choices: ResourceChoiceFacts[] = [];
  for (const row of stores.resources.projection?.rows ?? []) {
    const facts = resourceRowFacts(row, resolutionForRow(stores.resources.resolutions, row), kinds);
    if (facts === null) continue;
    choices.push({ row, facts, representation: representationForRow(world, row) });
  }
  return choices;
}

/** Selects one Area's region and pushes the selection into Excalidraw. */
function selectArea(input: WiringInput, area: AreaKey): void {
  const element = input.core.controller.selectArea(area);
  if (element === null) return;
  input.core.session.stableSelection = new Set([element.id]);
  input.core.session.programmaticSelection = new Set([element.id]);
  input.core.projection.project({ selection: [element.id] }, "area-selection");
}

/** Runs one shell navigation the browser cannot do itself. */
function runShellAction(input: WiringInput, action: MapEntityAction, facts: MapEntityFacts, opener: HTMLElement | null): boolean {
  void opener;
  const options = input.core.options;
  if (typeof options.onEntityAction === "function") {
    options.onEntityAction(action, facts);
    return true;
  }
  if (action.kind === "open-goal") options.onEntityVerb?.({ kind: "goal", ref: action.file, verb: "enter" });
  else if (action.kind === "open-document") options.onEntityVerb?.({ kind: "document", ref: `${action.file}${action.subpath ?? ""}`, verb: action.mode === "read" ? "read" : "open" });
  else if (action.kind === "open-area-brain") options.onEntityVerb?.({ kind: "area", area: action.area, ref: `${action.area}/${action.area.split("/").at(-1)}.md`, verb: "enter" });
  else return false;
  return true;
}

/** The rows Find matches now, computed once per render. */
export function findRowsOf(surfaces: SurfaceInput, query: string): ReturnType<typeof findMatches> {
  return query.trim() ? findMatches(buildFindEnvironment(surfaces), query) : [];
}

/** Moves the Resources panel to one Area, which the breadcrumb and an inherited row both do. */
export function viewArea(effects: ResourceEffects, area: AreaKey): void {
  void viewResourceArea(effects, area);
}

/** Hides one Resource row's Block, which the row's Hide control does. */
export function hideRow(effects: ResourceEffects, row: ResourcePanelRow): void {
  void hideResourceOnMap(effects, row);
}

/** Opens Excalidraw's text editor on a newly placed Block's label, once the projection has drawn it. */
function editPlacedLabel(core: MapCore, labelId: RuntimeId): void {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const snapshot = core.controller.snapshot();
    const label = snapshot.composition.scene.elements.find((element) => element.id === labelId && element.type === "text");
    const appState = core.session.api?.getAppState();
    if (label === undefined || appState === undefined) return;
    core.projection.project({ elements: snapshot.scene.elements, selection: [labelId] }, "placed-block-selection");
    requestAnimationFrame(() => startCanvasTextEdit(core.host, snapshot.camera, appState, elementRect(label)));
  }));
}
