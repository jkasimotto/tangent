// The placement effects: everything a resource layer does to the controller and the canvas. A
// resource row's one placement button reaches `placeResourceOnMap`, which is Show on Map for a
// placed resource, Restore on Map for a hidden one, and a preview placement otherwise. The
// preview's point is kept inside the owning Area through the bounds the store clamps by; the
// first point is the nearest free spot among the Area's Blocks through the kernel's collision
// search. A commit hands the Block to the resources chain's mutation through the `placeBlock`
// port. Nothing here touches the DOM: focus, surfaces and the canvas are ports the Map root wires.

import { PLACEMENT, RESOURCE_ANNOUNCEMENTS } from "../../copy.ts";
import type { Representation } from "../../copy.ts";
import {
  AREA_MAP_LAYOUT, createEmptyScene, isAreaBoundary, isAreaRegion, nearestFreeRectangle, placeBlockAtNearestFreePoint, resourceLocatorKey, runtimeId,
  setBlockHidden, shardHulls, tangentOf,
} from "../../kernel/kernel-boundary.ts";
import type { AreaNode, BlockChoice, BlockStyle, Composition, MapElement, ResourceEntity, ResourceLocator, SceneElement, Shard, Snapshot, SourceElement, SourceScene } from "../../kernel/kernel-types.ts";
import { LAYOUT } from "../../layout/layout-tokens.ts";
import { point, rect, size } from "../../units/frames.ts";
import type { Frame, Point, Rect } from "../../units/frames.ts";
import { sourceId } from "../../units/ids.ts";
import type { AreaKey, SourceId } from "../../units/ids.ts";
import { rectCenter } from "../../units/scalar-math.ts";
import { count, scenePx, sourcePx } from "../../units/units.ts";
import { boundedPlacementPoint, resourceLayerKey, returnTarget } from "./placement-store.ts";
import type { ArrowKey, LayerOpener, Locate, Placement, PlacementAction, PlacementBounds, PlacementState, ReturnTarget } from "./placement-store.ts";
import { areaLeaf, captureViewLayer, ownerArea, restoreViewLayer, revealOwner } from "./placement-view-layer.ts";
import type { LayerPorts } from "./placement-view-layer.ts";

/** How the canvas moves to show elements: animated, which the canvas skips under reduced motion, or an immediate jump. */
export type ScrollMotion = "animate" | "jump";

/** Which surfaces a layer closes when it opens. The wide Resources panel stays open beside a placement; the narrow sheet cannot. */
export type SurfacesToClose = { readonly picker: boolean; readonly resources: boolean };

/** Where a committed resource Block lands, for the resources chain's mutation. The command name is what the Map history records. */
export type PlacementTarget = {
  readonly area: AreaKey;
  readonly point: Point<"scene">;
  readonly command: "place-resource";
};

/** One request to place, show or restore a resource, from a row or the picker. */
export type PlaceRequest = {
  readonly entity: ResourceEntity;
  /** The row's Map state as the resources chain resolved it. */
  readonly representation: Representation;
  /** The control that asked, for returning focus when the layer ends. */
  readonly element: HTMLElement | null;
  /** True when this request resumes after the owner's Map loaded; a second miss is final. */
  readonly awaited?: boolean;
};

/** Everything the placement effects need from the Map around them. Each port is one door the Map root wires. */
export type PlacementPorts = LayerPorts & {
  readonly dispatch: (action: PlacementAction) => void;
  readonly announce: (text: string) => void;
  /** Scrolls the canvas to fit the elements. */
  readonly scrollTo: (elements: readonly SceneElement[], motion: ScrollMotion) => void;
  /** Where a Block lands when the owner has no rectangle yet: `input/placement-point.ts`. */
  readonly fallbackPoint: () => Point<"scene">;
  /** Adds the Block to the owning shard through the resources chain's canonical mutation. */
  readonly placeBlock: (choice: BlockChoice, target: PlacementTarget) => void;
  /** True when the catalog and transport allow a Map representation change. */
  readonly writesAvailable: () => boolean;
  /** True when the Resources surface is the narrow modal sheet. */
  readonly narrowResources: () => boolean;
  /** What is open now, with the control that asked, captured into the layer. */
  readonly opener: (element: HTMLElement | null) => LayerOpener;
  readonly closeSurfaces: (which: SurfacesToClose) => void;
  /** Reopens what the layer replaced and moves focus there; the kit owns the focus call. */
  readonly returnTo: (target: ReturnTarget) => void;
};

const PREVIEW_ID = sourceId("tangent-resource-placement-preview");
const SIZE_ID = sourceId("tangent-resource-placement-size");
const POINT_ID = sourceId("tangent-resource-placement-point");
const PREVIEW_STYLE: BlockStyle = { opacity: LAYOUT.placementPreviewOpacity, strokeStyle: "dashed" };
const EMPTY_STATUS = "";
/** The shard states a deferred Map can still be loaded from. */
const LOADABLE_STATES: ReadonlySet<Shard["state"]> = new Set<Shard["state"]>(["deferred", "loading", "load-error", "missing"]);

/** True when the element is the resource's Block: a resource Block whose reference is the resource's id. */
function isResourceBlockOf(element: MapElement<Frame>, locator: ResourceLocator): boolean {
  const tangent = tangentOf(element);
  return tangent?.kind === "resource" && tangent.ref === locator.id;
}

/** True for a disposable projection element: a preview, a figure icon, an endpoint dot. */
function isEphemeral(element: SceneElement): boolean {
  return Boolean(element.customData?.tangentWorldEphemeral);
}

/** The resource's live Block on the composed scene, or null when it is hidden or absent. */
function resourceBlockOnScene(snapshot: Snapshot, locator: ResourceLocator): SceneElement | null {
  return snapshot.composition.scene.elements.find((element) => !element.isDeleted && isResourceBlockOf(element, locator) && element.customData?.tangentWorld?.owner === locator.owner) ?? null;
}

/** The Block choice the preview and the commit share: the resource, by its id, titled with its label. */
function resourceChoice(entity: ResourceEntity, status: string, style?: BlockStyle): BlockChoice {
  return style ? { kind: "resource", ref: entity.locator.id, title: entity.label, status, style } : { kind: "resource", ref: entity.locator.id, title: entity.label, status };
}

/**
 * A scene point read as a point of an empty shard. The preview and the size probe are built in an
 * empty shard whose origin is the scene origin, so the scene coordinates are its source coordinates.
 */
function inEmptyShard(at: Point<"scene">): Point<"source"> {
  return point("source", sourcePx(at.x), sourcePx(at.y));
}

/** The Block the kernel draws for the choice at a point of an empty shard, or null when it drew nothing. */
function probeBlock(entity: ResourceEntity, at: Point<"scene">, id: SourceId, status: string, style?: BlockStyle): { scene: SourceScene; root: SourceElement | null } {
  return placeBlockAtNearestFreePoint(createEmptyScene(), resourceChoice(entity, status, style), inEmptyShard(at), id);
}

/** The rectangle a composed element occupies. */
function elementRect(element: SceneElement): Rect<"scene"> {
  return rect("scene", element.x, element.y, element.width, element.height);
}

/** The elements of the empty preview shard as scene elements, marked disposable so no save keeps them. The frames coincide; see `inEmptyShard`. */
function ephemeralInScene(elements: readonly SourceElement[]): SceneElement[] {
  return (elements as unknown as readonly SceneElement[]).map((element) => ({ ...element, customData: { ...(element.customData ?? {}), tangentWorldEphemeral: true } }));
}

/** The dashed, translucent preview of the placement at its current point, for the projection to draw beside the scene. */
export function placementPreviewElements(placement: Placement): SceneElement[] {
  return ephemeralInScene(probeBlock(placement.entity, placement.point, PREVIEW_ID, PLACEMENT.previewStatus, PREVIEW_STYLE).scene.elements);
}

/** One string that changes whenever the preview must be redrawn: the resource and its point. Empty with no placement. */
export function placementProjectionKey(placement: Placement | null): string {
  if (!placement) return "";
  return `${resourceLocatorKey(placement.entity.locator) ?? ""}:${placement.point.x}:${placement.point.y}`;
}

/** The owner's rectangle and the preview Block's size, or null when the owner has no rectangle on the canvas. */
export function placementBounds(entity: ResourceEntity, composition: Composition): PlacementBounds | null {
  const box = composition.regionRects.get(ownerArea(entity.locator));
  if (!box) return null;
  const root = probeBlock(entity, point("scene", scenePx(0), scenePx(0)), SIZE_ID, EMPTY_STATUS).root;
  if (!root) return null;
  return { box, size: size("scene", scenePx(root.width), scenePx(root.height)) };
}

/** The nearest free centre for the resource's Block among the owner's Blocks, from the owner's centre, or null when no Block could be drawn. */
export function freePlacementPoint(entity: ResourceEntity, snapshot: Snapshot, fallback: () => Point<"scene">): Point<"scene"> | null {
  const owner = entity.locator.owner;
  const box = snapshot.composition.regionRects.get(ownerArea(entity.locator));
  const root = probeBlock(entity, box ? rectCenter(box) : fallback(), POINT_ID, EMPTY_STATUS).root;
  if (!root) return null;
  const preferred = rect("scene", scenePx(root.x), scenePx(root.y), scenePx(root.width), scenePx(root.height));
  const occupied = snapshot.composition.scene.elements
    .filter((element) => !element.isDeleted && !isEphemeral(element) && element.customData?.tangentWorld?.owner === owner)
    .map(elementRect);
  return rectCenter(nearestFreeRectangle(preferred, occupied, { gap: scenePx(AREA_MAP_LAYOUT.spacing) }));
}

/** Starts the preview for a resource whose owner's Map is loaded. */
function beginPlacement(ports: PlacementPorts, request: PlaceRequest, owner: AreaKey): boolean {
  const entity = request.entity;
  const at = freePlacementPoint(entity, ports.controller.snapshot(), ports.fallbackPoint);
  if (at === null) {
    ports.announce(RESOURCE_ANNOUNCEMENTS.previewNotGenerated);
    return false;
  }
  const placement: Placement = { entity, area: owner, key: resourceLayerKey(entity.locator), point: at, layer: captureViewLayer(ports), opener: ports.opener(request.element) };
  const target = revealOwner(ports, owner);
  if (target) ports.scrollTo([target], "animate");
  ports.closeSurfaces({ picker: true, resources: ports.narrowResources() });
  ports.dispatch({ kind: "begin", placement });
  ports.returnTo({ kind: "canvas" });
  ports.announce(RESOURCE_ANNOUNCEMENTS.placing(entity.label));
  return true;
}

/** Loads a nested Area's deferred Map first and remembers the request, so placing from its row never refuses. */
function awaitOwnerLoad(ports: PlacementPorts, request: PlaceRequest, node: AreaNode | undefined): boolean {
  if (request.awaited || !node || !LOADABLE_STATES.has(node.shard.state)) {
    ports.announce(RESOURCE_ANNOUNCEMENTS.placementUnavailable);
    return false;
  }
  ports.dispatch({ kind: "await-load", pending: { owner: node.key, entity: request.entity, element: request.element } });
  void ports.controller.materialize(node.key);
  ports.announce(RESOURCE_ANNOUNCEMENTS.loadingThenPlacing(areaLeaf(node.key), request.entity.label));
  return true;
}

/** The one entry for a row's placement button: Show for a placed resource, Restore for a hidden one, a preview placement otherwise. */
export function placeResourceOnMap(ports: PlacementPorts, request: PlaceRequest): boolean {
  if (request.representation === "on-map") return showResourceOnMap(ports, request);
  if (!ports.writesAvailable()) {
    ports.announce(RESOURCE_ANNOUNCEMENTS.reloadBeforeRepresentation);
    return false;
  }
  if (request.representation === "hidden") return restoreResourceOnMap(ports, request.entity);
  if (request.representation === "unavailable") {
    ports.announce(RESOURCE_ANNOUNCEMENTS.placementUnavailable);
    return false;
  }
  const owner = ownerArea(request.entity.locator);
  const node = ports.controller.world().areas.find((entry) => entry.key === owner);
  if (!node?.shard.scene) return awaitOwnerLoad(ports, request, node);
  return beginPlacement(ports, request, owner);
}

/** Resumes a placement once the nested Map it waited for settled: begins it when the Map loaded, says so when it did not. */
export function resumePendingPlacement(ports: PlacementPorts, state: PlacementState): void {
  const pending = state.pending;
  if (!pending) return;
  const node = ports.controller.world().areas.find((entry) => entry.key === pending.owner);
  if (node && (node.shard.state === "deferred" || node.shard.state === "loading")) return;
  ports.dispatch({ kind: "load-settled" });
  if (node?.shard.scene) placeResourceOnMap(ports, { entity: pending.entity, representation: "never-placed", element: pending.element, awaited: true });
  else ports.announce(RESOURCE_ANNOUNCEMENTS.loadFailedNoPlacement(areaLeaf(pending.owner)));
}

/** Shows a placed resource's Block as one reversible layer: reveal its Area, select it, scroll to it, and close the panel and picker. */
export function showResourceOnMap(ports: PlacementPorts, request: Pick<PlaceRequest, "entity" | "element">): boolean {
  const entity = request.entity;
  const block = resourceBlockOnScene(ports.controller.snapshot(), entity.locator);
  if (!block) {
    ports.announce(RESOURCE_ANNOUNCEMENTS.notVisibleOnMap);
    return false;
  }
  const locate: Locate = { entity, blockId: block.id, key: resourceLayerKey(entity.locator), layer: captureViewLayer(ports), opener: ports.opener(request.element) };
  revealOwner(ports, ownerArea(entity.locator));
  ports.controller.setSelection([block.id]);
  ports.projectView({ selection: new Set([block.id]) }, "placed-block-selection");
  ports.scrollTo([block], "animate");
  ports.dispatch({ kind: "show", locate });
  ports.closeSurfaces({ picker: true, resources: true });
  ports.returnTo({ kind: "canvas" });
  ports.announce(RESOURCE_ANNOUNCEMENTS.shown(entity.label));
  return true;
}

/** A shard with a new scene and the counts and hulls the world solver reads from it. */
function withScene(shard: Shard, scene: SourceScene): Shard {
  const authored = scene.elements.filter((element) => !element.isDeleted && !isAreaRegion(element) && !isAreaBoundary(element));
  const hulls = shardHulls(scene);
  return { ...shard, scene, elementCount: count(authored.length), blockCount: count(authored.filter((element) => tangentOf(element) !== null).length), ownBlockHull: hulls.blocks, ownInkHull: hulls.ink };
}

/** Restores a hidden resource's retained Block and label as one undoable Map command, then shows it. */
export function restoreResourceOnMap(ports: PlacementPorts, entity: ResourceEntity): boolean {
  if (!ports.writesAvailable()) {
    ports.announce(RESOURCE_ANNOUNCEMENTS.reloadBeforeRepresentation);
    return false;
  }
  const owner = ownerArea(entity.locator);
  const world = ports.controller.world();
  const node = world.areas.find((entry) => entry.key === owner);
  const source = node?.shard.scene?.elements.find((element) => isResourceBlockOf(element, entity.locator));
  if (!node?.shard.scene || !source?.isDeleted) {
    ports.announce(RESOURCE_ANNOUNCEMENTS.hiddenNotRestored);
    return false;
  }
  const shard = withScene(node.shard, setBlockHidden(node.shard.scene, source.id, false));
  ports.controller.commitWorld({ ...world, areas: world.areas.map((entry) => (entry.key === owner ? { ...entry, shard } : entry)) }, { changedOwners: [shard.owner] }, "restore-resource");
  const runtime = runtimeId(shard.owner, source.id);
  ports.controller.setSelection([runtime]);
  ports.projectView({ selection: new Set([runtime]) }, "placed-block-selection");
  const restored = ports.controller.snapshot().composition.scene.elements.find((element) => element.id === runtime);
  if (restored) ports.scrollTo([restored], "jump");
  ports.closeSurfaces({ picker: true, resources: true });
  ports.returnTo({ kind: "canvas" });
  ports.announce(RESOURCE_ANNOUNCEMENTS.restored(entity.label));
  return true;
}

/** Commits the preview at a point, bounded to the owner, through the resources chain's mutation. */
export function commitPlacement(ports: PlacementPorts, state: PlacementState, at: Point<"scene"> | null, through: "pointer" | "key"): boolean {
  const placement = state.placing;
  if (!placement) return false;
  const exact = boundedPlacementPoint(placementBounds(placement.entity, ports.controller.snapshot().composition), at ?? placement.point);
  ports.dispatch({ kind: "commit", through });
  ports.placeBlock(resourceChoice(placement.entity, EMPTY_STATUS), { area: placement.area, point: exact, command: "place-resource" });
  ports.returnTo({ kind: "canvas" });
  ports.announce(RESOURCE_ANNOUNCEMENTS.placed(placement.entity.label));
  return true;
}

/** Cancels the preview without touching the scene or the history, restores the view, and returns to the Place control. */
export function cancelPlacement(ports: PlacementPorts, state: PlacementState): boolean {
  const placement = state.placing;
  if (!placement) return false;
  ports.dispatch({ kind: "cancel" });
  restoreViewLayer(ports, placement.layer);
  ports.returnTo(returnTarget(placement.opener, { attribute: "resource-place", key: placement.key }));
  ports.announce(RESOURCE_ANNOUNCEMENTS.placementCancelled);
  return true;
}

/** Escape from Show on Map: restores the prior view and returns to the Show control. */
export function returnFromShow(ports: PlacementPorts, state: PlacementState): boolean {
  const locate = state.locating;
  if (!locate) return false;
  ports.dispatch({ kind: "return" });
  restoreViewLayer(ports, locate.layer);
  ports.returnTo(returnTarget(locate.opener, { attribute: "resource-show", key: locate.key }));
  ports.announce(RESOURCE_ANNOUNCEMENTS.returned(locate.entity.label));
  return true;
}

/** Moves the preview under the pointer, kept inside the owner. */
export function movePlacement(ports: PlacementPorts, state: PlacementState, pointer: Point<"scene">): void {
  if (!state.placing) return;
  ports.dispatch({ kind: "move", point: pointer, bounds: placementBounds(state.placing.entity, ports.controller.snapshot().composition) });
}

/** Moves the preview by one arrow step, or one fine step with Shift, kept inside the owner. */
export function nudgePlacement(ports: PlacementPorts, state: PlacementState, arrow: ArrowKey, fine: boolean): void {
  if (!state.placing) return;
  ports.dispatch({ kind: "nudge", arrow, fine, bounds: placementBounds(state.placing.entity, ports.controller.snapshot().composition) });
}

/** A pointer-down while placing commits at the press. True when the press was the placement's, so no gesture begins. */
export function placementPointerDown(ports: PlacementPorts, state: PlacementState, origin: Point<"scene">): boolean {
  if (!state.placing) return false;
  return commitPlacement(ports, state, origin, "pointer");
}

/** The pointer-up after a pointer commit belongs to the placement too. True when it was swallowed. */
export function placementPointerUp(ports: PlacementPorts, state: PlacementState): boolean {
  if (!state.pointerCommit) return false;
  ports.dispatch({ kind: "pointer-released" });
  return true;
}
