import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createAreaMapWorldController, createEmptyScene, placeBlockInSourceScene } from "../../kernel/kernel-boundary.ts";
import type { AreaMapController, MapEntityFacts, SceneElement, World, WorldDigest, WorldId, TreeDigest, ShardHash, RegionKey } from "../../kernel/kernel-types.ts";
import { rect } from "../../units/frames.ts";
import type { Camera } from "../../units/frames.ts";
import { areaKey, shardOwner, sourceId } from "../../units/ids.ts";
import type { AreaKey } from "../../units/ids.ts";
import { count, index, sourcePx } from "../../units/units.ts";
import { applyFindQuery, cancelFind, confirmFind, findMatches, openFind, selectFindRow, stepFind } from "./find-effects.ts";
import type { FindEnvironment } from "./find-effects.ts";
import { EMPTY_FIND_STATE, findReducer } from "./find-store.ts";
import type { FindAction, FindState } from "./find-store.ts";

const OTTO = areaKey("otto");
const TANGENT = areaKey("otto/tangent");
const BLOCK_LABEL = "Ship the map";

/** One ready Area node with an empty shard, or a shard holding one Goal Block when asked. */
function areaNode(key: AreaKey, parent: string, withBlock: boolean): World["areas"][number] {
  const empty = createEmptyScene();
  const scene = withBlock ? placeBlockInSourceScene(empty, { kind: "goal", ref: "otto/goal-ship.md", title: BLOCK_LABEL }, sourceId("block-1")).scene : empty;
  return {
    key, parent: shardOwner(parent), children: [], depth: count(key.split("/").length - 1),
    region: { key: `${parent}>${key}` as RegionKey, owner: shardOwner(parent), child: key, sourceId: sourceId(`region-${key}`), labelSourceId: sourceId(`region-${key}-label`), source: "stored", storedRect: rect("source", sourcePx(0), sourcePx(0), sourcePx(1200), sourcePx(800)) },
    shard: { owner: shardOwner(key), hash: `hash-${key}` as ShardHash, revision: null, state: "ready", elementCount: count(scene.elements.length), blockCount: count(withBlock ? 1 : 0), ownBlockHull: null, ownInkHull: null, scene },
  };
}

/** A two-Area world: otto holds one Goal Block, otto/tangent is empty. */
function world(): World {
  return {
    schema: "area-map-world.v1", worldId: "world" as WorldId, treeRevision: "tree" as TreeDigest, worldRevision: "rev" as WorldDigest, locatedArea: OTTO,
    rootShard: { owner: shardOwner("@root"), hash: null, revision: null, state: "deferred", elementCount: count(0), blockCount: count(0), ownBlockHull: null, ownInkHull: null },
    areas: [areaNode(OTTO, "@root", true), areaNode(TANGENT, "otto", false)],
  };
}

/** Resolved facts for the one Goal Block: matched on its words, shown by its label. */
function goalFacts(element: SceneElement): MapEntityFacts | null {
  if (element.customData?.tangent?.kind !== "goal") return null;
  return {
    source: { owner: shardOwner(OTTO), sourceId: sourceId("block-1") },
    reference: { kind: "vault", entityKind: "goal", ref: "otto/goal-ship.md" },
    kindId: "goal", states: [],
    display: { kindLabel: "Goal", label: BLOCK_LABEL, targetClue: "", stateText: [], externalTreatment: null, actionLabel: null },
    accessibleName: `Goal: ${BLOCK_LABEL}.`, searchText: `goal ${BLOCK_LABEL} shipping`, primaryAction: null, readAction: null, sourceState: "current",
  };
}

/** A recording environment over a real controller. */
function harness(): { env: FindEnvironment; controller: AreaMapController; log: string[]; state: () => FindState; cameras: Camera[] } {
  const controller = createAreaMapWorldController({ world: world() });
  const log: string[] = [];
  const cameras: Camera[] = [];
  let stored = EMPTY_FIND_STATE;
  const env: FindEnvironment = {
    controller,
    /** No vault documents; the Blocks resolve from their own metadata. */
    documents: () => [],
    resolveBlock: goalFacts,
    /** Names the two Areas the way their notes would. */
    areaName: (area) => (area === TANGENT ? "Tangent" : "Otto"),
    /** Records which elements the canvas was asked to fit, and whether it animated. */
    scrollTo: (elements, animate) => { log.push(`scroll:${elements.map((element) => element.id).join(",")}:${animate}`); },
    /** Records the camera Cancel put back. */
    moveCamera: (camera) => { cameras.push(camera); },
    /** Reduced motion is on, so every fit is immediate and the log is deterministic. */
    reducedMotion: () => true,
    /** Records that keeping a match ended a Show on Map return layer. */
    releaseShowOnMap: () => { log.push("release"); },
    /** Records a spoken sentence. */
    announce: (text) => { log.push(`say:${text}`); },
    /** Applies the action through the real reducer and records its kind. */
    dispatch: (action: FindAction) => { stored = findReducer(stored, action); log.push(`do:${action.kind}`); },
  };
  /** The store state the recorded dispatches have built up. */
  const state = (): FindState => stored;
  return { env, controller, log, state, cameras };
}

test("findMatches lists visible Areas by display name and Blocks by their resolved words, shown by label", () => {
  const { env } = harness();
  const areas = findMatches(env, "tang");
  assert.deepEqual(areas.map((row) => [row.kind, row.name]), [["area", "Tangent"]]);
  const blocks = findMatches(env, "shipping");
  assert.equal(blocks.length, 1);
  assert.deepEqual([blocks[0]?.kind, blocks[0]?.name, blocks[0]?.area], ["goal", BLOCK_LABEL, OTTO]);
  assert.deepEqual(findMatches(env, "nothing here"), []);
});

test("applyFindQuery previews the first match and says how many, or says no match", () => {
  const { env, log, state, controller } = harness();
  openFind(env);
  assert.equal(state().open, true);
  applyFindQuery(env, "ship");
  assert.equal(state().query, "ship");
  assert.ok(log.some((entry) => entry.startsWith("scroll:") && entry.endsWith(":false")), log.join("\n"));
  assert.ok(log.includes(`say:1 match, ${BLOCK_LABEL} in view`), log.join("\n"));
  assert.equal(controller.snapshot().selection.size, 1);
  assert.notEqual(controller.snapshot().findRevealId, null);
  applyFindQuery(env, "zzz");
  assert.equal(state().kept, false);
  assert.equal(controller.snapshot().findRevealId, null);
  assert.equal(log.at(-1), "say:No match");
});

test("stepFind wraps through Areas then Blocks and announces the position", () => {
  const { env, log, state } = harness();
  openFind(env);
  applyFindQuery(env, "o");
  const total = findMatches(env, "o").length;
  assert.ok(total >= 2, `expected at least two matches, got ${total}`);
  assert.equal(stepFind(env, state(), "previous"), true);
  assert.equal(state().index, total - 1);
  assert.equal(log.at(-1), `say:${total} of ${total}, ${findMatches(env, "o").at(-1)?.name} in view`);
  assert.equal(stepFind(env, state(), "next"), true);
  assert.equal(state().index, 0);
  applyFindQuery(env, "zzz");
  assert.equal(stepFind(env, state(), "next"), false);
});

test("selectFindRow moves to the pointed row and speaks the preview sentence", () => {
  const { env, log, state } = harness();
  openFind(env);
  applyFindQuery(env, "o");
  const rows = findMatches(env, "o");
  assert.equal(selectFindRow(env, state(), index(rows.length - 1)), true);
  assert.equal(state().index, rows.length - 1);
  assert.equal(log.at(-1), `say:${rows.length} matches, ${rows.at(-1)?.name} in view`);
  assert.equal(selectFindRow(env, state(), index(rows.length)), false);
});

test("confirmFind fits the row's Area with a return step, keeps the match and closes", () => {
  const { env, log, state, controller } = harness();
  openFind(env);
  applyFindQuery(env, "tang");
  assert.equal(confirmFind(env, state()), true);
  assert.deepEqual([state().open, state().kept, state().origin], [false, true, null]);
  assert.equal(controller.snapshot().cameraTarget, TANGENT);
  assert.ok(log.includes("release"));
  assert.equal(log.at(-1), "do:confirm");
  assert.equal(confirmFind(env, findReducer(state(), { kind: "set-query", query: "zzz", total: count(0) })), false);
});

test("cancelFind restores the opening view and moves the camera back", () => {
  const { env, state, controller, cameras } = harness();
  openFind(env);
  const origin = state().origin;
  assert.notEqual(origin, null);
  applyFindQuery(env, "tang");
  cancelFind(env, state());
  assert.deepEqual([state().open, state().kept, state().origin], [false, false, null]);
  assert.equal(cameras.length, 1);
  assert.deepEqual(cameras[0], origin?.camera);
  assert.equal(controller.snapshot().selection.size, 0);
  cancelFind(env, state());
  assert.equal(cameras.length, 1);
});
