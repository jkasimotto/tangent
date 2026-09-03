import { strict as assert } from "node:assert";
import { test } from "node:test";
import { regionId, regionKey } from "../kernel/kernel-boundary.ts";
import type { AreaNode, Region, SceneElement, Selection, Shard, Snapshot, TreeDigest, World, WorldDigest, WorldId } from "../kernel/kernel-types.ts";
import { point, rect } from "../units/frames.ts";
import type { Point } from "../units/frames.ts";
import { areaKey, runtimeId, shardOwner, sourceId } from "../units/ids.ts";
import type { AreaKey, RuntimeId } from "../units/ids.ts";
import { count, scenePx, sourcePx } from "../units/units.ts";
import {
  PointerSession, areasOfMeaning, gestureBaselineOf, handleOfMeaning, isSolvedMeaning, remapClaimedIdentities, resolveClaimedId, worldWithRegions,
} from "./pointer-session.ts";
import type { PointerController, PointerScheduler, PublishRequest } from "./pointer-session.ts";
import type { PressMeaning } from "./press-meaning.ts";

const OTTO = shardOwner("otto");
const TANGENT = areaKey("otto/tangent");
const MOVE: PressMeaning = { kind: "move-area", area: TANGENT };

/** A scene point from raw test numbers. */
const at = (x: number, y: number): Point<"scene"> => point("scene", scenePx(x), scenePx(y));

/** One stored region of the test world, in its parent's source frame. */
function region(): Region {
  return {
    key: regionKey(OTTO, TANGENT), owner: OTTO, child: TANGENT, sourceId: regionId(OTTO, TANGENT),
    labelSourceId: sourceId(`${regionId(OTTO, TANGENT)}-label`), source: "stored",
    storedRect: rect("source", sourcePx(60), sourcePx(60), sourcePx(400), sourcePx(300)),
  };
}

/** A deferred shard: no scene, so its stored hulls are what the solver baseline reads. */
function shard(): Shard {
  return {
    owner: shardOwner(TANGENT), hash: null, revision: null, state: "deferred", elementCount: count(0), blockCount: count(0),
    ownBlockHull: rect("source", sourcePx(0), sourcePx(0), sourcePx(120), sourcePx(80)), ownInkHull: null,
  };
}

/** A one-Area world: the smallest world the kernel's Area solver accepts. */
function world(): World {
  const node: AreaNode = { key: TANGENT, parent: OTTO, children: [], depth: count(1), region: region(), shard: shard() };
  return {
    schema: "area-map-world.v1", worldId: "world-1" as WorldId, treeRevision: "tree-1" as TreeDigest, worldRevision: "world-rev-1" as WorldDigest,
    locatedArea: TANGENT, rootShard: { ...shard(), owner: OTTO }, areas: [node],
  };
}

/** One stub scene element carrying the position the test reads. The Map's element has thirty fields and none of the rest is read here. */
function regionElement(node: AreaNode): SceneElement {
  return { id: runtimeId(`region-${node.key}`), x: scenePx(node.region.storedRect.x), y: scenePx(node.region.storedRect.y) } as unknown as SceneElement;
}

/** A controller snapshot with the one field the session reads: the projected scene. */
function snapshotOf(value: World): Snapshot {
  return { scene: { elements: value.areas.map(regionElement) } } as unknown as Snapshot;
}

/** What one fake controller recorded, so a test asserts the gesture's shape rather than its side effects. */
type ControllerLog = { began: number; ended: number; previews: World[] };

/** A controller that opens a word, keeps whatever a preview installs, and closes the word. */
function fakeController(): { controller: PointerController; log: ControllerLog; live: () => World } {
  const base = world();
  let current = base;
  const log: ControllerLog = { began: 0, ended: 0, previews: [] };
  /** Opens the one word and hands back the baseline every preview solves from. */
  const beginGesture = (): World => { log.began += 1; return base; };
  /** Keeps whatever a preview installed, so the next read sees it. */
  const preview = (next: World): void => { current = next; log.previews.push(next); };
  /** Closes the word and names the command it recorded. */
  const endGesture = (kind?: string): { id: string; kind: string } => { log.ended += 1; return { id: "command-1", kind: kind ?? "pointer" }; };
  /** The world the controller holds now. */
  const live = (): World => current;
  /** The projected scene of the world the controller holds now. */
  const snapshot = (): Snapshot => snapshotOf(current);
  return { controller: { beginGesture, preview, endGesture, world: live, snapshot }, log, live };
}

/** A scheduler whose frames a test runs by hand. */
function manualScheduler(): { scheduler: PointerScheduler; runFrames: () => void } {
  let queued: (() => void)[] = [];
  /** Queues one frame instead of asking the browser for it. */
  const frame = (run: () => void): void => { queued.push(run); };
  const scheduler: PointerScheduler = { frame };
  /** Runs every frame queued so far, including frames those frames queue. */
  const runFrames = (): void => {
    while (queued.length > 0) {
      const running = queued;
      queued = [];
      for (const run of running) run();
    }
  };
  return { scheduler, runFrames };
}

/** A session over a fake controller, with the publish requests and the frame queue exposed. */
function session(): { session: PointerSession; log: ControllerLog; published: PublishRequest[]; runFrames: () => void; live: () => World } {
  const { controller, log, live } = fakeController();
  const { scheduler, runFrames } = manualScheduler();
  const published: PublishRequest[] = [];
  /** Records one publish instead of writing to a shard. */
  const publish = (request: PublishRequest): void => { published.push(request); };
  return { session: new PointerSession({ controller, publish, scheduler }), log, published, runFrames, live };
}

/** The stored rectangle of the one Area in a world. */
function storedRect(value: World): Region["storedRect"] {
  const node = value.areas[0];
  assert.ok(node !== undefined);
  return node.region.storedRect;
}

test("a meaning names the Areas it moves, its handle, and whether the kernel solves it", () => {
  assert.deepEqual([...areasOfMeaning(MOVE)], [TANGENT]);
  assert.deepEqual([...areasOfMeaning({ kind: "resize-area", area: TANGENT, handle: "se" })], [TANGENT]);
  assert.deepEqual([...areasOfMeaning({ kind: "rubber-band" })], []);
  assert.equal(handleOfMeaning({ kind: "resize-area", area: TANGENT, handle: "nw" }), "nw");
  assert.equal(handleOfMeaning(MOVE), null);
  assert.equal(isSolvedMeaning(MOVE), true);
  assert.equal(isSolvedMeaning({ kind: "grab-element", id: runtimeId("block") }), false);
  assert.equal(isSolvedMeaning(null), false);
});

test("the solver baseline carries every region and the hulls a deferred shard reports", () => {
  const baseline = gestureBaselineOf(world());
  assert.deepEqual(baseline.areas, [TANGENT]);
  assert.equal(baseline.regions.get(TANGENT)?.storedRect.x, 60);
  assert.deepEqual(baseline.blockHulls.get(TANGENT), { x: 0, y: 0, width: 120, height: 80 });
  assert.equal(baseline.inkHulls.size, 0);
});

test("begin opens one controller word and a second press inside it changes nothing", () => {
  const gesture = session();
  gesture.session.begin(MOVE, { point: at(10, 10), selection: new Set() });
  gesture.session.begin({ kind: "rubber-band" }, { point: at(90, 90), selection: new Set() });
  assert.equal(gesture.log.began, 1);
  assert.equal(gesture.session.isOpen(), true);
  assert.deepEqual(gesture.session.currentMeaning(), MOVE);
  assert.deepEqual(gesture.session.currentPoint(), { x: 10, y: 10 });
  assert.deepEqual([...gesture.session.selectedAreas()], [TANGENT]);
});

test("preview solves an Area move from the press point and installs it in the controller", () => {
  const gesture = session();
  gesture.session.begin(MOVE, { point: at(10, 10), selection: new Set() });
  const preview = gesture.session.preview(at(40, 30));
  assert.ok(preview !== null);
  assert.deepEqual(preview.appliedDelta, { dx: 30, dy: 20 });
  assert.equal(preview.valid, true);
  assert.ok(preview.changedAreas.has(TANGENT));
  assert.deepEqual(storedRect(gesture.live()), { x: 90, y: 80, width: 400, height: 300 });
  assert.deepEqual(preview.elements.map((element) => element.x), [90]);
  assert.equal(gesture.log.previews.length, 1);
});

test("preview solves from the immutable baseline, so a second move is not a second displacement", () => {
  const gesture = session();
  gesture.session.begin(MOVE, { point: at(10, 10), selection: new Set() });
  gesture.session.preview(at(40, 10));
  gesture.session.preview(at(20, 10));
  assert.equal(storedRect(gesture.live()).x, 70);
});

test("a meaning the kernel does not solve previews nothing and still tracks the pointer", () => {
  const gesture = session();
  gesture.session.begin({ kind: "grab-element", id: runtimeId("block") }, { point: at(10, 10), selection: new Set() });
  assert.equal(gesture.session.preview(at(40, 30)), null);
  assert.deepEqual(gesture.session.currentPoint(), { x: 40, y: 30 });
  assert.equal(gesture.log.previews.length, 0);
});

test("end publishes at once and closes the word two frames later", async () => {
  const gesture = session();
  gesture.session.begin(MOVE, { point: at(10, 10), selection: new Set() });
  gesture.session.preview(at(40, 30));
  const settled = gesture.session.waitForSettle();
  gesture.session.end();
  assert.equal(gesture.published.length, 1);
  assert.equal(gesture.session.isSettling(), true);
  assert.equal(gesture.log.ended, 0);
  gesture.runFrames();
  await settled;
  assert.equal(gesture.log.ended, 1);
  assert.equal(gesture.published.length, 2, "the release state is published again inside the closing word");
  assert.equal(gesture.session.isOpen(), false);
  assert.equal(gesture.session.isSettling(), false);
  assert.equal(gesture.session.currentMeaning(), null);
});

test("a settle supersedes the one end scheduled, so the word closes exactly once", () => {
  const gesture = session();
  gesture.session.begin(MOVE, { point: at(10, 10), selection: new Set() });
  gesture.session.end();
  gesture.session.settle();
  assert.equal(gesture.log.ended, 1);
  gesture.runFrames();
  assert.equal(gesture.log.ended, 1);
});

test("waiting for a settle that is not pending resolves at once", async () => {
  const gesture = session();
  await gesture.session.waitForSettle();
  gesture.session.begin(MOVE, { point: at(10, 10), selection: new Set() });
  gesture.session.settle();
  await gesture.session.waitForSettle();
  assert.equal(gesture.log.ended, 1);
});

test("publishing a scene the Map moved reaches the publish callback only inside an open word", () => {
  const gesture = session();
  const moved: readonly SceneElement[] = [];
  gesture.session.publishScene(moved, new Set());
  assert.equal(gesture.published.length, 0);
  gesture.session.begin(MOVE, { point: at(10, 10), selection: new Set() });
  gesture.session.publishScene(moved, new Set([runtimeId("block")]));
  assert.equal(gesture.published.length, 1);
  assert.deepEqual(gesture.published[0]?.elements, []);
});

test("claimed identities resolve through a chain and are forgotten when the word closes", () => {
  const gesture = session();
  gesture.session.begin(MOVE, { point: at(10, 10), selection: new Set() });
  gesture.session.claim(runtimeId("temp-1"), runtimeId("temp-2"));
  gesture.session.claim(runtimeId("temp-2"), runtimeId("world-1"));
  assert.equal(gesture.session.claimedId(runtimeId("temp-1")), "world-1");
  assert.equal(gesture.session.claimedId(runtimeId("untouched")), "untouched");
  assert.equal(gesture.session.claimedIdentities().size, 2);
  gesture.session.settle();
  assert.equal(gesture.session.claimedIdentities().size, 0);
});

test("a claimed chain that loops resolves rather than hanging", () => {
  const looped = new Map<RuntimeId, RuntimeId>([[runtimeId("a"), runtimeId("b")], [runtimeId("b"), runtimeId("a")]]);
  assert.equal(resolveClaimedId(looped, runtimeId("a")), "a");
});

test("a publish rewrites every claimed id an element carries", () => {
  const mapping = new Map<RuntimeId, RuntimeId>([[runtimeId("temp"), runtimeId("world")]]);
  const element = {
    id: runtimeId("temp"), containerId: runtimeId("temp"), frameId: runtimeId("temp"),
    boundElements: [{ id: runtimeId("temp"), type: "text" as const }],
  } as unknown as SceneElement;
  const [remapped] = remapClaimedIdentities([element], mapping);
  assert.equal(remapped?.id, "world");
  assert.equal(remapped?.containerId, "world");
  assert.equal(remapped?.frameId, "world");
  assert.equal(remapped?.boundElements?.[0]?.id, "world");
  assert.deepEqual(remapClaimedIdentities([element], new Map()), [element]);
});

test("the previewed world writes the solved region on the changed Area and leaves the rest alone", () => {
  const base = world();
  const solved: Region = { ...region(), source: "provisional", storedRect: rect("source", sourcePx(5), sourcePx(5), sourcePx(400), sourcePx(300)) };
  const changed: ReadonlySet<AreaKey> = new Set([TANGENT]);
  const next = worldWithRegions(base, new Map([[TANGENT, solved]]), changed);
  assert.equal(storedRect(next).x, 5);
  assert.equal(next.areas[0]?.region.source, "stored", "a previewed region is authored, never provisional");
  assert.equal(storedRect(base).x, 60, "the world the preview was built from is untouched");
  assert.deepEqual(worldWithRegions(base, new Map([[TANGENT, solved]]), new Set()).areas[0], base.areas[0]);
});

test("a gesture solves the Areas its context names, not only the ones its meaning does", () => {
  const gesture = session();
  const grab: PressMeaning = { kind: "grab-element", id: runtimeId("tw-block") };
  gesture.session.begin(grab, { point: at(10, 10), selection: new Set([runtimeId("tw-block")]), areas: new Set([TANGENT]) });
  assert.deepEqual([...gesture.session.selectedAreas()], [TANGENT]);
  const preview = gesture.session.preview(at(40, 30));
  assert.ok(preview !== null, "a grab that drags a selected Area solves it");
  assert.deepEqual(preview.appliedDelta, { dx: 30, dy: 20 });
});
