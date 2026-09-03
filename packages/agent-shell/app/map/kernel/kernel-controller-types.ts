// The typed shape of the world controller: its snapshot, the save and draft states it publishes,
// the options it is created with, and every method the Map calls on it. The controller under
// ../../public/area-map-world-controller.js is the one browser authority for a composed world
// (ADR-0051); the Map reads it only through these types and `kernel-boundary.ts`.

import type { Camera } from "../units/frames.ts";
import type { AreaKey, RuntimeId, ShardOwner, WorldRevision } from "../units/ids.ts";
import type { Count } from "../units/units.ts";
import type { MapKindsCatalog, ResourceResolution, ResourceSourceUpdate } from "./kernel-facts-types.ts";
import type { AuthoredFingerprint, ComposedScene, Composition, EpochMilliseconds, SceneElement, Shard, ShardHash, ShardState, StoredView, TreeDigest, VaultDocument, World, WorldDigest, WorldId } from "./kernel-world-types.ts";

/** The composed-scene elements Excalidraw currently holds selected. */
export type Selection = ReadonlySet<RuntimeId>;

/** The Work Focus switches the Map masks Blocks by. */
export type Focus = { only?: boolean; areas?: AreaKey[]; activeOnly?: boolean };

/** Where the last save stands. `blocked` waits for Retry; `conflict` waits for Reload or Keep mine. */
export type SaveStatus = "saved" | "dirty" | "saving" | "blocked" | "conflict";

/** What the server answered to one save, or the failure that stood in for an answer. */
export type SaveResult = {
  status: Response["status"];
  error?: string;
  code?: string;
  retryable?: boolean;
  idempotent?: boolean;
  conflict?: boolean;
  cancelled?: boolean;
  draft?: boolean;
  retained?: boolean;
  operationId?: string;
  gestureId?: string;
  worldId?: WorldId;
  treeRevision?: TreeDigest;
  worldRevision?: WorldDigest;
  hashes?: Record<string, ShardHash | null>;
};

/** The save state the snapshot carries. */
export type SaveState = { state: SaveStatus; result: SaveResult | null };

/** The private recovery record the controller keeps after a failed save. */
export type DraftRecord = {
  schema: "area-map-draft.v1";
  worldId: WorldId;
  worldRevision: WorldDigest;
  savedAt: string;
  locatedArea: AreaKey;
  world: World;
  pending: unknown[];
  history: { undo: unknown[]; redo: unknown[] };
  baseHashes: Record<string, ShardHash | null>;
  owners: ShardOwner[];
  status: Response["status"];
  failure: SaveResult;
  restored?: boolean;
};

/** One immutable controller snapshot: world authority, the projection, the private view, and the save state. */
export type Snapshot = {
  readonly reason: string;
  readonly revision: WorldRevision;
  readonly factsRevision: Count;
  readonly world: World;
  readonly composition: Composition;
  readonly scene: ComposedScene;
  readonly hiddenIds: ReadonlySet<RuntimeId>;
  readonly mapKinds: MapKindsCatalog | null;
  readonly focus: Focus;
  readonly folded: ReadonlySet<AreaKey>;
  readonly manualFolded: ReadonlySet<AreaKey>;
  readonly restrictionArea: AreaKey | null;
  readonly scopedAreas: ReadonlySet<AreaKey>;
  readonly findRevealId: RuntimeId | null;
  readonly detailAreas: ReadonlySet<AreaKey>;
  readonly camera: Camera;
  readonly locatedArea: AreaKey;
  readonly cameraTarget: AreaKey | null;
  readonly cameraTrail: readonly AreaKey[];
  readonly viewRestored: boolean;
  readonly selection: Selection;
  readonly save: SaveState;
  readonly draft: DraftRecord | null;
  readonly dirtyOwners: ReadonlySet<ShardOwner>;
  readonly nextEscape: string;
};

/** What a gesture is: the word the history records for one command. */
export type GestureKind = "pointer" | "text" | "edit" | string;

/** The Areas and shard owners one preview or commit changed. */
export type GestureChanges = { changedAreas?: Iterable<AreaKey>; changedOwners?: Iterable<ShardOwner> };

/** One history command the controller queued for saving. Its states are opaque to the Map. */
export type WorldCommand = { id: string; kind: GestureKind };

/** Which state of a command a save writes. */
export type CommandDirection = "before" | "after";

/** The private view captured for an exact temporary return, such as Show on Map. */
export type CapturedView = {
  camera: Camera;
  locatedArea: AreaKey;
  cameraTarget: AreaKey | null;
  cameraTrail: AreaKey[];
  restrictionArea: AreaKey | null;
  selection: RuntimeId[];
  findRevealId: RuntimeId | null;
};

/** What Escape did: cleared the selection, stepped the camera back, or left for Work. */
export type EscapeOutcome =
  | { kind: "selection" }
  | { kind: "camera"; area: AreaKey; element: SceneElement | null }
  | { kind: "work" };

/** The Only restriction after a change, with how many Areas it takes off the canvas. */
export type RestrictionOutcome = {
  active: boolean;
  area: AreaKey | null;
  excludedCount: Count;
  element?: SceneElement | null;
};

/** What the controller tells the host when the located Area or the trail changes. */
export type NavigationNotice = { area: AreaKey; trail: AreaKey[]; nextEscape: string };

/** One coordinate-free diagnostic event the controller emits. */
export type ControllerEvent = { name: string; at: EpochMilliseconds; [field: string]: unknown };

/** Options for a camera fit or navigation: push the current target onto the trail, select the region. */
export type FitOptions = { push?: boolean; select?: boolean };

/** How far a deferred-load plan reaches around the selected Area. */
export type LoadPlanOptions = { includeDescendants?: boolean; nearbyCount?: Count; requireSelectedDeferred?: boolean };

/** What the shard route answers: the loaded shard fields checked against the requested world revision. */
export type ShardLoadResult = Partial<Shard> & { worldRevision?: WorldDigest; state?: ShardState; error?: string };

/** The store the controller keeps its recovery draft in. */
export type DraftStore = {
  load: (worldId: WorldId) => Promise<DraftRecord | null> | DraftRecord | null;
  save: (record: DraftRecord) => Promise<unknown> | unknown;
  clear?: (worldId: WorldId) => Promise<unknown> | unknown;
  close?: () => Promise<unknown> | unknown;
};

/** Everything `createAreaMapWorldController` accepts. Only `world` is required. */
export type ControllerOptions = {
  world: World;
  getDocuments?: () => VaultDocument[];
  focus?: Focus;
  loadShard?: (area: AreaKey, context: { locatedArea: AreaKey; worldRevision: WorldDigest }) => Promise<ShardLoadResult>;
  reloadWorld?: (request: { locatedArea: AreaKey; owners: ShardOwner[] }) => Promise<World>;
  persistWorld?: (world: World, changedAreas: Set<AreaKey>, changedOwners: Set<ShardOwner>, command: WorldCommand, direction: CommandDirection) => Promise<SaveResult> | SaveResult;
  persistView?: (view: StoredView) => unknown;
  draftStore?: DraftStore | null;
  onBack?: () => void;
  onNavigation?: (notice: NavigationNotice) => void;
  onEvent?: (event: ControllerEvent) => void;
  storage?: Storage | null;
};

/**
 * The world controller as the Map calls it. Every method here is one the old component called or
 * the controller exposes beside them; the boundary hands back this shape from
 * `createAreaMapWorldController`. Methods are function-typed properties, not method signatures,
 * so an implementation cannot widen a parameter.
 */
export type AreaMapController = {
  readonly subscribe: (listener: (snapshot: Snapshot) => void) => () => void;
  readonly snapshot: (reason?: string) => Snapshot;
  readonly world: () => World;
  readonly composition: () => Composition;
  readonly beginGesture: (kind?: GestureKind) => World;
  readonly preview: (world: World, changes?: GestureChanges) => void;
  readonly endGesture: (kind?: GestureKind) => WorldCommand | null;
  readonly commitWorld: (world: World, changes?: GestureChanges, kind?: GestureKind) => WorldCommand | World;
  readonly undo: () => boolean;
  readonly redo: () => boolean;
  readonly selectArea: (area: AreaKey) => SceneElement | null;
  readonly setSelection: (ids: Iterable<RuntimeId>) => void;
  readonly setFindReveal: (id: RuntimeId | null) => boolean;
  readonly fitArea: (area: AreaKey, options?: FitOptions) => SceneElement | null;
  readonly navigateArea: (area: AreaKey, options?: FitOptions) => SceneElement | null;
  readonly setRestriction: (area: AreaKey | null) => RestrictionOutcome;
  readonly toggleRestriction: (area?: AreaKey) => RestrictionOutcome;
  readonly escape: () => EscapeOutcome;
  readonly toggleFold: (area: AreaKey) => boolean | null;
  readonly setFocus: (focus: Focus | null) => void;
  readonly setCamera: (camera: Partial<Camera>) => void;
  readonly captureView: () => CapturedView;
  readonly restoreView: (view: Partial<CapturedView>) => Snapshot;
  readonly materialize: (area: AreaKey) => Promise<Shard | null>;
  readonly prioritizeLoads: (area: AreaKey, options?: LoadPlanOptions) => Promise<(Shard | null)[]>;
  readonly refreshFacts: (focus?: Focus) => Promise<boolean>;
  readonly setMapKinds: (catalog: MapKindsCatalog | null) => boolean;
  readonly setResourceResolutions: (values: ResourceResolution[], options?: { replace?: boolean }) => boolean;
  readonly installResourceSourceUpdates: (updates: ResourceSourceUpdate[]) => boolean;
  readonly flush: () => Promise<SaveResult | null>;
  readonly retry: () => Promise<SaveResult | null>;
  readonly reload: (world?: World | null) => Promise<World>;
  readonly keepMine: () => Promise<SaveResult | null>;
  readonly restoreDraft: () => boolean;
  readonly discardDraft: () => void;
  readonly recordEvent: (name: string, fields?: Record<string, unknown>) => void;
  readonly destroy: () => void;
};

/** What the projection fence compares: the fingerprint it last applied, what Excalidraw holds selected, and what the controller wants shown. */
export type ProjectionUpdateInput = {
  appliedFingerprint: AuthoredFingerprint | null;
  currentSelection: Iterable<RuntimeId>;
  scene: ComposedScene | null;
  selection: Iterable<RuntimeId>;
};

/** The exact change to push into Excalidraw, or null when the poll is a no-op. */
export type ProjectionUpdate = {
  fingerprint: AuthoredFingerprint;
  sceneChanged: boolean;
  selectedElementIds: Record<RuntimeId, true>;
};
