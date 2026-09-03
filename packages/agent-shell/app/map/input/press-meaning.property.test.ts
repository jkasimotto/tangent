import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { PointerCommand, SceneElement } from "../kernel/kernel-types.ts";
import { point, rect } from "../units/frames.ts";
import type { Point, Rect } from "../units/frames.ts";
import { RESIZE_HANDLES, areaKey, runtimeId } from "../units/ids.ts";
import type { AreaKey, RuntimeId } from "../units/ids.ts";
import { scenePx, zoom } from "../units/units.ts";
import { hitTest, isVisibleArea, regionAreaOf, selectedVisibleArea } from "./hit-test.ts";
import type { VisibleScene } from "./hit-test.ts";
import { meaningOfPress } from "./press-meaning.ts";
import type { PressContext, PressMeaning, PressTool } from "./press-meaning.ts";

const RUNS = 1500;
const KINDS = new Set(["pan", "place-resource", "text", "rubber-band", "grab-element", "add-to-selection", "move-area", "resize-area", "ignore"]);
const TOOLS: readonly PressTool[] = ["selection", "selection", "selection", "selection", "hand", "text", "rectangle", "arrow", "custom"];
const MAX_DEPTH = 3;

/** A small seeded generator so a failing run can be replayed by seed (mulberry32). */
function random(seed: number): () => number {
  let state = seed >>> 0;
  /** Returns the next number in [0, 1). */
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** True with the given probability. */
const chance = (next: () => number, probability: number): boolean => next() < probability;

/** A whole number in [low, high]. */
const between = (next: () => number, low: number, high: number): number => low + Math.floor(next() * (high - low + 1));

/** One item of a list. */
const pick = <T>(next: () => number, list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;

/** A scene rect from raw numbers. */
const box = (x: number, y: number, width: number, height: number): Rect<"scene"> => rect("scene", scenePx(x), scenePx(y), scenePx(width), scenePx(height));

/** One composed element with the fields Excalidraw requires. */
function element(id: string, bounds: Rect<"scene">, extra: Partial<SceneElement> = {}): SceneElement {
  return {
    id: runtimeId(id), type: "rectangle", x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    angle: 0 as SceneElement["angle"], strokeColor: "#000000", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid",
    roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false,
    boundElements: null, updated: 1, link: null, locked: false, ...extra,
  };
}

/** A random Area tree with nested region rects: children sit inside their parent, siblings may overlap. */
function generatedTree(next: () => number): Map<AreaKey, Rect<"scene">> {
  const rects = new Map<AreaKey, Rect<"scene">>();
  const root = box(0, 0, between(next, 800, 1600), between(next, 600, 1200));
  rects.set(areaKey("root"), root);
  /** Adds up to three children inside one parent, recursing to the depth limit. */
  const grow = (parent: AreaKey, bounds: Rect<"scene">, depth: number): void => {
    if (depth >= MAX_DEPTH) return;
    for (let child = 0; child < between(next, 0, 3); child += 1) {
      const width = between(next, 120, Math.max(120, bounds.width / 2));
      const height = between(next, 100, Math.max(100, bounds.height / 2));
      const childRect = box(bounds.x + between(next, 20, Math.max(20, bounds.width - width - 20)), bounds.y + between(next, 20, Math.max(20, bounds.height - height - 20)), width, height);
      const key = areaKey(`${parent}/a${depth}-${child}`);
      rects.set(key, childRect);
      grow(key, childRect, depth + 1);
    }
  };
  grow(areaKey("root"), root, 0);
  return rects;
}

/** The generated world: the elements, the Area of every Block, and the region rects. */
type GeneratedWorld = { elements: SceneElement[]; blockOwners: Map<RuntimeId, AreaKey>; rects: Map<AreaKey, Rect<"scene">> };

/** Regions first, then Blocks with the odd bound label and ephemeral dot, the way the kernel paints them. */
function generatedWorld(next: () => number): GeneratedWorld {
  const rects = generatedTree(next);
  const elements: SceneElement[] = [];
  const blockOwners = new Map<RuntimeId, AreaKey>();
  for (const [area, bounds] of rects) elements.push(element(`region-${area}`, bounds, { customData: { tangent: { role: "area-region", area } } }));
  for (const [area, bounds] of rects) {
    for (let index = 0; index < between(next, 0, 3); index += 1) {
      const id = `block-${area}-${index}`;
      const blockRect = box(bounds.x + between(next, 0, bounds.width), bounds.y + between(next, 0, bounds.height), between(next, 40, 280), between(next, 30, 132));
      elements.push(element(id, blockRect, { customData: { tangent: { kind: "goal", ref: id }, tangentWorld: { owner: area as never, sourceId: id as never } } }));
      blockOwners.set(runtimeId(id), area);
      if (chance(next, 0.5)) elements.push(element(`${id}-label`, box(blockRect.x + 4, blockRect.y + 4, blockRect.width - 8, 20), { type: "text", containerId: runtimeId(id), text: id }));
      if (chance(next, 0.2)) elements.push(element(`${id}-dot`, box(blockRect.x - 6, blockRect.y - 6, 12, 12), { customData: { tangentWorldEphemeral: { kind: "endpoint-dot", sourceId: runtimeId(id) }, tangent: { role: "endpoint-dot" } } }));
    }
  }
  return { elements, blockOwners, rects };
}

/** The generated context with the facts the properties are checked against. */
type Generated = { scene: VisibleScene; context: PressContext; hiddenAreas: Set<AreaKey>; blockOwners: Map<RuntimeId, AreaKey> };

/** A visible scene from a world: random folds, an optional Only restriction, and the hidden set the controller would derive from them. */
function generatedScene(next: () => number, world: GeneratedWorld): { scene: VisibleScene; hiddenAreas: Set<AreaKey> } {
  const areas = [...world.rects.keys()];
  const folded = new Set(areas.filter(() => chance(next, 0.2)));
  const restriction = chance(next, 0.3) ? pick(next, areas) : null;
  /** True when Only admits the Area: the target, an ancestor, or a descendant. */
  const inScope = (area: AreaKey): boolean => restriction === null || area === restriction || restriction.startsWith(`${area}/`) || area.startsWith(`${restriction}/`);
  const scopedAreas = new Set(areas.filter(inScope));
  const partial: VisibleScene = { elements: world.elements, regionRects: world.rects, hiddenIds: new Set(), scopedAreas, folded, zoom: zoom(0.05 + next() * 5) };
  const hiddenAreas = new Set(areas.filter((area) => !isVisibleArea(partial, area)));
  const hiddenIds = new Set<RuntimeId>();
  for (const candidate of world.elements) {
    const area = regionAreaOf(candidate) ?? world.blockOwners.get(candidate.containerId ?? candidate.id) ?? null;
    if ((area !== null && hiddenAreas.has(area)) || chance(next, 0.1)) hiddenIds.add(candidate.id);
  }
  return { scene: { ...partial, hiddenIds }, hiddenAreas };
}

/** A random press point: half the time the centre of some Block, otherwise anywhere around the world. */
function generatedPoint(next: () => number, world: GeneratedWorld): Point<"scene"> {
  const root = world.rects.get(areaKey("root")) as Rect<"scene">;
  const blocks = world.elements.filter((candidate) => world.blockOwners.has(candidate.id));
  if (blocks.length > 0 && chance(next, 0.5)) {
    const target = pick(next, blocks);
    return point("scene", scenePx(target.x + target.width / 2), scenePx(target.y + target.height / 2));
  }
  return point("scene", scenePx(between(next, -50, root.width + 50)), scenePx(between(next, -50, root.height + 50)));
}

/** A random pointer command: mostly a move, sometimes a resize handle, sometimes rotation. */
function generatedCommand(next: () => number): PointerCommand {
  const roll = next();
  if (roll < 0.6) return { kind: "move", handle: null };
  if (roll < 0.85) return { kind: "resize", handle: pick(next, RESIZE_HANDLES) };
  return { kind: "ignore", handle: "rotation" };
}

/** One random press over one random world, built the way the pointer session builds it. */
function generated(seed: number): Generated {
  const next = random(seed);
  const world = generatedWorld(next);
  const { scene, hiddenAreas } = generatedScene(next, world);
  const selection = new Set(scene.elements.filter(() => chance(next, 0.15)).map((candidate) => candidate.id));
  if (chance(next, 0.3)) selection.add(runtimeId(`region-${pick(next, [...world.rects.keys()])}`));
  const pressPoint = generatedPoint(next, world);
  const context: PressContext = {
    point: pressPoint,
    modifiers: { shift: chance(next, 0.2), cmdOrCtrl: chance(next, 0.1) },
    spaceHeld: chance(next, 0.15),
    tool: pick(next, TOOLS),
    placementOpen: chance(next, 0.1),
    editingText: chance(next, 0.1),
    selection,
    selectedArea: selectedVisibleArea(scene, selection),
    command: generatedCommand(next),
    hit: hitTest(scene, pressPoint),
  };
  return { scene, context, hiddenAreas, blockOwners: world.blockOwners };
}

/** The Area a meaning names, or null when it names none. */
function namedArea(meaning: PressMeaning): AreaKey | null {
  return meaning.kind === "move-area" || meaning.kind === "resize-area" ? meaning.area : null;
}

/** True when `ancestor` is `area` or one of its ancestors. */
const isAncestorOrSelf = (ancestor: AreaKey, area: AreaKey): boolean => area === ancestor || area.startsWith(`${ancestor}/`);

test("meaningOfPress is total and deterministic", () => {
  for (let seed = 1; seed <= RUNS; seed += 1) {
    const first = generated(seed);
    const meaning = meaningOfPress(first.context);
    assert.ok(KINDS.has(meaning.kind), `seed ${seed} produced ${JSON.stringify(meaning)}`);
    assert.deepEqual(meaningOfPress(first.context), meaning, `seed ${seed} answered differently twice`);
    assert.deepEqual(meaningOfPress(generated(seed).context), meaning, `seed ${seed} answered differently for an equal context`);
  }
});

test("a press never names an Area that fold or scope has hidden, nor an element the hidden set holds", () => {
  for (let seed = 1; seed <= RUNS; seed += 1) {
    const { context, hiddenAreas, scene } = generated(seed);
    const meaning = meaningOfPress(context);
    const area = namedArea(meaning);
    if (area !== null) {
      assert.equal(hiddenAreas.has(area), false, `seed ${seed} named hidden Area ${area}`);
      assert.ok(isVisibleArea(scene, area), `seed ${seed} named an Area that is not visible`);
    }
    if (meaning.kind === "grab-element" || meaning.kind === "add-to-selection") {
      assert.equal(scene.hiddenIds.has(meaning.id), false, `seed ${seed} named hidden element ${meaning.id}`);
    }
  }
});

test("Space always pans, whatever else the press sees", () => {
  for (let seed = 1; seed <= RUNS; seed += 1) {
    const { context } = generated(seed);
    assert.deepEqual(meaningOfPress({ ...context, spaceHeld: true }), { kind: "pan" }, `seed ${seed} did not pan with Space held`);
  }
});

test("a press inside a Block never moves that Block's Area or any ancestor of it", () => {
  let pressesOnBlocks = 0;
  for (let seed = 1; seed <= RUNS; seed += 1) {
    const { context, blockOwners } = generated(seed);
    const owner = context.hit.element ? blockOwners.get(context.hit.element.id) : undefined;
    if (owner === undefined || !context.hit.inside) continue;
    pressesOnBlocks += 1;
    const meaning = meaningOfPress(context);
    assert.notEqual(meaning.kind, "move-area", `seed ${seed} moved an Area from a press inside a Block`);
    const area = namedArea(meaning);
    if (area !== null) assert.equal(isAncestorOrSelf(area, owner) && meaning.kind === "move-area", false, `seed ${seed} moved ancestor ${area}`);
  }
  assert.ok(pressesOnBlocks > RUNS / 10, `only ${pressesOnBlocks} presses landed inside a Block`);
});

test("a rotation handle on the selected Area is refused, whatever is under the point", () => {
  let rotations = 0;
  for (let seed = 1; seed <= RUNS; seed += 1) {
    const { context, scene } = generated(seed);
    const visibleRegion = scene.elements.find((candidate) => regionAreaOf(candidate) !== null && !scene.hiddenIds.has(candidate.id) && isVisibleArea(scene, regionAreaOf(candidate) as AreaKey));
    if (!visibleRegion) continue;
    const selection = new Set([visibleRegion.id]);
    const rotating: PressContext = {
      ...context, tool: "selection", spaceHeld: false, placementOpen: false, editingText: false, modifiers: { shift: false, cmdOrCtrl: false },
      selection, selectedArea: selectedVisibleArea(scene, selection), command: { kind: "ignore", handle: "rotation" },
    };
    rotations += 1;
    assert.deepEqual(meaningOfPress(rotating), { kind: "ignore", reason: "rotation" }, `seed ${seed} let the Area rotate`);
  }
  assert.ok(rotations > RUNS / 2, `only ${rotations} runs had a visible region to select`);
});
