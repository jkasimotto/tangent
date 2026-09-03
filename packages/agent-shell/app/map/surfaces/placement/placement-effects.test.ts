import { strict as assert } from "node:assert";
import { test } from "node:test";
import { RESOURCE_ANNOUNCEMENTS } from "../../copy.ts";
import { runtimeId as composedId } from "../../kernel/kernel-boundary.ts";
import type { AreaMapController, CapturedView, Composition, ResourceEntity, SceneElement, Snapshot, SourceElement, World } from "../../kernel/kernel-types.ts";
import { LAYOUT } from "../../layout/layout-tokens.ts";
import { point, rect } from "../../units/frames.ts";
import type { Point } from "../../units/frames.ts";
import { areaKey, resourceId, runtimeId, shardOwner, sourceId } from "../../units/ids.ts";
import { scenePx, zoom } from "../../units/units.ts";
import {
  cancelPlacement, commitPlacement, freePlacementPoint, movePlacement, placeResourceOnMap, placementBounds, placementPointerDown, placementPointerUp, placementPreviewElements,
  placementProjectionKey, restoreResourceOnMap, resumePendingPlacement, returnFromShow, showResourceOnMap,
} from "./placement-effects.ts";
import type { PlacementPorts, PlacementTarget } from "./placement-effects.ts";
import { EMPTY_PLACEMENT_STATE, placementReducer } from "./placement-store.ts";
import type { PlacementAction, PlacementState, ReturnTarget } from "./placement-store.ts";

/** A scene point from raw test numbers. */
const sp = (x: number, y: number): Point<"scene"> => point("scene", scenePx(x), scenePx(y));

const OWNER = shardOwner("otto/tangent");
const ENTITY: ResourceEntity = { locator: { owner: OWNER, id: resourceId("repo-shared") }, label: "Shared repository", target: null, representation: "never-placed" };
const BOX = rect("scene", scenePx(100), scenePx(100), scenePx(1200), scenePx(800));

/** A resource Block on the composed scene, owned by the Area, at a rectangle. */
function resourceBlock(id: string, ref: string, x: number, y: number, isDeleted = false): SceneElement {
  return {
    id: runtimeId(id), type: "rectangle", x: scenePx(x), y: scenePx(y), width: scenePx(280), height: scenePx(132), isDeleted,
    customData: { tangent: { kind: "resource", ref }, tangentWorld: { owner: OWNER, sourceId: id } },
  } as unknown as SceneElement;
}

/** What one fake controller and its ports recorded. */
type Recorded = {
  actions: PlacementAction[];
  announced: string[];
  placed: { choice: unknown; target: PlacementTarget }[];
  returned: ReturnTarget[];
  closed: unknown[];
  scrolled: string[];
  calls: string[];
  selection: string[];
};

/** Builds ports over a fake controller whose snapshot shows the given elements and Area rectangle. */
function fakePorts(options: { elements?: SceneElement[]; sourceElements?: SourceElement[]; scoped?: boolean; box?: boolean; writes?: boolean; narrow?: boolean; shardState?: string; scene?: boolean } = {}): { ports: PlacementPorts; recorded: Recorded; state: () => PlacementState } {
  const recorded: Recorded = { actions: [], announced: [], placed: [], returned: [], closed: [], scrolled: [], calls: [], selection: [] };
  let state = EMPTY_PLACEMENT_STATE;
  const composition = { regionRects: new Map(options.box === false ? [] : [[areaKey("otto/tangent"), BOX]]), scene: { elements: options.elements ?? [] } } as unknown as Composition;
  const view: CapturedView = { camera: { scrollX: scenePx(5), scrollY: scenePx(6), zoom: zoom(1) }, locatedArea: areaKey("otto"), cameraTarget: null, cameraTrail: [], restrictionArea: null, selection: [], findRevealId: null };
  const snapshot = { composition, scopedAreas: new Set(options.scoped === false ? [] : [areaKey("otto/tangent")]), manualFolded: new Set([areaKey("otto")]), focus: { only: true, areas: [areaKey("otto")] }, camera: view.camera, selection: new Set() } as unknown as Snapshot;
  const world = { areas: [{ key: areaKey("otto/tangent"), shard: { owner: OWNER, state: options.shardState ?? "ready", scene: options.scene === false ? null : { elements: options.sourceElements ?? [] } } }] } as unknown as World;
  const controller = {
    /** The one snapshot every read sees. */
    snapshot: () => snapshot,
    /** The one world every read sees. */
    world: () => world,
    /** The view a layer captures. */
    captureView: () => view,
    /** Records the Only lift. */
    setRestriction: (area: unknown) => { recorded.calls.push(`setRestriction:${String(area)}`); },
    /** Records the Focus write. */
    setFocus: (focus: unknown) => { recorded.calls.push(`setFocus:${JSON.stringify(focus)}`); },
    /** Records one fold toggle. */
    toggleFold: (area: string) => { recorded.calls.push(`toggleFold:${area}`); return true; },
    /** Records the fit and hands back an element for the scroll. */
    fitArea: (area: string) => { recorded.calls.push(`fitArea:${area}`); return resourceBlock("region", "region", 0, 0); },
    /** Records the selection a layer sets. */
    setSelection: (ids: Iterable<string>) => { recorded.selection = [...ids]; },
    /** Records the restore and hands back the captured view. */
    restoreView: () => { recorded.calls.push("restoreView"); return { camera: view.camera, selection: new Set() }; },
    /** Records the deferred load a placement waits for. */
    materialize: (area: string) => { recorded.calls.push(`materialize:${area}`); return Promise.resolve(null); },
    /** Records the world commit a restore makes. */
    commitWorld: () => { recorded.calls.push("commitWorld"); return world; },
  } as unknown as AreaMapController;
  const ports: PlacementPorts = {
    controller,
    /** A camera ahead of the controller's, so the capture is proved to take Excalidraw's. */
    liveCamera: () => ({ scrollX: scenePx(9), scrollY: scenePx(9), zoom: zoom(2) }),
    /** Records the canvas write by its reason. */
    projectView: (_view, reason) => { recorded.calls.push(`project:${reason}`); },
    /** Records the action and runs the real reducer, so the state is the store's own. */
    dispatch: (action) => { recorded.actions.push(action); state = placementReducer(state, action); },
    /** Records one announcement. */
    announce: (text) => { recorded.announced.push(text); },
    /** Records how the canvas moved. */
    scrollTo: (_elements, motion) => { recorded.scrolled.push(motion); },
    /** The point used when the owner has no rectangle. */
    fallbackPoint: () => sp(50, 50),
    /** Records the mutation a commit hands to the resources chain. */
    placeBlock: (choice, target) => { recorded.placed.push({ choice, target }); },
    /** Whether the catalog and transport allow a representation change. */
    writesAvailable: () => options.writes ?? true,
    /** Whether the Resources surface is the narrow sheet. */
    narrowResources: () => options.narrow ?? false,
    /** An opener that always names the Resources view, so the return target is the Place control. */
    opener: (element) => ({ element, resources: { area: areaKey("otto/tangent"), details: null }, picker: false }),
    /** Records which surfaces the layer closed. */
    closeSurfaces: (which) => { recorded.closed.push(which); },
    /** Records where focus and the surfaces returned to. */
    returnTo: (target) => { recorded.returned.push(target); },
  };
  /** The store as the recorded dispatches left it. */
  const readState = (): PlacementState => state;
  return { ports, recorded, state: readState };
}

test("the preview is the resource's Block, dashed and translucent, marked disposable, centred on the point", () => {
  const { ports, state } = fakePorts();
  placeResourceOnMap(ports, { entity: ENTITY, representation: "never-placed", element: null });
  const placement = state().placing;
  assert.ok(placement);
  const preview = placementPreviewElements(placement);
  const root = preview.find((element) => element.customData?.tangent?.kind === "resource");
  assert.ok(root);
  assert.equal(root.strokeStyle, "dashed");
  assert.equal(root.opacity, LAYOUT.placementPreviewOpacity);
  assert.ok(preview.every((element) => element.customData?.tangentWorldEphemeral === true));
  assert.equal(root.x + root.width / 2, placement.point.x);
  assert.equal(root.y + root.height / 2, placement.point.y);
  assert.match(placementProjectionKey(placement), /^otto\/tangent.*repo-shared:\d+(\.\d+)?:\d+(\.\d+)?$/);
  assert.equal(placementProjectionKey(null), "");
});

test("the bounds are the owner's rectangle and the drawn Block's size", () => {
  const { ports } = fakePorts();
  const bounds = placementBounds(ENTITY, ports.controller.snapshot().composition);
  assert.deepEqual(bounds?.box, BOX);
  assert.equal(bounds?.size.width, LAYOUT.blockWidth);
  assert.equal(bounds?.size.height, LAYOUT.blockHeight);
  assert.equal(placementBounds(ENTITY, fakePorts({ box: false }).ports.controller.snapshot().composition), null);
});

test("the first point is the owner's centre, moved to the nearest free spot among the owner's Blocks", () => {
  const empty = fakePorts();
  const centre = freePlacementPoint(ENTITY, empty.ports.controller.snapshot(), empty.ports.fallbackPoint);
  assert.deepEqual(centre, { x: 700, y: 500 });
  const occupied = fakePorts({ elements: [resourceBlock("b1", "other", 700 - 140, 500 - 66)] });
  const moved = freePlacementPoint(ENTITY, occupied.ports.controller.snapshot(), occupied.ports.fallbackPoint);
  assert.ok(moved);
  assert.notDeepEqual(moved, centre);
  const noBox = fakePorts({ box: false });
  assert.deepEqual(freePlacementPoint(ENTITY, noBox.ports.controller.snapshot(), noBox.ports.fallbackPoint), { x: 50, y: 50 });
});

test("placing reveals the owner, captures the live camera, keeps the wide panel, and announces the keys", () => {
  const { ports, recorded, state } = fakePorts();
  assert.equal(placeResourceOnMap(ports, { entity: ENTITY, representation: "never-placed", element: null }), true);
  const placement = state().placing;
  assert.ok(placement);
  assert.equal(placement.key, encodeURIComponent("otto/tangent/repo-shared"));
  assert.equal(placement.area, "otto/tangent");
  assert.deepEqual(placement.layer.view.camera, { scrollX: 9, scrollY: 9, zoom: 2 });
  assert.deepEqual([...placement.layer.manualFolded], ["otto"]);
  assert.ok(recorded.calls.includes("toggleFold:otto"), "the folded ancestor is unfolded");
  assert.ok(recorded.calls.includes("fitArea:otto/tangent"));
  assert.ok(!recorded.calls.includes("setRestriction:null"), "Only stays when it already shows the owner");
  assert.deepEqual(recorded.closed, [{ picker: true, resources: false }]);
  assert.deepEqual(recorded.returned, [{ kind: "canvas" }]);
  assert.deepEqual(recorded.scrolled, ["animate"]);
  assert.equal(recorded.announced.at(-1), RESOURCE_ANNOUNCEMENTS.placing("Shared repository"));
});

test("the narrow sheet closes for a placement", () => {
  const { ports, recorded } = fakePorts({ narrow: true });
  placeResourceOnMap(ports, { entity: ENTITY, representation: "never-placed", element: null });
  assert.deepEqual(recorded.closed, [{ picker: true, resources: true }]);
});

test("a placement refuses without writes, with an unavailable source, or with a Map that cannot load", () => {
  const noWrites = fakePorts({ writes: false });
  assert.equal(placeResourceOnMap(noWrites.ports, { entity: ENTITY, representation: "never-placed", element: null }), false);
  assert.deepEqual(noWrites.recorded.announced, [RESOURCE_ANNOUNCEMENTS.reloadBeforeRepresentation]);
  const unavailable = fakePorts();
  assert.equal(placeResourceOnMap(unavailable.ports, { entity: ENTITY, representation: "unavailable", element: null }), false);
  assert.deepEqual(unavailable.recorded.announced, [RESOURCE_ANNOUNCEMENTS.placementUnavailable]);
  const unreadable = fakePorts({ scene: false, shardState: "unreadable" });
  assert.equal(placeResourceOnMap(unreadable.ports, { entity: ENTITY, representation: "never-placed", element: null }), false);
  assert.deepEqual(unreadable.recorded.announced, [RESOURCE_ANNOUNCEMENTS.placementUnavailable]);
});

test("a deferred owner is loaded first and the placement resumes once it settles", () => {
  const deferred = fakePorts({ scene: false, shardState: "deferred" });
  assert.equal(placeResourceOnMap(deferred.ports, { entity: ENTITY, representation: "never-placed", element: null }), true);
  assert.equal(deferred.state().pending?.owner, "otto/tangent");
  assert.ok(deferred.recorded.calls.includes("materialize:otto/tangent"));
  assert.deepEqual(deferred.recorded.announced, [RESOURCE_ANNOUNCEMENTS.loadingThenPlacing("tangent", "Shared repository")]);
  resumePendingPlacement(deferred.ports, deferred.state());
  assert.equal(deferred.state().pending?.owner, "otto/tangent", "still loading: nothing happens");

  const loaded = fakePorts();
  const pendingState = placementReducer(EMPTY_PLACEMENT_STATE, { kind: "await-load", pending: { owner: areaKey("otto/tangent"), entity: ENTITY, element: null } });
  resumePendingPlacement(loaded.ports, pendingState);
  assert.equal(loaded.recorded.actions[0]?.kind, "load-settled");
  assert.equal(loaded.state().placing?.entity, ENTITY);

  const failed = fakePorts({ scene: false, shardState: "load-error" });
  resumePendingPlacement(failed.ports, pendingState);
  assert.deepEqual(failed.recorded.announced, [RESOURCE_ANNOUNCEMENTS.loadFailedNoPlacement("tangent")]);
});

test("a commit hands the bounded point to the resources mutation and returns to the canvas", () => {
  const { ports, recorded, state } = fakePorts();
  placeResourceOnMap(ports, { entity: ENTITY, representation: "never-placed", element: null });
  assert.equal(commitPlacement(ports, state(), sp(0, 0), "key"), true);
  assert.equal(state().placing, null);
  assert.equal(recorded.placed.length, 1);
  assert.deepEqual(recorded.placed[0]?.target, { area: "otto/tangent", point: { x: 100 + LAYOUT.blockWidth / 2, y: 100 + LAYOUT.blockHeight / 2 }, command: "place-resource" });
  assert.deepEqual(recorded.placed[0]?.choice, { kind: "resource", ref: "repo-shared", title: "Shared repository", status: "" });
  assert.equal(recorded.announced.at(-1), RESOURCE_ANNOUNCEMENTS.placed("Shared repository"));
  assert.equal(commitPlacement(ports, state(), null, "key"), false);
});

test("a pointer-down commits at the press and the pointer-up after it is swallowed once", () => {
  const { ports, recorded, state } = fakePorts();
  assert.equal(placementPointerDown(ports, state(), sp(1, 1)), false);
  placeResourceOnMap(ports, { entity: ENTITY, representation: "never-placed", element: null });
  assert.equal(placementPointerDown(ports, state(), sp(700, 500)), true);
  assert.deepEqual(recorded.placed[0]?.target.point, { x: 700, y: 500 });
  assert.equal(state().pointerCommit, true);
  assert.equal(placementPointerUp(ports, state()), true);
  assert.equal(placementPointerUp(ports, state()), false);
});

test("move keeps the preview inside the owner", () => {
  const { ports, state } = fakePorts();
  placeResourceOnMap(ports, { entity: ENTITY, representation: "never-placed", element: null });
  movePlacement(ports, state(), sp(-1000, -1000));
  assert.deepEqual(state().placing?.point, { x: 100 + LAYOUT.blockWidth / 2, y: 100 + LAYOUT.blockHeight / 2 });
});

test("cancel restores the layer and returns to the Place control of the Resources view", () => {
  const { ports, recorded, state } = fakePorts();
  placeResourceOnMap(ports, { entity: ENTITY, representation: "never-placed", element: null });
  recorded.calls.length = 0;
  assert.equal(cancelPlacement(ports, state()), true);
  assert.equal(state().placing, null);
  assert.deepEqual(recorded.calls, ["setRestriction:null", 'setFocus:{"only":true,"areas":["otto"]}', "restoreView", "project:view-return"], "folds already match, so none toggles");
  assert.deepEqual(recorded.returned.at(-1), { kind: "resources", area: "otto/tangent", details: null, control: { attribute: "resource-place", key: encodeURIComponent("otto/tangent/repo-shared") } });
  assert.equal(recorded.announced.at(-1), RESOURCE_ANNOUNCEMENTS.placementCancelled);
  assert.equal(cancelPlacement(ports, state()), false);
});

test("Show on Map selects the live Block, closes the panel and the picker, and Escape returns to the Show control", () => {
  const block = resourceBlock("b1", "repo-shared", 200, 200);
  const { ports, recorded, state } = fakePorts({ elements: [block] });
  assert.equal(placeResourceOnMap(ports, { entity: ENTITY, representation: "on-map", element: null }), true);
  assert.equal(state().locating?.blockId, block.id);
  assert.deepEqual(recorded.selection, [block.id]);
  assert.ok(recorded.calls.includes("project:placed-block-selection"));
  assert.deepEqual(recorded.closed, [{ picker: true, resources: true }]);
  assert.deepEqual(recorded.returned, [{ kind: "canvas" }]);
  assert.equal(recorded.announced.at(-1), RESOURCE_ANNOUNCEMENTS.shown("Shared repository"));
  assert.equal(returnFromShow(ports, state()), true);
  assert.equal(state().locating, null);
  assert.deepEqual(recorded.returned.at(-1), { kind: "resources", area: "otto/tangent", details: null, control: { attribute: "resource-show", key: encodeURIComponent("otto/tangent/repo-shared") } });
  assert.equal(recorded.announced.at(-1), RESOURCE_ANNOUNCEMENTS.returned("Shared repository"));
  assert.equal(returnFromShow(ports, state()), false);
});

test("Show on Map refuses when the Block is not on the scene", () => {
  const hidden = fakePorts({ elements: [resourceBlock("b1", "repo-shared", 200, 200, true)] });
  assert.equal(showResourceOnMap(hidden.ports, { entity: ENTITY, element: null }), false);
  assert.deepEqual(hidden.recorded.announced, [RESOURCE_ANNOUNCEMENTS.notVisibleOnMap]);
});

test("Restore on Map refuses without writes or without a hidden source Block", () => {
  const noWrites = fakePorts({ writes: false });
  assert.equal(placeResourceOnMap(noWrites.ports, { entity: ENTITY, representation: "hidden", element: null }), false);
  assert.deepEqual(noWrites.recorded.announced, [RESOURCE_ANNOUNCEMENTS.reloadBeforeRepresentation]);
  const nothingHidden = fakePorts();
  assert.equal(placeResourceOnMap(nothingHidden.ports, { entity: ENTITY, representation: "hidden", element: null }), false);
  assert.deepEqual(nothingHidden.recorded.announced, [RESOURCE_ANNOUNCEMENTS.hiddenNotRestored]);
});

/** The hidden source Block of the resource, as its owner's shard stores it. */
function hiddenSourceBlock(): SourceElement {
  return {
    id: sourceId("src-repo-shared"), type: "rectangle", x: 0, y: 0, width: 280, height: 132, isDeleted: true, boundElements: [],
    customData: { tangent: { kind: "resource", ref: "repo-shared" } },
  } as unknown as SourceElement;
}

test("Restore on Map un-hides the retained Block as one Map command, selects it and jumps to it", () => {
  const restored = composedId(OWNER, sourceId("src-repo-shared"));
  const { ports, recorded } = fakePorts({ sourceElements: [hiddenSourceBlock()], elements: [resourceBlock(restored, "repo-shared", 300, 300)] });
  assert.equal(restoreResourceOnMap(ports, ENTITY), true);
  assert.ok(recorded.calls.includes("commitWorld"));
  assert.deepEqual(recorded.selection, [restored]);
  assert.ok(recorded.calls.includes("project:placed-block-selection"));
  assert.deepEqual(recorded.scrolled, ["jump"]);
  assert.deepEqual(recorded.closed, [{ picker: true, resources: true }]);
  assert.deepEqual(recorded.returned, [{ kind: "canvas" }]);
  assert.equal(recorded.announced.at(-1), RESOURCE_ANNOUNCEMENTS.restored("Shared repository"));
});

test("a placement lifts Only when the scope hides the owning Area", () => {
  const { ports, recorded } = fakePorts({ scoped: false });
  assert.equal(placeResourceOnMap(ports, { entity: ENTITY, representation: "never-placed", element: null }), true);
  assert.ok(recorded.calls.includes("setRestriction:null"), "Only is lifted so the owner can be seen");
});
