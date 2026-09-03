// Turning the composed elements Excalidraw hands back into shard scenes.
//
// The composed scene is one canvas built from every Area's file. A publish has to undo that: keep
// the structural elements each shard owns, replace its authored ones with what the person drew,
// and recompute the counts and hulls the layout kernel reads. This file is that half of the
// publish. It also holds the two corrections the kernel makes to what Excalidraw drew: a Block
// dragged out of its Area is pulled back by the owned-element solver, and an Area whose content
// hull changed is re-anchored so a lower-priority branch does not jump back to its old rectangle.

import { elementRect } from "../input/hit-test.ts";
import {
  areaMapStructuralHullChanged, authoredFingerprint, createEmptyScene, isAreaBoundary, isAreaRegion, reprioritizeAreaPlacement, shardHulls,
  solveOwnedElementGesture, splitComposed, tangentOf,
} from "../kernel/kernel-boundary.ts";
import type { AreaMapController, ComposedOrigin, Composition, GestureBaseline, SceneElement, SourceElement, World } from "../kernel/kernel-types.ts";
import { delta, point, rect } from "../units/frames.ts";
import type { Delta, Point, Rect } from "../units/frames.ts";
import { areaKey } from "../units/ids.ts";
import type { AreaKey, RuntimeId, ShardOwner, SourceId } from "../units/ids.ts";
import { add, deltaBetween, subtract, union } from "../units/scalar-math.ts";
import { count, scenePx, sourcePx } from "../units/units.ts";
import type { Count } from "../units/units.ts";

/** The white a shard's own canvas is stored with, so a save never records the Map's dark theme. */
const SHARD_BACKGROUND = "#ffffff";

/** No displacement at all: the motion of a shard whose composed origin did not move. */
const NO_MOTION: Delta<"scene"> = delta("scene", scenePx(0), scenePx(0));

/** The smallest rectangle holding every one of the boxes, or null when there are none. */
export function hullOf<F extends "scene" | "source">(boxes: readonly Rect<F>[]): Rect<F> | null {
  let hull: Rect<F> | null = null;
  for (const box of boxes) hull = hull === null ? box : union(hull, box);
  return hull;
}

/** How far one shard's composed origin moved between two compositions. */
export function ownerMotion(before: Composition, after: Composition, owner: ShardOwner): Delta<"scene"> {
  const from = before.offsets.get(areaKey(owner));
  const to = after.offsets.get(areaKey(owner)) ?? from;
  if (from === undefined || to === undefined) return NO_MOTION;
  return deltaBetween(from, to);
}

/** Puts back the composed value of every element the projection masked, so a publish never deletes one. */
export function restoreMaskedElements(elements: readonly SceneElement[], composition: Composition, hiddenIds: ReadonlySet<RuntimeId>): SceneElement[] {
  const incoming = new Map(elements.map((element) => [element.id, element]));
  for (const element of composition.scene.elements) {
    const region = element.customData?.tangent?.role === "area-region";
    const removed = !incoming.has(element.id) || incoming.get(element.id)?.isDeleted === true;
    if (hiddenIds.has(element.id) || (region && removed)) incoming.set(element.id, structuredClone(element));
  }
  const order: SceneElement[] = [];
  for (const element of composition.scene.elements) {
    const value = incoming.get(element.id);
    if (value !== undefined) order.push(value);
  }
  const known = new Set(order.map((element) => element.id));
  return [...order, ...elements.filter((element) => !known.has(element.id))];
}

/** What a Block correction needs: the baseline it moved from and the world it moves in. */
export type BlockSolveInput = {
  readonly controller: AreaMapController;
  readonly solver: GestureBaseline;
  readonly baselineWorld: World;
  readonly baselineElements: ReadonlyMap<RuntimeId, SceneElement>;
  readonly baselineOffsets: ReadonlyMap<AreaKey, Point<"scene">>;
  readonly motion: (owner: ShardOwner) => Delta<"scene">;
  readonly origins: ReadonlyMap<RuntimeId, ComposedOrigin>;
};

/** Groups the selected Blocks by the shard that owns them. */
function blocksByOwner(input: BlockSolveInput, selected: ReadonlySet<RuntimeId>, byId: ReadonlyMap<RuntimeId, SceneElement>): Map<ShardOwner, SceneElement[]> {
  const groups = new Map<ShardOwner, SceneElement[]>();
  for (const id of selected) {
    const element = byId.get(id);
    const origin = input.origins.get(id) ?? element?.customData?.tangentWorld;
    if (element === undefined || origin === undefined || tangentOf(element) === null) continue;
    const values = groups.get(origin.owner) ?? [];
    values.push(element);
    groups.set(origin.owner, values);
  }
  return groups;
}

/** The hull of one shard's Blocks with the moving ones taken out, which is what the solver must not cross. */
function remainingHull(input: BlockSolveInput, owner: ShardOwner, moving: ReadonlySet<SourceId>): Rect<"source"> | null {
  const scene = input.baselineWorld.areas.find((entry) => entry.key === areaKey(owner))?.shard.scene;
  if (scene === undefined || scene === null) return null;
  return shardHulls({ ...scene, elements: scene.elements.filter((element) => !moving.has(element.id)) }).blocks;
}

/** One composed element's box read in its owner's source frame, which the composition only offsets. */
function sourceBox(element: SceneElement, offset: Point<"scene">): Rect<"source"> {
  return rect("source", sourcePx(element.x - offset.x), sourcePx(element.y - offset.y), sourcePx(element.width), sourcePx(element.height));
}

/** Moves one Block and its bound label by the correction the solver applied. */
function applyBlockCorrection(element: SceneElement, corrected: Point<"scene">, byId: ReadonlyMap<RuntimeId, SceneElement>): void {
  const correction = deltaBetween(point("scene", element.x, element.y), corrected);
  element.x = corrected.x;
  element.y = corrected.y;
  for (const binding of element.boundElements ?? []) {
    const bound = byId.get(binding.id);
    if (bound === undefined) continue;
    bound.x = add(bound.x, correction.dx);
    bound.y = add(bound.y, correction.dy);
  }
}

/** Solves one shard's dragged Blocks and writes the correction back into them. */
function solveOneOwner(input: BlockSolveInput, owner: ShardOwner, blocks: readonly SceneElement[], byId: ReadonlyMap<RuntimeId, SceneElement>): void {
  const offset = input.baselineOffsets.get(areaKey(owner));
  const first = blocks[0];
  if (offset === undefined || first === undefined) return;
  const originals = blocks.map((block) => input.baselineElements.get(block.id)).filter((element) => element !== undefined);
  const original = input.baselineElements.get(first.id);
  const group = hullOf(originals.map((element) => sourceBox(element, offset)));
  if (original === undefined || group === null) return;
  const motion = input.motion(owner);
  const moving = new Set(blocks.map((block) => input.origins.get(block.id)?.sourceId).filter((id) => id !== undefined));
  const solved = solveOwnedElementGesture(input.solver, {
    owner, kind: "block", rect: group,
    remainingBlockHull: remainingHull(input, owner, moving),
    desiredWorldDelta: delta("scene", subtract(subtract(first.x, original.x), motion.dx), subtract(subtract(first.y, original.y), motion.dy)),
  });
  input.controller.recordEvent("area_map_gesture_solved", { gestureKind: "block-move", previewCount: count(blocks.length) });
  if (!solved.valid) input.controller.recordEvent("area_map_invariant_failed", { gestureKind: "block-move", invariantName: "owned-block-containment" });
  for (const block of blocks) {
    const from = input.baselineElements.get(block.id);
    if (from === undefined) continue;
    applyBlockCorrection(block, point("scene", add(add(from.x, motion.dx), solved.appliedDelta.dx), add(add(from.y, motion.dy), solved.appliedDelta.dy)), byId);
  }
}

/** Pulls every dragged Block back inside its own Area through the kernel's owned-element solver. */
export function solveSelectedBlocks(input: BlockSolveInput, selected: ReadonlySet<RuntimeId>, authored: readonly SceneElement[]): void {
  const byId = new Map(authored.map((element) => [element.id, element]));
  for (const [owner, blocks] of blocksByOwner(input, selected, byId)) solveOneOwner(input, owner, blocks, byId);
}

/** Replaces one shard's authored elements, keeping the structure the Area tree owns. True when it changed. */
function writeShard(world: World, owner: ShardOwner, authored: readonly SourceElement[], materialize: (owner: ShardOwner) => void): boolean {
  const node = world.areas.find((entry) => entry.key === areaKey(owner));
  if (node === undefined) return false;
  if (!node.shard.scene) {
    if (node.shard.state !== "missing") {
      materialize(owner);
      return false;
    }
    node.shard.scene = createEmptyScene();
  }
  const scene = node.shard.scene;
  if (!scene) return false;
  const regionIds = new Set(scene.elements.filter(isAreaRegion).map((element) => element.id));
  const structural = scene.elements.filter((element) => isAreaRegion(element) || isAreaBoundary(element) || (element.containerId !== undefined && element.containerId !== null && regionIds.has(element.containerId)));
  const elements = [...structural, ...authored];
  if (authoredFingerprint(elements) === authoredFingerprint(scene.elements)) return false;
  node.shard.scene = { ...scene, elements, appState: { ...(scene.appState ?? {}), viewBackgroundColor: SHARD_BACKGROUND } };
  const live = elements.filter((element) => !element.isDeleted && !isAreaRegion(element) && !isAreaBoundary(element));
  const hulls = shardHulls(node.shard.scene);
  node.shard.elementCount = count(live.length);
  node.shard.blockCount = count(live.filter((element) => tangentOf(element) !== null).length);
  node.shard.ownBlockHull = hulls.blocks;
  node.shard.ownInkHull = hulls.ink;
  return true;
}

/** Splits the authored composed elements back into shards and returns the owners that changed. */
export function writeShards(
  world: World,
  authored: readonly SceneElement[],
  origins: ReadonlyMap<RuntimeId, ComposedOrigin>,
  offsets: ReadonlyMap<AreaKey, Point<"scene">>,
  allowed: ReadonlySet<ShardOwner> | null,
  materialize: (owner: ShardOwner) => void,
): Set<ShardOwner> {
  const changed = new Set<ShardOwner>();
  for (const [owner, elements] of splitComposed(authored, new Map(origins), new Map(offsets))) {
    if (allowed !== null && !allowed.has(owner)) continue;
    if (writeShard(world, owner, elements, materialize)) changed.add(owner);
  }
  return changed;
}

/** The highest branch priority any Area carries now, which the next raise sits above. */
function highestPriority(world: World): Count {
  let highest = count(0);
  for (const node of world.areas) {
    const value = node.region.layout?.priority;
    if (value !== undefined && Number.isSafeInteger(value) && value >= 0 && value > highest) highest = value;
  }
  return highest;
}

/** Raises the branch priority of every Area whose own content hull changed, absorbing the anchor the solver resolved. */
export function reprioritizeChangedAreas(
  world: World,
  baselineWorld: World,
  baselineComposition: Composition,
  changedOwners: ReadonlySet<ShardOwner>,
  directlyChanged: ReadonlySet<AreaKey>,
): Set<AreaKey> {
  const raised = new Set<AreaKey>();
  const next = count(highestPriority(baselineWorld) + 1);
  for (const owner of changedOwners) {
    const area = areaKey(owner);
    const node = world.areas.find((entry) => entry.key === area);
    const before = baselineWorld.areas.find((entry) => entry.key === area);
    if (node === undefined || before === undefined) continue;
    const hull = before.shard.scene ? shardHulls(before.shard.scene).blocks : before.shard.ownBlockHull;
    if (!areaMapStructuralHullChanged(hull, node.shard.ownBlockHull)) continue;
    const anchor = directlyChanged.has(area) ? node.region.storedRect : baselineComposition.geometry.get(area)?.resolvedStored ?? null;
    node.region = reprioritizeAreaPlacement(node.region, anchor, next);
    raised.add(area);
  }
  return raised;
}

/** The rectangle of one composed element, for a caller that measures a Block against its Area. */
export function composedRect(element: SceneElement): Rect<"scene"> {
  return elementRect(element);
}
