// The typed shapes of the kernel's world: shards, regions, scenes, elements, the composition and
// the gesture solvers. The kernel under ../../public/ keeps these as plain JavaScript objects with
// raw numbers and strings. `kernel-boundary.ts` claims these types for them on the way in, so every
// pixel a Map module reads carries its frame and every id its brand. Nothing here exists at
// runtime; a `World` is exactly the JSON the server sent.

import type { ExcalidrawElement, ExcalidrawImageElement, ExcalidrawLinearElement, ExcalidrawTextElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { Brand } from "../units/brand.ts";
import type { Delta, Frame, PixelOf, Point, Rect } from "../units/frames.ts";
import type { AreaKey, ResizeHandle, RuntimeId, ShardOwner, SourceId } from "../units/ids.ts";
import type { Count, Index, ScenePx, Zoom } from "../units/units.ts";

export type { Camera } from "../units/frames.ts";

/** The stable id of one Area-map world, minted by the server and never compared by content. */
export type WorldId = Brand<string, "WorldId">;
/** The server's digest of every shard revision: the world revision a shard load and a save are checked against. */
export type WorldDigest = Brand<string, "WorldDigest">;
/** The server's digest of the Area tree alone. Unchanged by content edits. */
export type TreeDigest = Brand<string, "TreeDigest">;
/** The content hash of one stored shard, as the server acknowledged it. */
export type ShardHash = Brand<string, "ShardHash">;
/** The `parent>child` key of one Area region, minted by the kernel's `regionKey`. */
export type RegionKey = Brand<string, "RegionKey">;
/** The stable content signal of a set of elements; equal when nothing authored changed. */
export type AuthoredFingerprint = Brand<string, "AuthoredFingerprint">;
/** A pixel count of a bitmap or vector icon at its natural size. The platform's own type, not a frame. */
export type ImagePixels = HTMLImageElement["naturalWidth"];
/** An epoch timestamp as `Date` reports it. A moment, not a duration, so not `Milliseconds`. */
export type EpochMilliseconds = ReturnType<Date["getTime"]>;

/** The entity kinds a Tangent Block can carry. */
export type TangentEntityKind = "goal" | "document" | "area" | "link" | "brain" | "agent" | "person" | "request" | "commit" | "evidence" | "resource";
/** The structural roles the kernel gives non-Block elements. */
export type TangentRole = "boundary" | "region" | "area-region" | "endpoint-dot" | "shortcut";

/** The `customData.tangent` record: the semantic reference and the cached facts painted onto a Block. */
export type TangentMeta = {
  kind?: TangentEntityKind;
  ref?: string;
  role?: TangentRole;
  area?: AreaKey;
  title?: string;
  status?: string;
  kindId?: string;
  states?: string[];
  ghost?: boolean;
  success?: boolean;
  live?: boolean;
};

/** The `tangent` record of a connectable Block: an entity kind and a reference are both present. */
export type TangentBlockMeta = TangentMeta & { kind: TangentEntityKind; ref: string };

/** Where a composed element came from: the shard that owns it and its id inside that shard. */
export type ElementOrigin = {
  owner: ShardOwner;
  sourceId: SourceId;
  regionKey?: RegionKey;
};

/** One end of a cross-owner arrow, by the shard and source element it points at. */
export type WorldEndpoint = { owner: ShardOwner; sourceId: SourceId };

/** The marker on a disposable projection element: a figure icon, a success rail or an endpoint dot. */
export type EphemeralMarker = true | { kind: string; sourceId?: RuntimeId; icon?: string };

/** The presentation a figure projection overwrote, kept so a save can put it back. Offsets are from the Block. */
export type FigureMarker = { containerId?: RuntimeId | null; dx?: ScenePx; dy?: ScenePx; [field: string]: unknown };

/** Everything Tangent writes under an element's `customData`. */
export type TangentCustomData = {
  tangent?: TangentMeta;
  tangentWorld?: ElementOrigin;
  tangentWorldEphemeral?: EphemeralMarker;
  tangentWorldFigure?: FigureMarker;
  tangentWorldEndpoints?: { start?: WorldEndpoint; end?: WorldEndpoint };
  tangentWorldDeferredEndpoint?: boolean;
};

/** The element id of one frame: a composed element has a `RuntimeId`, a shard element a `SourceId`. */
export type ElementIdOf<F extends Frame> = F extends "scene" ? RuntimeId : F extends "source" ? SourceId : never;

/** One entry of `boundElements`: the label text or the arrow attached to an element. */
export type BoundElementRef<F extends Frame> = { id: ElementIdOf<F>; type: "text" | "arrow" };

/** An arrow end attached to an element, in Excalidraw's binding shape with a branded target id. */
export type ArrowBinding<F extends Frame> = Omit<NonNullable<ExcalidrawLinearElement["startBinding"]>, "elementId"> & { elementId: ElementIdOf<F> };

/**
 * An Excalidraw element as the Map reads it, branded by the frame its geometry lives in. Fields a
 * plain rectangle lacks are optional: text fields for a label, points and bindings for an arrow,
 * a file id for an image. Colours, angles, versions and seeds keep Excalidraw's own types.
 */
export type MapElement<F extends Frame> = {
  id: ElementIdOf<F>;
  type: ExcalidrawElement["type"];
  x: PixelOf<F>;
  y: PixelOf<F>;
  width: PixelOf<F>;
  height: PixelOf<F>;
  angle: ExcalidrawElement["angle"];
  strokeColor: string;
  backgroundColor: string;
  fillStyle: ExcalidrawElement["fillStyle"];
  strokeWidth: ExcalidrawElement["strokeWidth"];
  strokeStyle: ExcalidrawElement["strokeStyle"];
  roughness: ExcalidrawElement["roughness"];
  opacity: ExcalidrawElement["opacity"];
  groupIds: string[];
  frameId: ElementIdOf<F> | null;
  roundness: ExcalidrawElement["roundness"];
  seed: ExcalidrawElement["seed"];
  version: ExcalidrawElement["version"];
  versionNonce: ExcalidrawElement["versionNonce"];
  isDeleted: boolean;
  boundElements: BoundElementRef<F>[] | null;
  updated: ExcalidrawElement["updated"];
  link: string | null;
  locked: boolean;
  containerId?: ElementIdOf<F> | null;
  text?: string;
  fontSize?: ExcalidrawTextElement["fontSize"];
  fontFamily?: ExcalidrawTextElement["fontFamily"];
  textAlign?: ExcalidrawTextElement["textAlign"];
  verticalAlign?: ExcalidrawTextElement["verticalAlign"];
  points?: ExcalidrawLinearElement["points"];
  startBinding?: ArrowBinding<F> | null;
  endBinding?: ArrowBinding<F> | null;
  startArrowhead?: ExcalidrawLinearElement["startArrowhead"];
  endArrowhead?: ExcalidrawLinearElement["endArrowhead"];
  fileId?: ExcalidrawImageElement["fileId"] | null;
  status?: ExcalidrawImageElement["status"];
  customData?: TangentCustomData;
};

/** An element of the composed scene Excalidraw shows. */
export type SceneElement = MapElement<"scene">;
/** An element of one shard, as the vault stores it. */
export type SourceElement = MapElement<"source">;

/** The view fields a scene's `appState` may carry. Scroll and zoom are in the scene frame. */
export type SceneAppState = {
  theme?: AppState["theme"];
  viewBackgroundColor?: string;
  currentItemStrokeColor?: string;
  scrollX?: ScenePx;
  scrollY?: ScenePx;
  zoom?: { value: Zoom };
};

/** An Excalidraw scene file in one frame: the vault's shard shape and the composed world share it. */
export type MapScene<F extends Frame> = {
  type: "excalidraw";
  version: Count;
  source: string;
  elements: MapElement<F>[];
  appState?: SceneAppState;
  files?: BinaryFiles;
  tangent?: { format: Count };
};

/** One shard as the vault stores it. */
export type SourceScene = MapScene<"source">;
/** The one composed scene the kernel builds from every shard. */
export type ComposedScene = MapScene<"scene">;

/** Where one shard stands between the server descriptor and a loaded scene. */
export type ShardState = "ready" | "deferred" | "loading" | "load-error" | "missing" | "unreadable";

/** The legacy content a shard still carries, reported so the migration notice can name it. */
export type ShardMigration = { legacyBoundaries?: Count; legacyCards?: Count };

/** One Area's Map file: its identity, its state, its hulls, and its scene once loaded. */
export type Shard = {
  owner: ShardOwner;
  file?: string | null;
  hash: ShardHash | null;
  revision: ShardHash | null;
  state: ShardState;
  elementCount: Count;
  blockCount: Count;
  ownBlockHull: Rect<"source"> | null;
  ownInkHull: Rect<"source"> | null;
  scene?: SourceScene | null;
  errors?: string[];
  migration?: ShardMigration;
};

/** The persisted placement record of one region: its branch priority and the siblings it may overlap. */
export type PlacementLayout = {
  schema: "area-placement.v1";
  priority: Count;
  overlapWith: AreaKey[];
};

/** One child Area's rectangle inside its parent's shard, in the parent's source frame. */
export type Region = {
  key: RegionKey;
  owner: ShardOwner;
  child: AreaKey;
  sourceId: SourceId;
  labelSourceId: SourceId;
  source: "stored" | "provisional";
  storedRect: Rect<"source">;
  layout?: PlacementLayout | null;
};

/** One Area in the world tree with its region and its shard. */
export type AreaNode = {
  key: AreaKey;
  parent: ShardOwner;
  children: AreaKey[];
  depth: Count;
  region: Region;
  shard: Shard;
};

/** The private view the server or local storage kept for one world. */
export type StoredView = {
  schema: string;
  pan?: Point<"scene">;
  zoom?: Zoom;
  foldedAreas?: AreaKey[];
  detailAreas?: AreaKey[];
  locatedArea?: AreaKey;
  cameraTarget?: AreaKey;
  cameraTrail?: AreaKey[];
  restrictionArea?: AreaKey | null;
  selection?: RuntimeId[];
};

/** The complete Area-map world the server serves and the controller holds as authority. */
export type World = {
  schema: "area-map-world.v1";
  worldId: WorldId;
  treeRevision: TreeDigest;
  worldRevision: WorldDigest;
  locatedArea: AreaKey;
  rootShard: Shard;
  areas: AreaNode[];
  view?: StoredView | null;
};

/**
 * The rectangles the layout kernel solved for one Area, all in its parent's source frame. `stored`
 * is the authored rectangle, `resolvedStored` where the solver put it, `constraint` the smallest
 * box that holds its content, `drawn` the box the region element is drawn at. The kernel shapes
 * `layoutOffset` as a point although it is the displacement from `stored` to `resolvedStored`.
 */
export type AreaGeometry = {
  stored: Rect<"source">;
  resolvedStored: Rect<"source">;
  layoutOffset: Point<"source">;
  branchPriority: Count;
  required: Rect<"source"> | null;
  drawnRequired: Rect<"source"> | null;
  constraint: Rect<"source">;
  drawn: Rect<"source">;
};

/** The origin record the composition keeps per composed element, with the source copy it was made from. */
export type ComposedOrigin = ElementOrigin & {
  identity?: unknown;
  source?: SourceElement;
  sourceIndex?: Index;
  retainedResource?: boolean;
};

/** Everything `composeAreaMapWorld` returns: the scene and the tables that map it back to shards. */
export type Composition = {
  scene: ComposedScene;
  origins: Map<RuntimeId, ComposedOrigin>;
  offsets: Map<AreaKey, Point<"scene">>;
  regions: Map<AreaKey, Region>;
  geometry: Map<AreaKey, AreaGeometry>;
  regionRects: Map<AreaKey, Rect<"scene">>;
  storedRegionRects: Map<AreaKey, Rect<"scene">>;
};

/** The block and ink hulls of one shard, in its own source frame. */
export type ShardHulls = { blocks: Rect<"source"> | null; ink: Rect<"source"> | null };

/** The immutable inputs both gesture solvers read: taken once at pointer down, never from a preview. */
export type GestureBaseline = {
  areas: AreaKey[];
  regions: Map<AreaKey, Region>;
  blockHulls: Map<AreaKey, Rect<"source">>;
  inkHulls: Map<AreaKey, Rect<"source">>;
};

/** A move or resize of selected Areas by a world displacement. A null handle is a move. */
export type AreaGestureIntent = {
  selectedAreas: readonly AreaKey[];
  handle: ResizeHandle | null;
  desiredWorldDelta: Delta<"scene">;
};

/** What the Area solver produced: the regions to install, the geometry they imply, and whether every rectangle stayed finite. */
export type AreaGestureResult = {
  regions: Map<AreaKey, Region>;
  geometry: Map<AreaKey, AreaGeometry>;
  changedAreas: Set<AreaKey>;
  appliedDelta: Delta<"scene">;
  valid: boolean;
};

/** A move of Blocks or free ink inside one owning shard. `rect` is the moved group's hull in the owner's source frame. */
export type OwnedElementIntent = {
  owner: ShardOwner;
  kind: "block" | "ink";
  rect: Rect<"source">;
  remainingBlockHull: Rect<"source"> | null;
  desiredWorldDelta: Delta<"scene">;
};

/** What the owned-element solver produced. Ink has no geometry to solve, so `geometry` is null for it. */
export type OwnedElementResult = {
  rect: Rect<"source">;
  geometry: Map<AreaKey, AreaGeometry> | null;
  appliedDelta: Delta<"scene">;
  valid: boolean;
};

/** What Excalidraw's pointer-down state means structurally: a move, a resize from a named handle, or nothing the Map acts on. */
export type PointerCommand =
  | { kind: "move"; handle: null }
  | { kind: "resize"; handle: ResizeHandle }
  | { kind: "ignore"; handle: string | null };

/** The presentation a Block is drawn with when it should not look like a settled one, such as the placement preview. */
export type BlockStyle = {
  opacity?: ExcalidrawElement["opacity"];
  strokeStyle?: ExcalidrawElement["strokeStyle"];
};

/** A Block the picker or a paste chose to place. */
export type BlockChoice = {
  kind: TangentEntityKind;
  ref: string;
  title: string;
  status?: string;
  area?: AreaKey;
  directChild?: boolean;
  style?: BlockStyle;
};

/** The scene after a Block was added and the root element it added, or null when nothing was placed. */
export type PlacedBlock = { scene: SourceScene; root: SourceElement | null };

/** The kernel's named layout numbers, in the source frame the layout kernel works in. */
export type AreaMapLayout = {
  readonly spacing: PixelOf<"source">;
  readonly labelBand: PixelOf<"source">;
  readonly minimumWidth: PixelOf<"source">;
  readonly minimumHeight: PixelOf<"source">;
  readonly placementSchema: "area-placement.v1";
};

/** One published runtime count as the shell writes it: a count, a list whose length is the count, or a record carrying one. */
export type RuntimeFactCount = Count | readonly unknown[] | { count?: RuntimeFactCount } | null;

/** The runtime facts the shell publishes on an Area document: who is working, what waits for Julian, the problems, and whether the facts are fresh. */
export type AreaRuntimeFacts = {
  working?: RuntimeFactCount;
  forYou?: RuntimeFactCount;
  problems?: RuntimeFactCount;
  ready?: boolean;
  stale?: boolean;
};

/** One record of the vault index the Map paints facts from and the picker chooses from. */
export type VaultDocument = {
  file: string;
  area?: AreaKey;
  kind?: string;
  title?: string;
  name?: string;
  status?: string;
  goal?: boolean;
  verify?: boolean;
  live?: boolean;
  sessionState?: string;
  stale?: boolean;
  olderThanNotes?: boolean;
  runtime?: AreaRuntimeFacts | null;
};
