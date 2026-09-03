import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { AreaNode, MapEntityFacts, SceneElement } from "../../kernel/kernel-types.ts";
import { areaKey, runtimeId } from "../../units/ids.ts";
import type { AreaKey } from "../../units/ids.ts";
import { count } from "../../units/units.ts";
import type { Count } from "../../units/units.ts";
import { hiddenByFold, outlineItems, outlineTree } from "./outline-model.ts";
import type { OutlineInput } from "./outline-model.ts";

/** One world Area with the fields the Outline reads. */
function area(key: string, parent: string, depth: Count, blockCount: Count = count(0), state = "ready"): AreaNode {
  return { key, parent, depth, children: [], shard: { state, blockCount } } as unknown as AreaNode;
}

/** One composed Block element owned by an Area. */
function block(id: string, owner: string, extra: Record<string, unknown> = {}): SceneElement {
  return { id, isDeleted: false, customData: { tangent: { kind: "goal", ref: `${id}.md` }, tangentWorld: { owner, sourceId: id } }, ...extra } as unknown as SceneElement;
}

/** The region element of one Area inside its parent's shard. */
function region(id: string, owner: string, child: string): SceneElement {
  return { id, isDeleted: false, customData: { tangent: { kind: "area", ref: child, role: "area-region", area: child }, tangentWorld: { owner, sourceId: id } } } as unknown as SceneElement;
}

/** The facts a Block resolves to, labelled by its id unless told otherwise. */
function facts(label: string, actionLabel: string | null = "Open goal"): MapEntityFacts {
  return {
    accessibleName: `Goal: ${label}`,
    display: { kindLabel: "Goal", label, stateText: ["Open"], actionLabel, targetClue: "", externalTreatment: null },
  } as unknown as MapEntityFacts;
}

const LABELS: Record<string, string> = { "b-zeta": "Zeta", "b-alpha": "Alpha" };

const AREAS = [area("otto", "@root", count(0), count(2)), area("otto/tangent", "otto", count(1)), area("otto/tangent/map", "otto/tangent", count(2)), area("neara", "@root", count(0))];
const ELEMENTS = [block("b-zeta", "otto"), block("b-alpha", "otto"), block("b-gone", "otto", { isDeleted: true }), region("r-tangent", "otto", "otto/tangent"), block("b-unresolved", "neara")];

/** The input for the fixture world, with overrides. */
function input(overrides: Partial<OutlineInput> = {}): OutlineInput {
  return {
    areas: AREAS,
    elements: ELEMENTS,
    scopedAreas: new Set(AREAS.map((node) => node.key)),
    folded: new Set<AreaKey>(),
    selection: new Set(),
    /** The leaf of an Area key. */
    areaName: (key) => key.split("/").at(-1) ?? key,
    /** The Area's accessible name, which the label surface owns for real. */
    accessibleAreaName: (node) => `${node.key}, accessible`,
    /** Every fixture element resolves except the one named unresolved. */
    resolveBlock: (element) => (element.id === "b-unresolved" ? null : facts(LABELS[element.id] ?? element.id)),
    ...overrides,
  };
}

test("hiddenByFold hides descendants of a folded root and never the root itself", () => {
  const folded = new Set([areaKey("otto")]);
  assert.equal(hiddenByFold(areaKey("otto/tangent"), folded), true);
  assert.equal(hiddenByFold(areaKey("otto"), folded), false);
  assert.equal(hiddenByFold(areaKey("ottoman"), folded), false);
});

test("roots sort by key, children nest under their parent, and levels count from one", () => {
  const tree = outlineTree(input());
  assert.deepEqual(tree.roots.map((root) => root.key), ["neara", "otto"]);
  const otto = tree.roots[1];
  assert.equal(otto?.level, 1);
  assert.equal(otto?.children[0]?.key, "otto/tangent");
  assert.equal(otto?.children[0]?.level, 2);
  assert.equal(otto?.children[0]?.children[0]?.key, "otto/tangent/map");
  assert.equal(otto?.children[0]?.children[0]?.level, 3);
  assert.equal(otto?.text, "otto · depth 1 · ready · 2 blocks");
  assert.equal(otto?.accessibleName, "otto, accessible");
  assert.equal(otto?.expanded, true);
  assert.equal(otto?.children[0]?.children[0]?.expanded, null);
});

test("an Area outside the Only scope is absent", () => {
  const tree = outlineTree(input({ scopedAreas: new Set([areaKey("otto"), areaKey("otto/tangent")]) }));
  assert.deepEqual(tree.roots.map((root) => root.key), ["otto"]);
  assert.deepEqual(tree.roots[0]?.children.map((child) => child.key), ["otto/tangent"]);
  assert.deepEqual(tree.roots[0]?.children[0]?.children, []);
});

test("a folded root keeps its row, says folded, and folds its children away", () => {
  const tree = outlineTree(input({ folded: new Set([areaKey("otto")]) }));
  const otto = tree.roots.find((root) => root.key === "otto");
  assert.equal(otto?.expanded, false);
  assert.deepEqual(otto?.children, []);
  assert.equal(otto?.text, "otto · depth 1 · folded · 2 blocks");
});

test("an Area whose parent left the scope still obeys a fold above it", () => {
  const scoped = new Set([areaKey("otto/tangent"), areaKey("otto/tangent/map")]);
  assert.deepEqual(outlineTree(input({ scopedAreas: scoped })).roots.map((root) => root.key), ["otto/tangent"]);
  assert.deepEqual(outlineTree(input({ scopedAreas: scoped, folded: new Set([areaKey("otto")]) })).roots, []);
});

test("Blocks list under their owner sorted by label, one level below, with their words", () => {
  const otto = outlineTree(input()).roots[1];
  assert.deepEqual(otto?.blocks.map((entry) => entry.id), ["b-alpha", "b-zeta"]);
  const alpha = otto?.blocks[0];
  assert.equal(alpha?.level, 2);
  assert.equal(alpha?.kindLabel, "Goal");
  assert.equal(alpha?.text, " · Alpha · Open · Open goal");
  assert.equal(alpha?.accessibleName, "Goal: Alpha. Open goal with Enter.");
  assert.equal(alpha?.itemId, "block:b-alpha");
});

test("a deleted element, a region and an element that resolves to nothing are not Blocks", () => {
  const tree = outlineTree(input());
  const ids = tree.roots.flatMap((root) => root.blocks.map((entry) => entry.id));
  assert.deepEqual(ids, ["b-alpha", "b-zeta"]);
  assert.equal(tree.empty, false);
  assert.equal(outlineTree(input({ elements: [region("r-tangent", "otto", "otto/tangent")] })).empty, true);
});

test("a Block with no primary action says so, and selection marks the one selected Block", () => {
  /** One Block with no primary action. */
  const alphaOnly = () => facts("Alpha", null);
  const solo = input({ elements: [block("b-alpha", "otto")], resolveBlock: alphaOnly, selection: new Set([runtimeId("b-alpha")]) });
  const alpha = outlineTree(solo).roots[1]?.blocks[0];
  assert.equal(alpha?.accessibleName, "Goal: Alpha. No primary action.");
  assert.equal(alpha?.text, " · Alpha · Open");
  assert.equal(alpha?.selected, true);
  const two = outlineTree(input({ selection: new Set([runtimeId("b-alpha"), runtimeId("b-zeta")]) })).roots[1];
  assert.deepEqual(two?.blocks.map((entry) => entry.selected), [false, false]);
});

test("an Area is selected when its region element is selected", () => {
  const tree = outlineTree(input({ selection: new Set([runtimeId("r-tangent")]) }));
  assert.equal(tree.roots[1]?.selected, false);
  assert.equal(tree.roots[1]?.children[0]?.selected, true);
});

test("outlineItems resolves every row id to its Area or Block in reading order", () => {
  const items = outlineItems(outlineTree(input()));
  assert.deepEqual([...items.keys()], ["area:neara", "area:otto", "block:b-alpha", "block:b-zeta", "area:otto/tangent", "area:otto/tangent/map"]);
  const otto = items.get("area:otto");
  assert.equal(otto?.kind === "area" && otto.area.key, "otto");
  const alpha = items.get("block:b-alpha");
  assert.equal(alpha?.kind === "block" && alpha.block.id, "b-alpha");
});
