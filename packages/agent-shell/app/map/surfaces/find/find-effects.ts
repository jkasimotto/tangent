// Find's effects: matching through the kernel's find core and the camera moves that preview,
// keep or cancel a match. Every function takes the environment the Map root wires (the controller,
// the canvas moves, the announcer, the dispatcher) and the current store state, and dispatches the
// actions the pure store applies. Nothing here touches the DOM; the camera moves go through the
// canvas callbacks the environment names.

import { FIND_ANNOUNCEMENTS } from "../../copy.ts";
import { areaForBlock, mapFindMatches, tangentOf } from "../../kernel/kernel-boundary.ts";
import type { AreaMapController, FindAreaInput, FindBlockInput, FindRow, MapEntityFacts, SceneElement, Snapshot, VaultDocument } from "../../kernel/kernel-types.ts";
import type { Camera } from "../../units/frames.ts";
import { areaKey } from "../../units/ids.ts";
import type { AreaKey, RuntimeId } from "../../units/ids.ts";
import { count } from "../../units/units.ts";
import type { Index } from "../../units/units.ts";
import { activeFindIndex, steppedFindIndex } from "./find-store.ts";
import type { FindAction, FindDirection, FindState } from "./find-store.ts";

/** Everything Find needs from the rest of the Map. `MapRoot.tsx` builds one and hands it to the hang. */
export type FindEnvironment = {
  readonly controller: AreaMapController;
  /** The vault documents the Map paints facts from; `areaForBlock` reads them for a Block with no origin. */
  readonly documents: () => readonly VaultDocument[];
  /** Resolves one Block with the kinds catalog and its Resource facts, the way every surface does. */
  readonly resolveBlock: (element: SceneElement) => MapEntityFacts | null;
  /** The display name of an Area: its note title, else its leaf. */
  readonly areaName: (area: AreaKey) => string;
  /** Scrolls Excalidraw so the elements fit the view; `animate` is false under reduced motion. */
  readonly scrollTo: (elements: readonly SceneElement[], animate: boolean) => void;
  /** Puts Excalidraw's camera back where Cancel wants it, without entering history. */
  readonly moveCamera: (camera: Camera) => void;
  /** True when the person asked for reduced motion. */
  readonly reducedMotion: () => boolean;
  /** Ends a Show on Map return layer, because keeping a match replaces the prior view. Optional. */
  readonly releaseShowOnMap?: () => void;
  /** Speaks a sentence through the live region, not shown as a toast. */
  readonly announce: (text: string) => void;
  readonly dispatch: (action: FindAction) => void;
};

/** The Areas a person can see: those with a region in the projected scene. */
function visibleAreas(snapshot: Snapshot): Set<AreaKey> {
  const areas = new Set<AreaKey>();
  for (const element of snapshot.scene.elements) {
    const tangent = element.customData?.tangent;
    if (!element.isDeleted && tangent?.role === "area-region" && tangent.area !== undefined) areas.add(tangent.area);
  }
  return areas;
}

/** The Area inputs Find searches: every visible Area by its display name, path and depth. */
function areaInputs(env: FindEnvironment, snapshot: Snapshot, visible: ReadonlySet<AreaKey>): FindAreaInput[] {
  return snapshot.world.areas
    .filter((node) => visible.has(node.key))
    .map((node) => ({ path: node.key, name: env.areaName(node.key), depth: node.depth }));
}

/** The Area a Block belongs to: its shard owner, else what its metadata says. */
function blockArea(element: SceneElement, documents: readonly VaultDocument[]): AreaKey {
  const owner = element.customData?.tangentWorld?.owner;
  return owner === undefined ? areaForBlock(element, documents) || areaKey("") : areaKey(owner);
}

/** The Block inputs Find searches, matched on their resolved words, with the label each row shows. */
function blockInputs(env: FindEnvironment, snapshot: Snapshot, visible: ReadonlySet<AreaKey>): { blocks: FindBlockInput[]; labels: Map<RuntimeId, string> } {
  const documents = env.documents();
  const blocks: FindBlockInput[] = [];
  const labels = new Map<RuntimeId, string>();
  for (const element of snapshot.scene.elements) {
    if (element.isDeleted) continue;
    const tangent = tangentOf(element);
    if (tangent === null || tangent.role === "area-region" || tangent.role === "boundary") continue;
    const facts = env.resolveBlock(element);
    if (facts === null) continue;
    const area = blockArea(element, documents);
    if (!visible.has(area)) continue;
    blocks.push({ kind: tangent.kind, elementId: element.id, name: facts.searchText, area, hidden: false });
    labels.set(element.id, facts.display.label);
  }
  return { blocks, labels };
}

/** A Find row that names a loaded Block rather than an Area. */
type FindBlockRow = Extract<FindRow, { elementId: RuntimeId }>;

/**
 * True when the row names a Block. The Area row has no element id, and a Block row's `kind` is the
 * Block's kind rather than a literal, so the element id is what tells the two apart.
 */
function isBlockRow(row: FindRow): row is FindBlockRow {
  return "elementId" in row;
}

/** The row with the label the Map paints on the Block, so the list reads the same words the canvas does. */
function labelledRow(row: FindRow, labels: ReadonlyMap<RuntimeId, string>): FindRow {
  return isBlockRow(row) ? { ...row, name: labels.get(row.elementId) ?? row.name } : row;
}

/** Every Area and loaded Block that matches the query, Areas first, each Block row named by its label. */
export function findMatches(env: FindEnvironment, query: string): FindRow[] {
  const snapshot = env.controller.snapshot();
  const visible = visibleAreas(snapshot);
  const { blocks, labels } = blockInputs(env, snapshot, visible);
  return mapFindMatches({ areas: areaInputs(env, snapshot, visible), blocks }, query).map((row) => labelledRow(row, labels));
}

/** The composed element a row names: the Area's region (selected, no camera step) or the Block itself. */
function rowElement(env: FindEnvironment, row: FindRow): SceneElement | null {
  if (!isBlockRow(row)) return env.controller.selectArea(row.area);
  return env.controller.composition().scene.elements.find((candidate) => candidate.id === row.elementId) ?? null;
}

/** Brings one row into view without adding a camera-history step. A Block row is revealed and selected. */
function previewRow(env: FindEnvironment, row: FindRow): boolean {
  const element = rowElement(env, row);
  if (element === null) return false;
  if (isBlockRow(row)) {
    env.controller.setFindReveal(element.id);
    env.controller.setSelection([element.id]);
  }
  env.scrollTo([element], !env.reducedMotion());
  return true;
}

/** Opens the hang and records the view Cancel returns to. Opening twice keeps the first origin. */
export function openFind(env: FindEnvironment): void {
  env.dispatch({ kind: "open", origin: env.controller.captureView() });
}

/** Applies typed text: previews the first match and says how many there are, or says there is none. */
export function applyFindQuery(env: FindEnvironment, query: string): void {
  const rows = findMatches(env, query);
  const total = count(rows.length);
  env.dispatch({ kind: "set-query", query, total });
  const first = rows[0];
  if (first === undefined) {
    env.controller.setFindReveal(null);
    if (query.trim()) env.announce(FIND_ANNOUNCEMENTS.noMatch);
    return;
  }
  previewRow(env, first);
  env.announce(FIND_ANNOUNCEMENTS.matches(total, first.name));
}

/** Moves to the next or previous match, wrapping, and previews it. */
export function stepFind(env: FindEnvironment, state: FindState, direction: FindDirection): boolean {
  const rows = findMatches(env, state.query);
  const total = count(rows.length);
  const position = steppedFindIndex(state.index, direction, total);
  const row = rows[position];
  if (row === undefined) {
    if (state.query.trim()) env.announce(FIND_ANNOUNCEMENTS.noMatch);
    return false;
  }
  env.dispatch({ kind: "step", direction, total });
  previewRow(env, row);
  env.announce(FIND_ANNOUNCEMENTS.step(position, total, row.name));
  return true;
}

/** Moves to one row a person pointed at and previews it. */
export function selectFindRow(env: FindEnvironment, state: FindState, position: Index): boolean {
  const rows = findMatches(env, state.query);
  const row = rows[position];
  if (row === undefined) return false;
  env.dispatch({ kind: "select", position });
  previewRow(env, row);
  env.announce(FIND_ANNOUNCEMENTS.preview(count(rows.length), row.name));
  return true;
}

/** Keeps the current match: fits its Area with one camera return step and closes the hang. */
export function confirmFind(env: FindEnvironment, state: FindState): boolean {
  const rows = findMatches(env, state.query);
  const row = rows[activeFindIndex(state.index, count(rows.length))];
  if (row === undefined) return false;
  env.releaseShowOnMap?.();
  const region = env.controller.fitArea(row.area, { push: true, select: !isBlockRow(row) });
  const target = isBlockRow(row) ? keepBlock(env, row.elementId) : keepArea(env, region);
  if (target !== null) env.scrollTo([target], false);
  env.dispatch({ kind: "confirm" });
  return true;
}

/** Keeps an Area row: nothing stays revealed, the fitted region is the camera target. */
function keepArea(env: FindEnvironment, region: SceneElement | null): SceneElement | null {
  env.controller.setFindReveal(null);
  return region;
}

/** Keeps a Block row: it stays revealed and selected, and it is the camera target. */
function keepBlock(env: FindEnvironment, id: RuntimeId): SceneElement | null {
  env.controller.setFindReveal(id);
  env.controller.setSelection([id]);
  return env.controller.composition().scene.elements.find((candidate) => candidate.id === id) ?? null;
}

/** Closes the hang and puts the camera, the located Area and the selection back where Find opened. */
export function cancelFind(env: FindEnvironment, state: FindState): void {
  const origin = state.origin;
  env.dispatch({ kind: "cancel" });
  if (origin === null) return;
  const restored = env.controller.restoreView(origin);
  env.moveCamera(restored.camera);
}
