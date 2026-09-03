// The one door between the Map and the untyped kernel under ../../public/. Every kernel function
// the Map relies on is re-exported here with the signature from `kernel-types.ts`. The kernel keeps
// raw numbers and strings; the brands are compile-time only, so claiming a signature costs nothing
// at runtime and every pixel that leaves here carries its frame and every id its brand. The two
// gesture solvers are the one place a runtime conversion happens: the kernel reads a displacement
// as `{ x, y }` and the Map as `Delta<"scene">`. A lint keeps `../../public/` imports to this
// directory; no other Map module may reach past this file. The kernel is never edited for this.

import type { FileId } from "@excalidraw/excalidraw/element/types";
import type { AppState, PointerDownState } from "@excalidraw/excalidraw/types";
import * as boardCore from "../../public/area-board-core.js";
import * as picker from "../../public/area-board-picker.js";
import * as entities from "../../public/area-map-entities.js";
import * as figures from "../../public/area-map-figures.js";
import * as findCore from "../../public/area-map-find-core.js";
import * as controllerModule from "../../public/area-map-world-controller.js";
import * as worldCore from "../../public/area-map-world-core.js";
import * as keyboard from "../../public/keyboard-context.js";
import { delta } from "../units/frames.ts";
import type { Delta, Frame, PixelOf, Point, Rect } from "../units/frames.ts";
import type { AreaKey, ResourceId, RuntimeId, ShardOwner, SourceId } from "../units/ids.ts";
import type { Count, ScenePx } from "../units/units.ts";
import type {
  AreaGeometry, AreaGestureIntent, AreaGestureResult, AreaMapController, AreaMapLayout, AuthoredFingerprint, BlockChoice, ComposedOrigin,
  ComposingKeyboardEvent, Composition, ControllerOptions, FigureIconFile, FindAreaInput, FindBlockInput, FindRow, GestureBaseline, KeyboardContext,
  KeyboardContextFacts, LoadPlanOptions, MapElement, MapEntityAction, MapEntityActionResult, MapEntityEffects, MapEntityFacts, MapIcon,
  OwnedElementIntent, OwnedElementResult, PickerChoice, PickerSceneFacts, PickerSection, PickerTargetFacts, PlacedBlock, PointerCommand,
  ProjectionUpdate, ProjectionUpdateInput, Region, RegionKey, ResolveMapEntityInput, ResourceLocator, ResourceLocatorKey, SceneAppState, SceneElement, Selection,
  ShardHulls, SourceElement, SourceScene, TangentBlockMeta, TangentMeta, VaultDocument, VaultIndexItem, World,
} from "./kernel-types.ts";

/** A displacement in the shape the kernel's solvers read and return. */
type SolverDelta = { x: ScenePx; y: ScenePx };
/** The Area solver's intent with the kernel's displacement shape. */
type RawAreaIntent = Omit<AreaGestureIntent, "desiredWorldDelta"> & { desiredWorldDelta: SolverDelta };
/** The Area solver's result with the kernel's displacement shape. */
type RawAreaResult = Omit<AreaGestureResult, "appliedDelta"> & { appliedDelta: SolverDelta };
/** The owned-element solver's intent with the kernel's displacement shape. */
type RawOwnedIntent = Omit<OwnedElementIntent, "desiredWorldDelta"> & { desiredWorldDelta: SolverDelta };
/** The owned-element solver's result: ink comes back with no geometry and no applied displacement. */
type RawOwnedResult = { rect: Rect<"source">; geometry?: Map<AreaKey, AreaGeometry>; appliedDelta?: SolverDelta; valid: boolean };
/** The owners a new element may be claimed for, in the kernel's precedence order. */
type OwnerCandidates = { copiedOwner?: ShardOwner | null; pasteOwner?: ShardOwner | null; startOwner?: ShardOwner | null; pointOwner?: ShardOwner | null };
/** The selection shapes `selectedMapEntityElement` accepts: the controller's set, a list, or Excalidraw's map. */
type SelectedIds = Selection | readonly RuntimeId[] | Readonly<Record<string, boolean>>;
/** The appState fields `insertionPoint` reads to find the viewport centre. */
type InsertionAppState = Partial<Pick<AppState, "zoom" | "scrollX" | "scrollY" | "width" | "height">>;

/** Claims one typed signature for a kernel export. The kernel is untyped JavaScript, so the claim is made once here and nowhere else. */
function typed<T>(value: unknown): T {
  return value as T;
}

/** Converts a scene displacement into the `{ x, y }` shape the solvers read. */
function solverDelta(value: Delta<"scene">): SolverDelta {
  return { x: value.dx, y: value.dy };
}

/** Reads a solver's `{ x, y }` displacement back as a scene delta, or the requested one when the solver reported none. */
function sceneDelta(value: SolverDelta | undefined, requested: Delta<"scene">): Delta<"scene"> {
  return value ? delta("scene", value.x, value.y) : requested;
}

/** Creates the one browser authority for a composed Area-map world (ADR-0051). */
export const createAreaMapWorldController = typed<(options: ControllerOptions) => AreaMapController>(controllerModule.createAreaMapWorldController);
/** Converts Excalidraw's pointer-down state into a structural command: move, resize from a handle, or ignore. */
export const areaMapPointerCommand = typed<(pointerDownState: PointerDownState | null | undefined) => PointerCommand>(controllerModule.areaMapPointerCommand);
/** Returns the exact Excalidraw projection change, or null when the poll is a no-op. */
export const areaMapProjectionUpdate = typed<(input: ProjectionUpdateInput) => ProjectionUpdate | null>(controllerModule.areaMapProjectionUpdate);
/** Returns the selected region elements a keyboard nudge moved. Only that command may change region geometry through Excalidraw. */
export const selectedAreaMapRegionChanges = typed<(elements: readonly SceneElement[], selectedIds: Iterable<RuntimeId>, regionRects: Map<AreaKey, Rect<"scene">>, options?: { geometryCommand?: "keyboard-nudge" | null }) => SceneElement[]>(controllerModule.selectedAreaMapRegionChanges);
/** Selects the shard a new element belongs to: paste target, then copied owner, then the gesture's start, then the Area under the point. */
export const ownerForNewAreaMapElement = typed<(candidates: OwnerCandidates) => ShardOwner | null>(controllerModule.ownerForNewAreaMapElement);
/** Reports whether a Block hull moved enough to change Area layout. */
export const areaMapStructuralHullChanged = typed<(before: Rect<"source"> | null | undefined, after: Rect<"source"> | null | undefined) => boolean>(controllerModule.areaMapStructuralHullChanged);
/** Plans deferred shard loads: the selected Area, its located descendants, then the nearest others. */
export const areaMapDeferredLoadPlan = typed<(world: World, composition: Composition, area: AreaKey, options?: LoadPlanOptions) => AreaKey[]>(controllerModule.areaMapDeferredLoadPlan);

/** The kernel's named layout numbers (ADR-0052). */
export const AREA_MAP_LAYOUT = typed<AreaMapLayout>(worldCore.AREA_MAP_LAYOUT);
/** Composes every shard into the one scene Excalidraw shows, with the tables that map it back. */
export const composeAreaMapWorld = typed<(world: World) => Composition>(worldCore.composeAreaMapWorld);
/** The kernel's Area solver with the kernel's displacement shape; wrapped below. */
const rawSolveAreaMapGesture = typed<(baseline: GestureBaseline, intent: RawAreaIntent) => RawAreaResult>(worldCore.solveAreaMapGesture);
/** The kernel's owned-element solver with the kernel's displacement shape; wrapped below. */
const rawSolveOwnedElementGesture = typed<(baseline: GestureBaseline, intent: RawOwnedIntent) => RawOwnedResult>(worldCore.solveOwnedElementGesture);
/** Returns the nearest free position on one cardinal axis for a rectangle among occupied ones, keeping its size. */
export const nearestFreeRectangle = typed<<F extends Frame>(preferred: Rect<F>, occupied?: readonly Rect<F>[], options?: { gap?: PixelOf<F> }) => Rect<F>>(worldCore.nearestFreeRectangle);
/** Adds a Block at the nearest free point of a shard through the shared collision pipeline. */
export const placeBlockAtNearestFreePoint = typed<(scene: SourceScene, choice: BlockChoice, point: Point<"source">, id: SourceId, options?: { occupied?: readonly SourceElement[] }) => PlacedBlock>(worldCore.placeBlockAtNearestFreePoint);
/** Adds a Block from the centre of a shard's current content bounds. */
export const placeBlockInSourceScene = typed<(scene: SourceScene, choice: BlockChoice, id: SourceId) => PlacedBlock>(worldCore.placeBlockInSourceScene);
/** Splits composed elements back into exact per-owner source elements. */
export const splitComposed = typed<(elements: readonly SceneElement[], origins: Map<RuntimeId, ComposedOrigin>, offsets?: Map<AreaKey, Point<"scene">>) => Map<ShardOwner, SourceElement[]>>(worldCore.splitComposed);
/** Returns the smallest rectangle containing every finite input, or null when there is none. */
export const unionRects = typed<<F extends Frame>(values: readonly (Rect<F> | null | undefined)[]) => Rect<F> | null>(worldCore.unionRects);
/** Grows a rectangle on every side, by the kernel's content margin when no amount is given. Null stays null. */
export const inflateRect = typed<<F extends Frame>(value: Rect<F> | null | undefined, amount?: PixelOf<F>) => Rect<F> | null>(worldCore.inflateRect);
/** Mints the composed-scene id of one source element. */
export const runtimeId = typed<(owner: ShardOwner, sourceId: SourceId) => RuntimeId>(worldCore.runtimeId);
/** Mints the stable source id of one Area region. */
export const regionId = typed<(parent: ShardOwner, child: AreaKey) => SourceId>(worldCore.regionId);
/** Mints the stable key of one parent-child edge. */
export const regionKey = typed<(parent: ShardOwner, child: AreaKey) => RegionKey>(worldCore.regionKey);
/** Returns the Block and ink hulls of one shard. */
export const shardHulls = typed<(scene: SourceScene | null | undefined) => ShardHulls>(worldCore.shardHulls);
/** Drops text bindings that would cross shard owners after a move. Returns how many it detached. */
export const detachCrossOwnerTextBindings = typed<(elements: SceneElement[], origins: Map<RuntimeId, ComposedOrigin>) => Count>(worldCore.detachCrossOwnerTextBindings);
/** Authors an Area's resolved anchor before raising its branch priority. */
export const reprioritizeAreaPlacement = typed<(region: Region, resolvedStored: Rect<"source"> | null | undefined, priority: Count) => Region>(worldCore.reprioritizeAreaPlacement);
/** Restores tree-derived regions an Excalidraw delete removed. */
export const protectAreaRegions = typed<(canonical: readonly SceneElement[], changed: readonly SceneElement[]) => SceneElement[]>(worldCore.protectAreaRegions);
/** Returns a shard's current content bounds under the same minimum and growth rules as the world solver. */
export const sourceAreaContentBounds = typed<(scene: SourceScene | null | undefined) => Rect<"source">>(worldCore.sourceAreaContentBounds);

/** Solves a move or resize of selected Areas from the immutable pointer-down baseline. */
export function solveAreaMapGesture(baseline: GestureBaseline, intent: AreaGestureIntent): AreaGestureResult {
  const solved = rawSolveAreaMapGesture(baseline, { ...intent, desiredWorldDelta: solverDelta(intent.desiredWorldDelta) });
  return { ...solved, appliedDelta: sceneDelta(solved.appliedDelta, intent.desiredWorldDelta) };
}

/** Solves a Block or free-ink move inside one owning shard. Ink is applied in full and has no geometry. */
export function solveOwnedElementGesture(baseline: GestureBaseline, intent: OwnedElementIntent): OwnedElementResult {
  const solved = rawSolveOwnedElementGesture(baseline, { ...intent, desiredWorldDelta: solverDelta(intent.desiredWorldDelta) });
  return { rect: solved.rect, geometry: solved.geometry ?? null, appliedDelta: sceneDelta(solved.appliedDelta, intent.desiredWorldDelta), valid: solved.valid };
}

/** Returns the Area a Block belongs to, or an empty string for an element that is not a Block. */
export const areaForBlock = typed<(element: MapElement<Frame> | null | undefined, documents?: readonly VaultDocument[], sourceOwner?: ShardOwner | { owner: ShardOwner } | null) => AreaKey | "">(boardCore.areaForBlock);
/** Returns a content signal that view and selection changes do not affect. */
export const authoredFingerprint = typed<(elements: readonly MapElement<Frame>[] | null | undefined) => AuthoredFingerprint>(boardCore.authoredFingerprint);
/** Creates an empty shard scene with no persisted viewport. */
export const createEmptyScene = typed<() => SourceScene>(boardCore.createEmptyScene);
/** Returns the Area-scoped choices for the Block picker. */
export const entityChoices = typed<(area: AreaKey, documents?: readonly VaultDocument[]) => BlockChoice[]>(boardCore.entityChoices);
/** Returns the scene point under the last pointer, or the viewport centre. */
export const insertionPoint = typed<(appState: InsertionAppState, pointer?: Point<"scene"> | null) => Point<"scene">>(boardCore.insertionPoint);
/** Reports whether an element is the boundary owned by its Area file. */
export const isAreaBoundary = typed<(element: MapElement<Frame> | null | undefined) => boolean>(boardCore.isAreaBoundary);
/** Reports whether an element is a direct-child Area region inside a shard. */
export const isAreaRegion = typed<(element: MapElement<Frame> | null | undefined) => boolean>(boardCore.isAreaRegion);
/** Finds a Block reference in pasted or picker text. Plain prose returns null. */
export const referenceFromText = typed<(text: string | null | undefined, choices?: readonly BlockChoice[]) => BlockChoice | null>(boardCore.referenceFromText);
/** Hides or restores a Block and its bound text without deleting other ink. */
export const setBlockHidden = typed<(scene: SourceScene, blockId: SourceId, hidden: boolean) => SourceScene>(boardCore.setBlockHidden);
/** Returns one shard scene ready to save: the elements without selection, scroll or zoom state. */
export const sceneForSave = typed<(elements: readonly MapElement<Frame>[], appState?: Partial<SceneAppState> | Readonly<AppState>) => SourceScene>(boardCore.sceneForSave);
/** Returns the Tangent metadata of a connectable Block, or null for structure and ink. */
export const tangentOf = typed<(element: MapElement<Frame> | null | undefined) => TangentBlockMeta | null>(boardCore.tangentOf);

/** Converts persisted metadata and live facts into the one browser entity model. */
export const resolveMapEntity = typed<(input: ResolveMapEntityInput) => MapEntityFacts | null>(entities.resolveMapEntity);
/** Joins a Resource locator into its one runtime key, or null for an unsafe locator. */
export const resourceLocatorKey = typed<(locator: ResourceLocator | null | undefined) => ResourceLocatorKey | null>(entities.resourceLocatorKey);
/** Runs one browser effect for an action and reports what happened. */
export const runMapEntityAction = typed<(action: MapEntityAction | null | undefined, effects?: MapEntityEffects) => Promise<MapEntityActionResult>>(entities.runMapEntityAction);
/** Returns the semantic Block only when it is the whole live selection. */
export const selectedMapEntityElement = typed<(elements: readonly SceneElement[], selected: SelectedIds) => SceneElement | null>(entities.selectedMapEntityElement);
/** Reports whether an element is a semantic Block rather than world structure. */
export const isMapEntityBlock = typed<(element: MapElement<Frame> | null | undefined) => boolean>(entities.isMapEntityBlock);
/** Returns a Resource locator only when the owner and the persisted id agree. */
export const mapEntityLocator = typed<(source: { owner: ShardOwner } | null | undefined, tangent: TangentMeta | null | undefined) => ResourceLocator | null>(entities.mapEntityLocator);
/** Reports whether a value is safe as a catalog-local opaque Resource id. */
export const isSafeResourceId = typed<(value: unknown) => value is ResourceId>(entities.isSafeResourceId);

/** Returns the image files the figure icons in one projection need registered with Excalidraw. */
export const figureIconFiles = typed<(elements: readonly SceneElement[], icons: Readonly<Record<string, MapIcon>>, created: FigureIconFile["created"]) => FigureIconFile[]>(figures.figureIconFiles);
/** Puts back the presentation a figure projection overwrote so a save never stores it. */
export const restoreFigurePresentation = typed<(elements: readonly SceneElement[]) => SceneElement[]>(figures.restoreFigurePresentation);
/** Returns the colour to store so the Map's dark-theme filter renders the drawn colour. */
export const themeInkColor = typed<(value: string) => string>(figures.themeInkColor);
/** Returns the Excalidraw file id one image icon's bytes are registered under. */
export const figureIconFileId = typed<(iconName: string, contentHash: string) => FileId>(figures.figureIconFileId);

/** Returns every matching Area before every matching loaded Block. */
export const mapFindMatches = typed<(input: { areas?: readonly FindAreaInput[]; blocks?: readonly FindBlockInput[] }, query: string) => FindRow[]>(findCore.mapFindMatches);
/** Reports whether a query starts the words of a name, including names typed without separators. */
export const mapFindTextMatches = typed<(value: string, query: string) => boolean>(findCore.mapFindTextMatches);
/** Reports whether an Area is the Only target, its ancestor, or its descendant. */
export const areaInRestriction = typed<(area: AreaKey | null | undefined, target: AreaKey | null | undefined) => boolean>(findCore.areaInRestriction);

/** Builds the contextual picker sections for one exact Area. */
export const pickerSections = typed<(target: AreaKey, index?: readonly VaultIndexItem[], targetFacts?: PickerTargetFacts, sceneFacts?: PickerSceneFacts) => PickerSection[]>(picker.pickerSections);
/** Filters contextual sections without changing their order. */
export const filterChoices = typed<(sections: readonly PickerSection[], query?: string) => PickerSection[]>(picker.filterChoices);
/** Searches the whole vault, with an optional path-prefix query. */
export const wideChoices = typed<(query?: string, index?: readonly VaultIndexItem[]) => PickerChoice[]>(picker.wideChoices);

/** Resolves the one visible surface that owns a keyboard event from facts, not DOM nodes. */
export const resolveKeyboardContext = typed<(facts?: KeyboardContextFacts) => KeyboardContext>(keyboard.resolveKeyboardContext);
/** Reports whether a key belongs to an IME or an unfinished composition. */
export const keyboardEventIsComposing = typed<(event: ComposingKeyboardEvent | null | undefined) => boolean>(keyboard.keyboardEventIsComposing);
