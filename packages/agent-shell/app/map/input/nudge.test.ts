import { strict as assert } from "node:assert";
import { test } from "node:test";
import { regionId, regionKey } from "../kernel/kernel-boundary.ts";
import type { AreaNode, Region, SceneElement, Selection, Shard, Snapshot, TreeDigest, World, WorldDigest, WorldId } from "../kernel/kernel-types.ts";
import { delta, rect } from "../units/frames.ts";
import type { Delta, Rect } from "../units/frames.ts";
import { areaKey, runtimeId, shardOwner, sourceId } from "../units/ids.ts";
import { count, scenePx, sourcePx, zoom } from "../units/units.ts";
import { elementRect } from "./hit-test.ts";
import type { VisibleScene } from "./hit-test.ts";
import { displacedElements, nudgeMeaning, nudgeSelection, nudgedIds } from "./nudge.ts";
import { PointerSession } from "./pointer-session.ts";
import type { PointerController, PointerScheduler, PublishRequest } from "./pointer-session.ts";

const OTTO = shardOwner("otto");
const TANGENT = areaKey("otto/tangent");
const REGION_ID = runtimeId("region-otto/tangent");
const BLOCK_ID = runtimeId("block");
const LABEL_ID = runtimeId("block-label");
const RIGHT: Delta<"scene"> = delta("scene", scenePx(10), scenePx(0));

/** A scene rect from raw test numbers. */
const box = (x: number, y: number, width: number, height: number): Rect<"scene"> => rect("scene", scenePx(x), scenePx(y), scenePx(width), scenePx(height));

/** One composed element with the fields the nudge reads. */
function element(id: string, bounds: Rect<"scene">, extra: Partial<SceneElement> = {}): SceneElement {
  return {
    id: runtimeId(id), type: "rectangle", x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    angle: 0 as SceneElement["angle"], strokeColor: "#000000", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid",
    roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false,
    boundElements: null, updated: 1, link: null, locked: false, ...extra,
  };
}

/** The scene a nudge runs over: one Area region, one Block, and the label bound to that Block. */
function scene(): VisibleScene {
  const region = element(REGION_ID, box(100, 100, 400, 300), { customData: { tangent: { role: "area-region", area: TANGENT } } });
  const block = element(BLOCK_ID, box(150, 150, 100, 60), { boundElements: [{ id: LABEL_ID, type: "text" }] });
  const label = element(LABEL_ID, box(160, 170, 80, 20), { containerId: BLOCK_ID });
  return {
    elements: [region, block, label], regionRects: new Map([[TANGENT, elementRect(region)]]),
    hiddenIds: new Set(), scopedAreas: new Set([TANGENT]), folded: new Set(), zoom: zoom(1),
  };
}

/** The stored region of the test world, in its parent's source frame. */
function region(): Region {
  return {
    key: regionKey(OTTO, TANGENT), owner: OTTO, child: TANGENT, sourceId: regionId(OTTO, TANGENT),
    labelSourceId: sourceId(`${regionId(OTTO, TANGENT)}-label`), source: "stored",
    storedRect: rect("source", sourcePx(60), sourcePx(60), sourcePx(400), sourcePx(300)),
  };
}

/** A deferred shard with no content hulls. */
function shard(): Shard {
  return { owner: shardOwner(TANGENT), hash: null, revision: null, state: "deferred", elementCount: count(0), blockCount: count(0), ownBlockHull: null, ownInkHull: null };
}

/** The one-Area world the nudge solves against. */
function world(): World {
  const node: AreaNode = { key: TANGENT, parent: OTTO, children: [], depth: count(1), region: region(), shard: shard() };
  return {
    schema: "area-map-world.v1", worldId: "world-1" as WorldId, treeRevision: "tree-1" as TreeDigest, worldRevision: "world-rev-1" as WorldDigest,
    locatedArea: TANGENT, rootShard: { ...shard(), owner: OTTO }, areas: [node],
  };
}

/** A controller snapshot with the one field the session reads. The Map's element has thirty fields and none of the rest is read here. */
function snapshotOf(value: World): Snapshot {
  const elements = value.areas.map((node) => ({ id: runtimeId(`region-${node.key}`), x: scenePx(node.region.storedRect.x) }));
  return { scene: { elements } } as unknown as Snapshot;
}

/** A session over a controller that keeps whatever a preview installs, with the publishes and the frame queue exposed. */
function session(): { session: PointerSession; published: PublishRequest[]; ended: () => number; live: () => World } {
  const base = world();
  let current = base;
  let ended = 0;
  /** Opens the one word and hands back the baseline the solver reads. */
  const beginGesture = (): World => base;
  /** Keeps whatever a preview installed. */
  const preview = (next: World): void => { current = next; };
  /** Closes the word and counts it. */
  const endGesture = (kind?: string): { id: string; kind: string } => { ended += 1; return { id: "command-1", kind: kind ?? "pointer" }; };
  /** The world the controller holds now. */
  const live = (): World => current;
  /** The projected scene of the world the controller holds now. */
  const snapshot = (): Snapshot => snapshotOf(current);
  /** Never runs a frame: every nudge settles before one could arrive. */
  const frame = (): void => undefined;
  const published: PublishRequest[] = [];
  /** Records one publish instead of writing to a shard. */
  const publish = (request: PublishRequest): void => { published.push(request); };
  const controller: PointerController = { beginGesture, preview, endGesture, world: live, snapshot };
  const scheduler: PointerScheduler = { frame };
  /** How many controller words this session has closed. */
  const closed = (): number => ended;
  return { session: new PointerSession({ controller, publish, scheduler }), published, ended: closed, live };
}

/** The stored x of the one Area in a world. */
function storedX(value: World): number {
  return value.areas[0]?.region.storedRect.x ?? Number.NaN;
}

test("what an arrow key means is read from the selection the way a press reads it from the point", () => {
  const visible = scene();
  assert.deepEqual(nudgeMeaning(visible, new Set([REGION_ID])), { kind: "move-area", area: TANGENT });
  assert.deepEqual(nudgeMeaning(visible, new Set([BLOCK_ID])), { kind: "grab-element", id: BLOCK_ID });
  assert.equal(nudgeMeaning(visible, new Set()), null);
});

test("a nudge carries the labels and arrows bound to what is selected", () => {
  const visible = scene();
  assert.deepEqual([...nudgedIds(visible.elements, new Set([BLOCK_ID]))].sort(), [BLOCK_ID, LABEL_ID].sort());
  assert.deepEqual([...nudgedIds(visible.elements, new Set())], []);
});

test("only the moving elements are displaced, and by exactly the step", () => {
  const visible = scene();
  const moved = displacedElements(visible.elements, new Set([BLOCK_ID, LABEL_ID]), RIGHT);
  assert.deepEqual(moved.map((item) => item.x), [100, 160, 170]);
  assert.deepEqual(moved.map((item) => item.y), [100, 150, 170]);
  assert.equal(moved[0], visible.elements[0], "an element that does not move is returned as it was");
});

test("nudging a selected Area solves through the kernel and closes one word", () => {
  const gesture = session();
  const result = nudgeSelection(gesture.session, { scene: scene(), selection: new Set([REGION_ID]), delta: RIGHT });
  assert.equal(result.kind, "area");
  assert.equal(result.kind === "area" ? result.area : null, TANGENT);
  assert.deepEqual(result.kind === "area" ? result.preview?.appliedDelta : null, { dx: 10, dy: 0 });
  assert.equal(storedX(gesture.live()), 70);
  assert.equal(gesture.ended(), 1);
  assert.equal(gesture.session.isOpen(), false);
});

test("nudging Blocks publishes the elements the Map moved, because Excalidraw never saw the key", () => {
  const gesture = session();
  const selection: Selection = new Set([BLOCK_ID]);
  const result = nudgeSelection(gesture.session, { scene: scene(), selection, delta: RIGHT });
  assert.equal(result.kind, "elements");
  assert.deepEqual(result.kind === "elements" ? result.elements.map((item) => item.x) : [], [100, 160, 170]);
  assert.equal(gesture.published.length, 2, "the moved scene, then the release state the closing word publishes");
  assert.deepEqual(gesture.published[0]?.elements?.map((item) => item.x), [100, 160, 170]);
  assert.deepEqual(gesture.published[0]?.selection, selection);
  assert.equal(gesture.published[1]?.elements, null);
  assert.equal(gesture.ended(), 1);
  assert.equal(storedX(gesture.live()), 60, "a Block nudge asks the Area solver for nothing");
});

test("an arrow key with nothing selected opens no gesture", () => {
  const gesture = session();
  assert.deepEqual(nudgeSelection(gesture.session, { scene: scene(), selection: new Set(), delta: RIGHT }), { kind: "none" });
  assert.equal(gesture.ended(), 0);
  assert.equal(gesture.session.isOpen(), false);
});

test("a new arrow key supersedes the pointer gesture still open, rather than joining its word", () => {
  const gesture = session();
  gesture.session.begin({ kind: "move-area", area: TANGENT }, { point: { x: scenePx(0), y: scenePx(0) } as never, selection: new Set() });
  nudgeSelection(gesture.session, { scene: scene(), selection: new Set([REGION_ID]), delta: RIGHT });
  assert.equal(gesture.ended(), 2, "the open pointer word closes first, then the nudge's own word");
  assert.equal(storedX(gesture.live()), 70);
});
