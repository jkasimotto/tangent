// The model behind the Area name pills: which Areas get a label, what each says, where it sits.
//
// A pill names one visible Area at the top-left corner of its region, with its fold and load
// state and its block count as notes, and reads out an accessible name that the Outline rows share
// byte for byte. Under a pill that has runtime facts sits a row of them: who is working, what
// waits for Julian, the problems, and whether the facts are fresh. Everything here is pure, so
// `AreaLabels.tsx` only renders, and the accessible name format is proved under Node.

import { AREA_LABELS } from "../copy.ts";
import type { FoldWord, RuntimeVerb } from "../copy.ts";
import type { AreaNode, AreaRuntimeFacts, RuntimeFactCount, VaultDocument } from "../kernel/kernel-types.ts";
import { LAYOUT } from "../layout/layout-tokens.ts";
import { delta, point } from "../units/frames.ts";
import type { Camera, Point, Rect } from "../units/frames.ts";
import { areaKey, shardOwner } from "../units/ids.ts";
import type { AreaKey, ShardOwner } from "../units/ids.ts";
import { toScreen, translate } from "../units/scalar-math.ts";
import { count, index } from "../units/units.ts";
import type { Count } from "../units/units.ts";

/** The owner of the top-level shard, whose children are at the root of the map. */
const ROOT_OWNER: ShardOwner = shardOwner("@root");

/** The shard states a pill notes beside the name. */
const NOTED_SHARD_STATES: ReadonlySet<string> = new Set(["loading", "deferred", "unreadable", "load-error"]);

/** The Area documents by key: the title a pill shows and the runtime facts under it. */
export type AreaRecords = ReadonlyMap<AreaKey, VaultDocument>;

/** One runtime fact button: the verb it opens in Work and the words on it. */
export type RuntimeFact = { readonly verb: RuntimeVerb; readonly label: string };

/** The compact, coordinate-free facts shown beside one Area label. */
export type AreaRuntimeAnnotations = {
  readonly facts: readonly RuntimeFact[];
  readonly ready: boolean;
  readonly stale: boolean;
};

/** What clicking a runtime fact sends to the host: the Area, its note file and the verb. */
export type AreaRuntimeVerbAction = { readonly kind: "area"; readonly area: AreaKey; readonly ref: string; readonly verb: RuntimeVerb };

/** Everything one pill and its facts row render from. */
export type AreaLabelModel = {
  readonly areaKey: AreaKey;
  readonly name: string;
  readonly accessibleName: string;
  readonly at: Point<"screen">;
  /** The notes after the name, in order: fold, load state, block summary. */
  readonly notes: readonly string[];
  /** True when Find's current match is this Area. */
  readonly current: boolean;
  /** The runtime facts row, or null when the Area publishes none. */
  readonly runtime: (AreaRuntimeAnnotations & { readonly at: Point<"screen">; readonly groupName: string; readonly ref: string }) | null;
};

/** The controller state the label models are built from. */
export type AreaLabelsInput = {
  readonly areas: readonly AreaNode[];
  readonly scopedAreas: ReadonlySet<AreaKey>;
  readonly folded: ReadonlySet<AreaKey>;
  readonly detailAreas: ReadonlySet<AreaKey>;
  readonly regionRects: ReadonlyMap<AreaKey, Rect<"scene">>;
  readonly camera: Camera;
  readonly records: AreaRecords;
  /** The Area Find currently points at, or null. */
  readonly currentFindArea: AreaKey | null;
};

/** The Area documents among the vault documents, keyed by Area. */
export function areaRecords(documents: readonly VaultDocument[]): AreaRecords {
  const records = new Map<AreaKey, VaultDocument>();
  for (const item of documents) if (item.kind === "area" && item.area !== undefined) records.set(item.area, item);
  return records;
}

/** The visible leaf name of one Area key: its last segment, or the fallback for an empty key. */
export function areaLeaf(area: AreaKey | ShardOwner): string {
  return String(area).split("/").at(-1) || AREA_LABELS.areaFallback;
}

/** The document title of one Area, or its leaf name. */
export function areaName(records: AreaRecords, area: AreaKey): string {
  return records.get(area)?.title ?? areaLeaf(area);
}

/** The full titled path of one Area, ancestors first, joined by the path separator. */
export function areaPathName(records: AreaRecords, area: AreaKey | ShardOwner): string {
  let key = "";
  return String(area).split("/").filter(Boolean).map((part) => {
    key = key ? `${key}/${part}` : part;
    return areaName(records, areaKey(key));
  }).join(AREA_LABELS.pathSeparator);
}

/** The parent as the accessible name says it: the map root, or the parent's titled path. */
export function areaParentName(records: AreaRecords, parent: ShardOwner): string {
  return parent === ROOT_OWNER ? AREA_LABELS.mapRoot : areaPathName(records, parent);
}

/** True when a folded ancestor takes the Area off the canvas. */
export function hiddenByFold(area: AreaKey, folded: ReadonlySet<AreaKey>): boolean {
  return [...folded].some((root) => area.startsWith(`${root}/`));
}

/** Normalizes one published runtime count without inventing activity. */
export function runtimeCount(value: RuntimeFactCount | undefined): Count {
  if (Array.isArray(value)) return count(value.length);
  if (value !== null && typeof value === "object" && "count" in value) return runtimeCount(value.count);
  const parsed = Number(value);
  return count(Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0);
}

/** Builds the compact, coordinate-free facts shown beside one Area label. */
export function areaRuntimeAnnotations(runtime: AreaRuntimeFacts | null | undefined): AreaRuntimeAnnotations {
  const working = runtimeCount(runtime?.working);
  const forYou = runtimeCount(runtime?.forYou);
  const problems = runtimeCount(runtime?.problems);
  const facts: RuntimeFact[] = [];
  if (working > 0) facts.push({ verb: "work", label: AREA_LABELS.working(working) });
  if (forYou > 0) facts.push({ verb: "for-you", label: AREA_LABELS.forYou(forYou) });
  if (problems > 0) facts.push({ verb: "problems", label: AREA_LABELS.problems(problems) });
  return { facts, ready: Boolean(runtime?.ready) && forYou === 0, stale: Boolean(runtime?.stale) };
}

/** The runtime words appended to an accessible name: each fact, then Ready, then last known facts. */
export function runtimeWords(runtime: AreaRuntimeAnnotations): string[] {
  return [
    ...runtime.facts.map((fact) => fact.label),
    ...(runtime.ready ? [AREA_LABELS.ready] : []),
    ...(runtime.stale ? [AREA_LABELS.lastKnownFacts] : []),
  ];
}

/** The fold state word of one Area. */
function foldWord(node: AreaNode, folded: ReadonlySet<AreaKey>): FoldWord {
  return folded.has(node.key) ? "folded" : "unfolded";
}

/** The accessible name of one Area pill or Outline row, in the format the browser suites match exactly. */
export function accessibleAreaName(records: AreaRecords, node: AreaNode, folded: ReadonlySet<AreaKey>): string {
  const runtime = areaRuntimeAnnotations(records.get(node.key)?.runtime);
  return AREA_LABELS.accessibleName({
    name: areaName(records, node.key),
    parent: areaParentName(records, node.parent),
    depth: index(node.depth),
    fold: foldWord(node, folded),
    shardState: node.shard.state,
    blocks: count(node.shard.blockCount ?? 0),
    runtimeWords: runtimeWords(runtime),
  });
}

/** The note a pill shows for a shard that is not simply ready, or null. */
function shardStateNote(node: AreaNode): string | null {
  const state = node.shard.state;
  if (!NOTED_SHARD_STATES.has(state)) return null;
  if (state === "unreadable") return AREA_LABELS.unreadable;
  if (state === "load-error") return AREA_LABELS.loadFailed;
  return state;
}

/** The notes after the name: the fold hint, the load state, and the block summary when the Area is not shown in detail. */
export function labelNotes(node: AreaNode, folded: ReadonlySet<AreaKey>, detailAreas: ReadonlySet<AreaKey>): string[] {
  const notes: string[] = [];
  if (folded.has(node.key)) notes.push(AREA_LABELS.folded);
  const stateNote = shardStateNote(node);
  if (stateNote !== null) notes.push(stateNote);
  if (!detailAreas.has(node.key)) notes.push(AREA_LABELS.blockSummary(count(node.shard.blockCount ?? 0)));
  return notes;
}

/** Where a pill sits on screen: the region's top-left corner, inset by the label insets. */
export function labelPosition(region: Rect<"scene">, camera: Camera): Point<"screen"> {
  const corner = toScreen(point("scene", region.x, region.y), camera);
  return translate(corner, delta("screen", LAYOUT.labelInsetX, LAYOUT.labelInsetY));
}

/** The note file of one Area, for the verb the host opens: the document's file, or the conventional path. */
function areaRef(record: VaultDocument | undefined, area: AreaKey): string {
  return record?.file ?? `${area}/${areaLeaf(area)}.md`;
}

/** The runtime facts row of one pill, or null when the Area publishes nothing. */
function runtimeRow(input: AreaLabelsInput, node: AreaNode, at: Point<"screen">): AreaLabelModel["runtime"] {
  const record = input.records.get(node.key);
  const runtime = areaRuntimeAnnotations(record?.runtime);
  if (runtime.facts.length === 0 && !runtime.ready && !runtime.stale) return null;
  return {
    ...runtime,
    at: translate(at, delta("screen", LAYOUT.labelInsetX, LAYOUT.runtimeFactsOffset)),
    groupName: AREA_LABELS.runtimeGroupName(areaName(input.records, node.key)),
    ref: areaRef(record, node.key),
  };
}

/** One pill's model, or null when the Area has no region on the canvas. */
function labelModel(input: AreaLabelsInput, node: AreaNode): AreaLabelModel | null {
  const region = input.regionRects.get(node.key);
  if (region === undefined) return null;
  const corner = toScreen(point("scene", region.x, region.y), input.camera);
  return {
    areaKey: node.key,
    name: areaName(input.records, node.key),
    accessibleName: accessibleAreaName(input.records, node, input.folded),
    at: labelPosition(region, input.camera),
    notes: labelNotes(node, input.folded, input.detailAreas),
    current: input.currentFindArea === node.key,
    runtime: runtimeRow(input, node, corner),
  };
}

/** The models of every Area that is in scope, not hidden by a fold, and drawn on the canvas, in world order. */
export function areaLabelModels(input: AreaLabelsInput): AreaLabelModel[] {
  const models: AreaLabelModel[] = [];
  for (const node of input.areas) {
    if (!input.scopedAreas.has(node.key) || hiddenByFold(node.key, input.folded)) continue;
    const model = labelModel(input, node);
    if (model !== null) models.push(model);
  }
  return models;
}
