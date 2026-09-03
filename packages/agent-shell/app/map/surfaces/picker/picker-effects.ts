// The picker's effects: opening it at the placement spot, searching the vault when it is wide,
// placing a chosen Block into its Area's shard through the controller, and claiming a pasted
// reference. Every function takes the environment the Map root wires and dispatches the actions
// the pure store applies. A Block lands in the shard the vault stores: the scene point is carried
// into the owner's source frame, the kernel places it at the nearest free point, and the world with
// that shard replaced is committed as one gesture.

import { PICKER_ANNOUNCEMENTS, RESOURCE_ANNOUNCEMENTS } from "../../copy.ts";
import type { VisibleScene } from "../../input/hit-test.ts";
import { placementPoint, placementTarget, visibleSceneRect } from "../../input/placement-point.ts";
import { areaMapStructuralHullChanged, placeBlockAtNearestFreePoint, referenceFromText, reprioritizeAreaPlacement, runtimeId, shardHulls, wideChoices } from "../../kernel/kernel-boundary.ts";
import type { AreaMapController, Composition, ResourcePanelRow, Shard, SourceScene, VaultDocument, World } from "../../kernel/kernel-types.ts";
import { nextBranchPriority } from "../../layout/branch-priority.ts";
import { point } from "../../units/frames.ts";
import type { Camera, Point, Rect, Size } from "../../units/frames.ts";
import { areaKey, shardOwner, sourceId } from "../../units/ids.ts";
import type { AreaKey, RuntimeId, SourceId } from "../../units/ids.ts";
import { rectCenter, toSource } from "../../units/scalar-math.ts";
import { count, scenePx } from "../../units/units.ts";
import type { Count } from "../../units/units.ts";
import { pickerDocuments, vaultIndexItems } from "./picker-choices.ts";
import type { PickerEntry, ResourceChoiceFacts } from "./picker-choices.ts";
import { pickerTarget } from "./picker-store.ts";
import type { PickerAction, PickerState, PickerTarget, PlacementSpot } from "./picker-store.ts";

/**
 * What the Map shows now, which is everything the placement spot is derived from. `MapRoot.tsx`
 * builds one per press from the controller snapshot and the canvas: the camera, the size of the
 * canvas in screen pixels, the last scene point the pointer was at, the projected visible scene
 * from `input/hit-test.ts`, and the Area the Map is viewed from.
 */
export type PlacementView = {
  readonly camera: Camera;
  readonly viewport: Size<"screen">;
  readonly lastPointer: Point<"scene"> | null;
  readonly scene: VisibleScene;
  readonly locatedArea: AreaKey;
};

/**
 * Where a new Block lands: the on-screen point `input/placement-point.ts` derives from the camera,
 * and the deepest visible Area under it. A hidden or off-screen Area can never be the target, so a
 * Block placed while an Area is folded lands where the person can see it (audit defects 3 and 9).
 * The located Area is the fallback, and it is never hidden because it is the Area the Map shows.
 */
export function placementSpotOf(view: PlacementView): PlacementSpot {
  const target = placementPoint(view.camera, view.viewport, view.lastPointer);
  return { area: placementTarget(target, view.scene) ?? view.locatedArea, point: target };
}

/** A vault search the host offers, abortable. */
export type VaultSearch = (query: string, options: { signal: AbortSignal }) => Promise<readonly VaultDocument[] | null | undefined>;

/** Everything the picker needs from the rest of the Map. `MapRoot.tsx` builds one and hands it to the dialog. */
export type PickerEnvironment = {
  readonly controller: AreaMapController;
  /** The vault documents the Map paints facts from. */
  readonly documents: () => readonly VaultDocument[];
  /** What the Map shows now, from which `placementSpotOf` derives where B and paste land. */
  readonly placementView: () => PlacementView;
  /** The current Resource rows of one Area with their resolved facts, from the Resources surface. */
  readonly resourceChoices: (area: AreaKey) => readonly ResourceChoiceFacts[];
  /** The host's vault search, when it offers one. */
  readonly searchDocuments?: VaultSearch;
  /** Hands a Resource choice to the placement bar, which owns Resource placement. */
  readonly placeResource: (row: ResourcePanelRow) => void;
  /** Selects an Area that already has a region instead of placing a second one. */
  readonly selectArea: (area: AreaKey) => void;
  /** Asks the Resources surface to load the target Area's rows. Optional. */
  readonly loadResources?: (area: AreaKey) => void;
  /** Starts editing the placed Block's label on the canvas. Optional; the canvas owns it. */
  readonly editLabel?: (labelId: RuntimeId) => void;
  /** Mints the source id of a new Block. Defaults to a random UUID; tests pass a fixed one. */
  readonly mintId?: () => SourceId;
  readonly announce: (text: string) => void;
  readonly dispatch: (action: PickerAction) => void;
};

/** Opens the picker at the placement spot and asks for the target Area's Resources. */
export function openPicker(env: PickerEnvironment): PickerTarget {
  const view = env.placementView();
  const spot = placementSpotOf(view);
  const centre = rectCenter(visibleSceneRect(view.camera, view.viewport));
  const target = pickerTarget(spot, [...view.scene.regionRects.values()], centre);
  env.dispatch({ kind: "open", target });
  env.loadResources?.(spot.area);
  return target;
}

/** The documents the picker chooses from: the vault search results over what the Map knows. */
export function pickerCorpus(env: PickerEnvironment, state: PickerState): VaultDocument[] {
  return pickerDocuments(state.entities, env.documents());
}

/**
 * Runs the vault search for the wide picker and dispatches its results. Returns the cleanup that
 * aborts it, for a render effect. Does nothing when the picker is not wide or the host has no search.
 */
export function searchVault(env: PickerEnvironment, active: boolean, query: string): () => void {
  const search = env.searchDocuments;
  if (!active || search === undefined) return () => undefined;
  const request = new AbortController();
  let current = true;
  search(query, { signal: request.signal }).then(
    (rows) => { if (current) env.dispatch({ kind: "set-entities", entities: rows ?? [] }); },
    (error: unknown) => { if (current && !(error instanceof Error && error.name === "AbortError")) env.announce(PICKER_ANNOUNCEMENTS.vaultSearchUnavailable); },
  );
  return () => { current = false; request.abort(); };
}

/** The shard of one Area, loaded on demand when it has no scene yet. Null when the Area is not in the world. */
async function loadedShard(controller: AreaMapController, area: AreaKey): Promise<Shard | null> {
  const node = controller.world().areas.find((entry) => entry.key === area);
  if (node === undefined) return null;
  return node.shard.scene ? node.shard : controller.materialize(area);
}

/** The world with one Area's shard scene replaced. Every other node is shared, never mutated. */
function worldWithShardScene(world: World, area: AreaKey, scene: SourceScene): World {
  return { ...world, areas: world.areas.map((node) => (node.key === area ? { ...node, shard: { ...node.shard, scene } } : node)) };
}

/** The bound label of a placed Block, by the binding the kernel wrote on its root. */
function labelIdOf(root: { boundElements: readonly { id: SourceId; type: string }[] | null }): SourceId | null {
  return root.boundElements?.find((binding) => binding.type === "text")?.id ?? null;
}

/** A fresh source id for a new Block. */
function mintSourceId(): SourceId {
  return sourceId(crypto.randomUUID());
}

/**
 * Re-anchors the Area a new Block landed in, when its own content hull changed. A lower-priority
 * branch is drawn away from its authored rectangle; raising its priority without absorbing the
 * position it was drawn at would snap the Area and the new Block back to the old one.
 */
function reanchorAfterPlacement(world: World, before: Composition, area: AreaKey, beforeHull: Rect<"source"> | null): World {
  const node = world.areas.find((entry) => entry.key === area);
  if (node === undefined || !areaMapStructuralHullChanged(beforeHull, shardHulls(node.shard.scene).blocks)) return world;
  const anchor = before.geometry.get(area)?.resolvedStored ?? null;
  const region = reprioritizeAreaPlacement(node.region, anchor, nextBranchPriority(world));
  return { ...world, areas: world.areas.map((entry) => (entry.key === area ? { ...entry, region } : entry)) };
}

/** Places one new Block into its Area's shard at the spot and selects it. False when the shard is not loadable. */
async function placeIntoShard(env: PickerEnvironment, entry: PickerEntry, area: AreaKey, spot: PlacementSpot, keepOpen: boolean): Promise<boolean> {
  const shard = await loadedShard(env.controller, area);
  const scene = shard?.scene;
  if (!scene) {
    env.announce(RESOURCE_ANNOUNCEMENTS.placementUnavailable);
    return false;
  }
  const id = (env.mintId ?? mintSourceId)();
  const offset = env.controller.composition().offsets.get(area) ?? point("scene", scenePx(0), scenePx(0));
  const placed = placeBlockAtNearestFreePoint(scene, entry, toSource(spot.point, offset), id);
  if (placed.root === null) return false;
  const owner = shardOwner(area);
  const before = env.controller.composition();
  const beforeHull = shardHulls(scene).blocks;
  const placedWorld = worldWithShardScene(env.controller.world(), area, placed.scene);
  // The selection is set while the placement command is still open. The controller records the
  // selection when the gesture ends, and that record is what redo restores, so a selection set
  // after the command closed would be lost on undo then redo.
  env.controller.beginGesture("place");
  env.controller.preview(reanchorAfterPlacement(placedWorld, before, area, beforeHull), { changedAreas: [area], changedOwners: [owner] });
  env.controller.setSelection([runtimeId(owner, id)]);
  env.controller.endGesture("place");
  const label = labelIdOf(placed.root);
  if (!keepOpen && entry.kind !== "resource" && label !== null) env.editLabel?.(runtimeId(owner, label));
  env.dispatch({ kind: "placed", keepOpen });
  return true;
}

/**
 * Places one chosen Block. A Resource choice goes to the placement bar; an Area that already has a
 * region is selected instead; anything else lands in the entry's owner or the spot's Area.
 */
export async function placeBlock(env: PickerEnvironment, entry: PickerEntry, spot: PlacementSpot, keepOpen: boolean): Promise<boolean> {
  if (entry.resourceRow !== undefined) {
    env.placeResource(entry.resourceRow);
    return true;
  }
  if (entry.kind === "area" && entry.area !== undefined && env.controller.world().areas.some((node) => node.key === entry.area)) {
    env.selectArea(entry.area);
    env.dispatch({ kind: "placed", keepOpen });
    return true;
  }
  const area = entry.owner === undefined ? spot.area : areaKey(entry.owner);
  return placeIntoShard(env, entry, area, spot, keepOpen);
}

/** Places the first listed choice, which is what Enter in the query does. Shift keeps the picker open. */
export function placeFirst(env: PickerEnvironment, entries: readonly PickerEntry[], target: PickerTarget, keepOpen: boolean): Promise<boolean> {
  const first = entries[0];
  return first === undefined ? Promise.resolve(false) : placeBlock(env, first, target, keepOpen);
}

/**
 * Claims pasted text that names a Block: places it at the placement spot and returns true. Plain
 * text returns false so the canvas pastes it as Excalidraw would.
 */
export function pasteReference(env: PickerEnvironment, text: string | null | undefined): boolean {
  const choice = referenceFromText(text, wideChoices("", vaultIndexItems(env.documents())));
  if (choice === null) return false;
  void placeBlock(env, choice, placementSpotOf(env.placementView()), false);
  return true;
}
