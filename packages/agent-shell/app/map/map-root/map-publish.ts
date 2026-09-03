// One Excalidraw change, turned into world authority.
//
// Excalidraw reports a flat list of elements. The Map has to read that as a change to one or more
// Area files: which shard each element belongs to, which Blocks moved and whether the kernel allows
// where they landed, which Areas grew, and which elements are new and must be claimed for a shard.
// This is the one function that does it. Everything it needs is injected, so a publish inside a
// pointer gesture, inside a keyboard command and outside both take the same path and differ only
// in which command the change lands in.
//
// The two halves it delegates to: `map-publish-claims.ts` decides ownership of new elements and
// arrow bindings, `map-publish-shards.ts` writes the shards and re-anchors the Areas that grew.

import { CANVAS_ANNOUNCEMENTS } from "../copy.ts";
import { selectedIds, selectionAppState } from "../canvas/projection.ts";
import type { Projection, SelectionAppState } from "../canvas/projection.ts";
import { isEphemeral } from "../input/hit-test.ts";
import { PointerSession, gestureBaselineOf, resolveClaimedId } from "../input/pointer-session.ts";
import { composeAreaMapWorld, detachCrossOwnerTextBindings, restoreFigurePresentation } from "../kernel/kernel-boundary.ts";
import type { AreaMapController, ComposedOrigin, Composition, GestureBaseline, SceneElement, Snapshot, World } from "../kernel/kernel-types.ts";
import { point } from "../units/frames.ts";
import type { Point } from "../units/frames.ts";
import { areaKey } from "../units/ids.ts";
import type { AreaKey, RuntimeId, ShardOwner, SourceId } from "../units/ids.ts";
import { add } from "../units/scalar-math.ts";
import { claimArrows, claimNonArrows } from "./map-publish-claims.ts";
import type { ClaimContext } from "./map-publish-claims.ts";
import { ownerMotion, reprioritizeChangedAreas, restoreMaskedElements, solveSelectedBlocks, writeShards } from "./map-publish-shards.ts";
import type { MapSession } from "./map-session.ts";

/** Everything a publish is given. Each field is one door out of this module. */
export type PublishDeps = {
  readonly controller: AreaMapController;
  readonly session: MapSession;
  readonly pointer: PointerSession;
  readonly projection: Projection;
  readonly announce: (text: string) => void;
  /** The deepest visible Area at a scene point, or the located Area when the point is over none. */
  readonly ownerAt: (at: Point<"scene">) => ShardOwner;
  /** Opens the non-pointer command a change outside a pointer gesture lands in. */
  readonly beginNonPointer: (kind: string) => void;
  /** Closes that command once Excalidraw has settled. */
  readonly settleNonPointer: () => void;
};

/** The world and composition a publish measures against, and the world it writes into. */
type PublishBaseline = {
  readonly world: World;
  readonly composition: Composition;
  readonly next: World;
  readonly solver: GestureBaseline;
  readonly pointerOpen: boolean;
};

/** The baseline of one publish: the pointer gesture's when one is open, else the command's own. */
function baselineOf(deps: PublishDeps): PublishBaseline {
  const pointerWorld = deps.pointer.baselineWorld();
  const world = pointerWorld ?? deps.session.nonPointer?.baseline ?? deps.controller.world();
  const composition = deps.pointer.composition() ?? composeAreaMapWorld(world);
  const next = pointerWorld === null ? structuredClone(world) : deps.controller.world();
  const solver = deps.pointer.gestureBaseline() ?? gestureBaselineOf(world);
  return { world, composition, next, solver, pointerOpen: pointerWorld !== null };
}

/** Warns once per command when Excalidraw tried to delete an Area outline the tree owns. */
function guardAreaOutlines(deps: PublishDeps, elements: readonly SceneElement[], baseline: PublishBaseline): void {
  const incoming = new Map(elements.map((element) => [element.id, element]));
  const removed = baseline.composition.scene.elements.some((element) => element.customData?.tangent?.role === "area-region"
    && (!incoming.has(element.id) || incoming.get(element.id)?.isDeleted === true));
  if (!removed || deps.session.outlineProtectionAnnounced) return;
  deps.session.outlineProtectionAnnounced = true;
  deps.announce(CANVAS_ANNOUNCEMENTS.outlinesFromTree);
}

/** The ids the press grabbed, or what Excalidraw holds selected when no press owns the change. */
function movedIds(deps: PublishDeps, appState: SelectionAppState): ReadonlySet<RuntimeId> {
  return deps.session.pointerSelected.size ? deps.session.pointerSelected : new Set(selectedIds(appState));
}

/** The authored elements of one publish: what Excalidraw drew, with every masked element put back. */
function authoredElements(deps: PublishDeps, elements: readonly SceneElement[], baseline: PublishBaseline, snapshot: Snapshot, moved: ReadonlySet<RuntimeId>): SceneElement[] {
  const restored = restoreFigurePresentation(restoreMaskedElements(elements, baseline.composition, snapshot.hiddenIds));
  const known = new Set(restored.map((element) => element.id));
  const complete = [...restored];
  for (const element of baseline.composition.scene.elements) {
    if (known.has(element.id) || element.customData?.tangent?.role === "area-region" || isEphemeral(element)) continue;
    if (moved.has(element.id) || (element.containerId !== undefined && element.containerId !== null && moved.has(element.containerId))) continue;
    complete.push(structuredClone(element));
  }
  return complete.filter((element) => element.customData?.tangent?.role !== "area-region" && !isEphemeral(element));
}

/**
 * Carries an element the person did not touch by the distance its own shard moved. A drag of one
 * Area moves every shard the composition reflowed; without this, an untouched Block would be
 * published at the composed position it happened to be drawn at and would drift inside its file.
 */
function carryUnmoved(baseline: PublishBaseline, after: Composition, authored: readonly SceneElement[], moved: ReadonlySet<RuntimeId>): SceneElement[] {
  if (!baseline.pointerOpen) return [...authored];
  const before = new Map(baseline.composition.scene.elements.map((element) => [element.id, element]));
  return authored.map((element) => {
    const container = element.containerId ?? null;
    if (moved.has(element.id) || (container !== null && moved.has(container))) return element;
    const original = before.get(element.id);
    const origin = baseline.composition.origins.get(element.id);
    if (original === undefined || origin === undefined) return element;
    const motion = ownerMotion(baseline.composition, after, origin.owner);
    return { ...structuredClone(original), x: add(original.x, motion.dx), y: add(original.y, motion.dy) };
  });
}

/** The origin table of one publish: the baseline's, the next composition's, and everything claimed before. */
function originsOf(deps: PublishDeps, baseline: PublishBaseline, after: Composition, authored: readonly SceneElement[]): Map<RuntimeId, ComposedOrigin> {
  const origins = new Map<RuntimeId, ComposedOrigin>([...baseline.composition.origins, ...after.origins]);
  for (const element of authored) {
    const claimed = deps.session.claimedOrigins.get(element.id);
    if (claimed === undefined) continue;
    origins.set(element.id, claimed);
    element.customData = { ...(element.customData ?? {}), tangentWorld: claimed };
  }
  return origins;
}

/** The claim context of one publish, with the source ids every shard already uses. */
function claimContextOf(deps: PublishDeps, baseline: PublishBaseline, origins: Map<RuntimeId, ComposedOrigin>, snapshot: Snapshot, claimedIds: Map<RuntimeId, RuntimeId>, candidates: Set<ShardOwner>): ClaimContext {
  const sourceIds = new Map<ShardOwner, Set<SourceId>>();
  for (const origin of origins.values()) {
    const used = sourceIds.get(origin.owner) ?? new Set<SourceId>();
    used.add(origin.sourceId);
    sourceIds.set(origin.owner, used);
  }
  return {
    session: deps.session, origins, sourceIds, claimedIds, candidateOwners: candidates,
    owners: new Set(baseline.next.areas.map((node) => node.shard.owner)),
    fallbackOwner: snapshot.locatedArea as unknown as ShardOwner,
    paste: deps.session.pastePlacement,
    ownerAt: deps.ownerAt,
  };
}

/** The shards a pointer publish may rewrite: the ones its own selection and its claims touched. */
function candidateOwnersOf(deps: PublishDeps, origins: ReadonlyMap<RuntimeId, ComposedOrigin>, moved: ReadonlySet<RuntimeId>): Set<ShardOwner> {
  const owners = new Set<ShardOwner>();
  for (const id of moved) {
    const origin = origins.get(id);
    if (origin !== undefined) owners.add(origin.owner);
  }
  for (const origin of deps.session.claimedOrigins.values()) owners.add(origin.owner);
  return owners;
}

/** Where a new element lands when nothing else says: the paste point, the text press, or the pointer origin. */
function placementPointOf(deps: PublishDeps): Point<"scene"> | null {
  return deps.session.pastePlacement?.point ?? deps.session.textPlacement ?? deps.pointer.currentPoint();
}

/** Clears the one-shot placement windows a publish consumed. */
function clearPlacementWindows(deps: PublishDeps): void {
  deps.session.pastePlacement = null;
  deps.session.textPlacement = null;
}

/** Installs the world a publish built, inside the pointer gesture or inside a command of its own. */
function installWorld(deps: PublishDeps, baseline: PublishBaseline, changes: { changedAreas: Set<AreaKey>; changedOwners: Set<ShardOwner> }, editing: boolean): void {
  if (baseline.pointerOpen) {
    deps.controller.preview(baseline.next, changes);
    return;
  }
  deps.beginNonPointer(editing ? "text" : deps.session.actionKind ?? "edit");
  deps.controller.preview(baseline.next, changes);
  deps.session.actionKind = null;
  if (!editing) deps.settleNonPointer();
}

/** Moves the selection onto the world ids the claims minted, and pushes it once Excalidraw can take it. */
function settleClaimedSelection(deps: PublishDeps, baseline: PublishBaseline, claimedIds: ReadonlyMap<RuntimeId, RuntimeId>, appState: SelectionAppState, editing: boolean): void {
  if (claimedIds.size === 0) return;
  const valid = new Set(composeAreaMapWorld(baseline.next).scene.elements.map((element) => element.id));
  const incoming = new Set([...deps.controller.snapshot().selection, ...selectedIds(appState)]);
  const remapped = new Set([...incoming].map((id) => resolveClaimedId(claimedIds, id)).filter((id) => valid.has(id)));
  deps.session.stableSelection = remapped;
  const liveNewPointer = baseline.pointerOpen && deps.session.pointerSelected.size === 0;
  deps.session.programmaticSelection = !editing && remapped.size ? remapped : null;
  deps.controller.setSelection(remapped);
  if (!editing && !liveNewPointer) deps.projection.defer({ selection: remapped }, "claim");
}

/** Publishes a scene Excalidraw handed back with nothing for the world to record. */
function publishNoChange(deps: PublishDeps, baseline: PublishBaseline): void {
  if (baseline.pointerOpen && deps.session.pointerSelected.size === 0 && deps.session.claimedOrigins.size) return;
  deps.projection.defer({ elements: deps.controller.snapshot().scene.elements }, "no-change");
}

/** Applies one corrected Excalidraw update to the source shards it belongs to. */
export function publishToWorld(deps: PublishDeps, elements: readonly SceneElement[], appState: SelectionAppState & { editingTextElement?: unknown }): void {
  const snapshot = deps.controller.snapshot();
  const baseline = baselineOf(deps);
  if (!baseline.pointerOpen && deps.session.nonPointer === null) deps.session.outlineProtectionAnnounced = false;
  guardAreaOutlines(deps, elements, baseline);
  const moved = movedIds(deps, appState);
  const authored = authoredElements(deps, elements, baseline, snapshot, moved);
  const after = composeAreaMapWorld(baseline.next);
  const carried = carryUnmoved(baseline, after, authored, moved);
  const origins = originsOf(deps, baseline, after, carried);
  const candidates = candidateOwnersOf(deps, origins, moved);
  const claimedIds = new Map<RuntimeId, RuntimeId>();
  const context = claimContextOf(deps, baseline, origins, snapshot, claimedIds, candidates);
  const pointerPoint = placementPointOf(deps);
  claimNonArrows(context, carried, pointerPoint);
  claimArrows(context, carried, pointerPoint);
  clearPlacementWindows(deps);
  solveSelectedBlocks({
    controller: deps.controller, solver: baseline.solver, baselineWorld: baseline.world,
    baselineElements: new Map(baseline.composition.scene.elements.map((element) => [element.id, element])),
    baselineOffsets: baseline.composition.offsets,
    /** How far one shard's composed origin moved between the baseline and the world being written. */
    motion: (owner: ShardOwner) => ownerMotion(baseline.composition, after, owner),
    origins,
  }, moved, carried);
  detachCrossOwnerTextBindings(carried, origins);
  const changedOwners = writeShards(baseline.next, carried, origins, after.offsets, baseline.pointerOpen ? candidates : null, (owner) => {
    void deps.controller.materialize(areaKey(owner));
    deps.announce(CANVAS_ANNOUNCEMENTS.loading(areaKey(owner).split("/").at(-1) ?? owner));
  });
  const changedAreas = reprioritizeChangedAreas(baseline.next, baseline.world, baseline.composition, changedOwners, new Set<AreaKey>());
  if (changedAreas.size === 0 && changedOwners.size === 0) {
    publishNoChange(deps, baseline);
    return;
  }
  const editing = Boolean(appState.editingTextElement);
  installWorld(deps, baseline, { changedAreas, changedOwners }, editing);
  settleClaimedSelection(deps, baseline, claimedIds, appState, editing);
}

/** Publishes what Excalidraw holds now, which is what a released drag settles with. */
export function publishCurrentState(deps: PublishDeps): void {
  const api = deps.session.api;
  if (api === null) return;
  const appState = api.getAppState();
  if (appState.editingTextElement) return;
  const claimed = new Map(deps.session.claimedIds);
  const elements = api.getSceneElements().map((element) => structuredClone(element)) as unknown as SceneElement[];
  const remapped = elements.map((element) => ({ ...element, id: resolveClaimedId(claimed, element.id) }));
  const selection = selectionAppState(selectedIds(appState).map((id) => resolveClaimedId(claimed, id)));
  publishToWorld(deps, remapped, { ...selection, editingTextElement: null });
}

/** The scene point of an element's own corner, for a caller that needs one without the hit test. */
export function elementOrigin(element: SceneElement): Point<"scene"> {
  return point("scene", element.x, element.y);
}
