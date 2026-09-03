// The Area label model: names, the exact accessible name, runtime facts, notes and positions.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { AreaNode, VaultDocument } from "../kernel/kernel-types.ts";
import { LAYOUT } from "../layout/layout-tokens.ts";
import { rect } from "../units/frames.ts";
import type { Camera } from "../units/frames.ts";
import { areaKey, shardOwner } from "../units/ids.ts";
import { count, scenePx, zoom } from "../units/units.ts";
import type { Count } from "../units/units.ts";
import {
  accessibleAreaName, areaLabelModels, areaName, areaParentName, areaPathName, areaRecords, areaRuntimeAnnotations,
  hiddenByFold, labelNotes, labelPosition, runtimeCount, runtimeWords,
} from "./area-label-model.ts";
import type { AreaLabelsInput } from "./area-label-model.ts";

/** One Area node with the given shard state and block count. */
function node(key: string, parent: string, depth: Count, state = "ready", blockCount: Count = count(0)): AreaNode {
  return { key: areaKey(key), parent: shardOwner(parent), children: [], depth, shard: { state, blockCount } } as unknown as AreaNode;
}

/** One Area document. */
function areaDocument(area: string, title: string, runtime?: VaultDocument["runtime"]): VaultDocument {
  return { file: `${area}/note.md`, kind: "area", area: areaKey(area), title, ...(runtime === undefined ? {} : { runtime }) };
}

const RECORDS = areaRecords([
  areaDocument("neara", "Neara"),
  areaDocument("neara/delivery", "Delivery"),
  { file: "neara/goal.md", kind: "goal", area: areaKey("neara"), title: "A goal" },
]);

test("areaRecords keeps only Area documents and names fall back to the leaf", () => {
  assert.deepEqual([...RECORDS.keys()], ["neara", "neara/delivery"]);
  assert.equal(areaName(RECORDS, areaKey("neara/delivery")), "Delivery");
  assert.equal(areaName(RECORDS, areaKey("neara/delivery/standards")), "standards");
  assert.equal(areaName(RECORDS, areaKey("")), "Area");
  assert.equal(areaPathName(RECORDS, areaKey("neara/delivery/standards")), "Neara / Delivery / standards");
  assert.equal(areaParentName(RECORDS, shardOwner("@root")), "map root");
  assert.equal(areaParentName(RECORDS, shardOwner("neara/delivery")), "Neara / Delivery");
});

test("the accessible name is the exact format the browser suites match", () => {
  assert.equal(accessibleAreaName(RECORDS, node("neara", "@root", count(0)), new Set()), "Neara, child of map root, depth 1, unfolded, ready, 0 blocks");
  assert.equal(
    accessibleAreaName(RECORDS, node("neara/delivery/standards", "neara/delivery", count(2), "ready", count(1)), new Set()),
    "Standards, child of Neara / Delivery, depth 3, unfolded, ready, 1 block".replace("Standards", "standards"),
  );
  assert.equal(accessibleAreaName(RECORDS, node("neara/delivery", "neara", count(1), "deferred", count(2)), new Set([areaKey("neara/delivery")])), "Delivery, child of Neara, depth 2, folded, deferred, 2 blocks");
});

test("runtime words follow the block count in the accessible name", () => {
  const records = areaRecords([areaDocument("neara", "Neara", { working: 3, forYou: 1, problems: 1, stale: true })]);
  assert.equal(accessibleAreaName(records, node("neara", "@root", count(0), "ready", count(4)), new Set()), "Neara, child of map root, depth 1, unfolded, ready, 4 blocks, 3 working, 1 for you, 1 problem, last known facts");
  const ready = areaRecords([areaDocument("neara", "Neara", { ready: true })]);
  assert.equal(accessibleAreaName(ready, node("neara", "@root", count(0)), new Set()), "Neara, child of map root, depth 1, unfolded, ready, 0 blocks, Ready");
});

test("runtimeCount reads a count, a list, a record carrying one, and never invents activity", () => {
  assert.equal(runtimeCount(3 as never), 3);
  assert.equal(runtimeCount(2.9 as never), 2);
  assert.equal(runtimeCount([1, 2]), 2);
  assert.equal(runtimeCount({ count: [1] }), 1);
  assert.equal(runtimeCount({ count: null }), 0);
  assert.equal(runtimeCount(-1 as never), 0);
  assert.equal(runtimeCount(null), 0);
  assert.equal(runtimeCount(undefined), 0);
});

test("areaRuntimeAnnotations lists the facts in order and Ready gives way to For you", () => {
  const facts = areaRuntimeAnnotations({ working: 4, forYou: 0, problems: 2, stale: false, ready: true });
  assert.deepEqual(facts.facts, [{ verb: "work", label: "4 working" }, { verb: "problems", label: "2 problems" }]);
  assert.equal(facts.ready, true);
  assert.equal(facts.stale, false);
  const waiting = areaRuntimeAnnotations({ forYou: 1, ready: true, stale: true });
  assert.equal(waiting.ready, false, "an Area waiting for Julian is not Ready");
  assert.deepEqual(runtimeWords(waiting), ["1 for you", "last known facts"]);
  assert.deepEqual(areaRuntimeAnnotations(null), { facts: [], ready: false, stale: false });
});

test("hiddenByFold hides descendants of a folded Area and never the Area itself", () => {
  const folded = new Set([areaKey("neara/delivery")]);
  assert.equal(hiddenByFold(areaKey("neara/delivery/standards"), folded), true);
  assert.equal(hiddenByFold(areaKey("neara/delivery"), folded), false);
  assert.equal(hiddenByFold(areaKey("neara/deliveryx"), folded), false);
});

test("labelNotes says folded, the load state, then the block summary unless the Area is shown in detail", () => {
  const folded = new Set([areaKey("neara")]);
  assert.deepEqual(labelNotes(node("neara", "@root", count(0), "ready", count(3)), folded, new Set()), ["folded · Space", "3 blocks"]);
  assert.deepEqual(labelNotes(node("neara", "@root", count(0), "unreadable"), new Set(), new Set([areaKey("neara")])), ["map file unreadable"]);
  assert.deepEqual(labelNotes(node("neara", "@root", count(0), "load-error"), new Set(), new Set([areaKey("neara")])), ["load failed · click to retry"]);
  assert.deepEqual(labelNotes(node("neara", "@root", count(0), "deferred"), new Set(), new Set([areaKey("neara")])), ["deferred"]);
  assert.deepEqual(labelNotes(node("neara", "@root", count(0), "loading"), new Set(), new Set([areaKey("neara")])), ["loading"]);
});

const CAMERA: Camera = { scrollX: scenePx(100), scrollY: scenePx(50), zoom: zoom(2) };

test("labelPosition puts the pill inside the region's top-left corner through the camera", () => {
  const at = labelPosition(rect("scene", scenePx(10), scenePx(20), scenePx(400), scenePx(300)), CAMERA);
  assert.equal(at.x, (10 + 100) * 2 + LAYOUT.labelInsetX);
  assert.equal(at.y, (20 + 50) * 2 + LAYOUT.labelInsetY);
});

/** The label input over two Areas, one with runtime facts. */
function input(overrides: Partial<AreaLabelsInput> = {}): AreaLabelsInput {
  return {
    areas: [node("neara", "@root", count(0), "ready", count(2)), node("neara/delivery", "neara", count(1), "ready", count(1)), node("neara/hackathon", "neara", count(1))],
    scopedAreas: new Set([areaKey("neara"), areaKey("neara/delivery")]),
    folded: new Set(),
    detailAreas: new Set([areaKey("neara")]),
    regionRects: new Map([
      [areaKey("neara"), rect("scene", scenePx(0), scenePx(0), scenePx(900), scenePx(600))],
      [areaKey("neara/delivery"), rect("scene", scenePx(10), scenePx(20), scenePx(400), scenePx(300))],
      [areaKey("neara/hackathon"), rect("scene", scenePx(500), scenePx(20), scenePx(300), scenePx(300))],
    ]),
    camera: CAMERA,
    records: areaRecords([areaDocument("neara", "Neara"), areaDocument("neara/delivery", "Delivery", { working: 3, stale: true })]),
    currentFindArea: areaKey("neara/delivery"),
    ...overrides,
  };
}

test("areaLabelModels lists the scoped, unfolded Areas with a region, in world order", () => {
  const models = areaLabelModels(input());
  assert.deepEqual(models.map((model) => model.areaKey), ["neara", "neara/delivery"]);
  const [neara, delivery] = models;
  assert.equal(neara?.name, "Neara");
  assert.deepEqual(neara?.notes, []);
  assert.equal(neara?.current, false);
  assert.equal(neara?.runtime, null);
  assert.equal(delivery?.accessibleName, "Delivery, child of Neara, depth 2, unfolded, ready, 1 block, 3 working, last known facts");
  assert.deepEqual(delivery?.notes, ["1 blocks"]);
  assert.equal(delivery?.current, true);
  assert.equal(delivery?.runtime?.groupName, "Delivery runtime");
  assert.equal(delivery?.runtime?.ref, "neara/delivery/note.md");
  assert.deepEqual(delivery?.runtime?.facts, [{ verb: "work", label: "3 working" }]);
  assert.equal(delivery?.runtime?.stale, true);
  assert.equal(delivery?.runtime?.at.x, (10 + 100) * 2 + LAYOUT.labelInsetX);
  assert.equal(delivery?.runtime?.at.y, (20 + 50) * 2 + LAYOUT.runtimeFactsOffset);
});

test("a folded ancestor removes its descendants' labels and a missing region removes the label", () => {
  const folded = areaLabelModels(input({ folded: new Set([areaKey("neara")]) }));
  assert.deepEqual(folded.map((model) => model.areaKey), ["neara"]);
  assert.deepEqual(folded[0]?.notes, ["folded · Space"]);
  const noRegion = areaLabelModels(input({ regionRects: new Map() }));
  assert.deepEqual(noRegion, []);
});

test("the note file falls back to the conventional path when the Area has no document", () => {
  const models = areaLabelModels(input({ records: areaRecords([areaDocument("neara/delivery", "Delivery", { ready: true })]) }));
  const delivery = models.find((model) => model.areaKey === "neara/delivery");
  assert.equal(delivery?.runtime?.ref, "neara/delivery/note.md");
  const nameless = areaLabelModels(input({ records: areaRecords([{ file: "x.md", kind: "area", area: areaKey("neara/delivery"), runtime: { ready: true } }]) }));
  assert.equal(nameless.find((model) => model.areaKey === "neara/delivery")?.runtime?.ref, "x.md");
  const conventional = areaLabelModels(input({ records: areaRecords([]), areas: [node("neara/delivery", "neara", count(1))] }));
  assert.equal(conventional[0]?.runtime, null);
});
