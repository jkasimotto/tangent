import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { AreaNode, Region, World } from "../kernel/kernel-types.ts";
import { areaKey, shardOwner, sourceId } from "../units/ids.ts";
import { count } from "../units/units.ts";
import { highestBranchPriority, nextBranchPriority } from "./branch-priority.ts";
import { rect } from "../units/frames.ts";
import { sourcePx } from "../units/units.ts";
import { regionKey } from "../kernel/kernel-boundary.ts";

/** One Area node carrying the given branch priority, or none. */
function node(key: string, priority: number | null): AreaNode {
  const region: Region = {
    key: regionKey(shardOwner("otto"), areaKey(key)),
    owner: shardOwner("otto"),
    child: areaKey(key),
    sourceId: sourceId(`region-${key}`),
    labelSourceId: sourceId(`label-${key}`),
    source: "stored",
    storedRect: rect("source", sourcePx(0), sourcePx(0), sourcePx(10), sourcePx(10)),
    ...(priority === null ? {} : { layout: { schema: "area-placement.v1" as const, priority: count(priority), overlapWith: [] } }),
  };
  return {
    key: areaKey(key), parent: shardOwner("otto"), children: [], depth: count(1), region,
    shard: { owner: shardOwner(key), hash: null, revision: null, state: "ready", elementCount: count(0), blockCount: count(0), ownBlockHull: null, ownInkHull: null },
  };
}

/** A world holding the given Area nodes. */
function world(nodes: AreaNode[]): World {
  return { schema: "area-map-world.v1", worldId: "w" as World["worldId"], treeRevision: "t" as World["treeRevision"], worldRevision: "r" as World["worldRevision"], locatedArea: areaKey("otto"), rootShard: node("otto", null).shard, areas: nodes };
}

test("an unpriorityed world starts at zero and the next priority is one", () => {
  assert.equal(highestBranchPriority(world([node("otto/a", null)])), 0);
  assert.equal(nextBranchPriority(world([node("otto/a", null)])), 1);
});

test("the next priority sits above every Area in the world", () => {
  const value = world([node("otto/a", 3), node("otto/b", 7), node("otto/c", null)]);
  assert.equal(highestBranchPriority(value), 7);
  assert.equal(nextBranchPriority(value), 8);
});

test("a negative or non-integer priority is not a priority", () => {
  assert.equal(highestBranchPriority(world([node("otto/a", -2), node("otto/b", 1.5)])), 0);
});
