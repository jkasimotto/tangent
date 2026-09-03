// One pointer gesture, from the press to the settled history word.
//
// The old component carried a gesture in twenty refs: the baseline world, the solver baseline, the
// baseline composition, the pointer-down state, the current point, the resize handle, the selected
// ids, the settling flag, the settle token, the settle waiters and the claimed identities, each
// read and cleared from a different callback. A gesture that ended in an unexpected order left one
// of them set, and the next press inherited it. Here they are the named fields of one object whose
// life is exactly the life of the gesture: `begin` fills them, `preview` reads them, `settle`
// clears them, and there is no other way to change them.
//
// The class solves nothing itself. `preview` hands the kernel's Area solver the immutable baseline
// taken at the press and the displacement from the press point, for the two meanings the kernel
// owns, and returns the scene the projection must paint. Every other meaning previews as null,
// because Excalidraw is already drawing it.
//
// The controller, the publish callback and the frame scheduler are injected, so a test drives a
// whole gesture, including the double-animation-frame settle, under Node with no React and no
// Excalidraw.
//
// Design: docs/design/area-map-rebuild/code.md, "Pointer authority".

import { composeAreaMapWorld, shardHulls, solveAreaMapGesture } from "../kernel/kernel-boundary.ts";
import type { AreaMapController, Composition, GestureBaseline, Region, SceneElement, Selection, World } from "../kernel/kernel-types.ts";
import type { Delta, Point } from "../units/frames.ts";
import type { AreaKey, ResizeHandle, RuntimeId } from "../units/ids.ts";
import { deltaBetween } from "../units/scalar-math.ts";
import { count } from "../units/units.ts";
import type { Count } from "../units/units.ts";
import type { PressMeaning } from "./press-meaning.ts";

/** What a gesture needs of the world controller: open a word, preview into it, close it, and read what it holds. */
export type PointerController = Pick<AreaMapController, "beginGesture" | "preview" | "endGesture" | "world" | "snapshot">;

/** One frame of the browser's animation clock, injected so a test steps the settle by hand. */
export type PointerScheduler = {
  /** Runs the callback on the next animation frame. */
  readonly frame: (run: () => void) => void;
};

/**
 * What to publish into the open command. `elements` null means publish whatever Excalidraw holds
 * now, which is what a released drag settles with; a keyboard nudge passes the elements it moved,
 * because Excalidraw never saw the key.
 */
export type PublishRequest = {
  readonly elements: readonly SceneElement[] | null;
  readonly selection: Selection | null;
};

/** Publishes one release state into the controller's open command. */
export type PointerPublish = (request: PublishRequest) => void;

/** What a session is built on. */
export type PointerSessionDeps = {
  readonly controller: PointerController;
  readonly publish: PointerPublish;
  readonly scheduler: PointerScheduler;
  /** Records one coordinate-free diagnostic event, when the host wants them. */
  readonly recordEvent?: ((name: string, fields: Record<string, unknown>) => void) | undefined;
};

/**
 * Where a gesture begins: the scene point it starts at and the selection the controller held then.
 * A `PressContext` from `press-meaning.ts` satisfies this shape, so a press hands its own context
 * straight to `begin`, and `nudge.ts` builds the same shape from the keyboard.
 */
export type GestureContext = {
  readonly point: Point<"scene">;
  readonly selection: Selection;
};

/** What the kernel solved for one preview: the scene to paint and what it changed. */
export type PointerPreview = {
  readonly elements: readonly SceneElement[];
  readonly changedAreas: ReadonlySet<AreaKey>;
  readonly appliedDelta: Delta<"scene">;
  /** False when the solver could not keep every rectangle finite, which the host reports as a failed invariant. */
  readonly valid: boolean;
};

/** The word the controller records for a pointer gesture. */
const POINTER_GESTURE = "pointer";

/** No settle has been scheduled yet; the first token is one. */
const NO_SETTLE_TOKEN: Count = count(0);

/** No Area is under the gesture. */
const NO_AREAS: ReadonlySet<AreaKey> = new Set<AreaKey>();

/** Runs one callback on the browser's next animation frame. */
function nextFrame(run: () => void): void {
  requestAnimationFrame(run);
}

/** The browser's frame scheduler. */
export function browserPointerScheduler(): PointerScheduler {
  return { frame: nextFrame };
}

/** The Areas a meaning moves or resizes: exactly the one it names, and none for every other meaning. */
export function areasOfMeaning(meaning: PressMeaning): ReadonlySet<AreaKey> {
  if (meaning.kind === "move-area" || meaning.kind === "resize-area") return new Set([meaning.area]);
  return NO_AREAS;
}

/** The handle a meaning drags from, or null for a move and for every meaning the kernel does not solve. */
export function handleOfMeaning(meaning: PressMeaning): ResizeHandle | null {
  return meaning.kind === "resize-area" ? meaning.handle : null;
}

/** True for the two meanings the kernel's Area solver owns. Every other meaning is Excalidraw's own drag. */
export function isSolvedMeaning(meaning: PressMeaning | null): boolean {
  return meaning !== null && (meaning.kind === "move-area" || meaning.kind === "resize-area");
}

/**
 * Builds the immutable inputs the kernel's solvers read: every Area's region and the hulls its own
 * content occupies. A deferred shard has no scene, so its stored hulls stand in for it, which is
 * what lets a gesture solve against an Area whose file has not been loaded.
 */
export function gestureBaselineOf(world: World): GestureBaseline {
  const regions = new Map<AreaKey, Region>();
  const blockHulls = new Map<AreaKey, Region["storedRect"]>();
  const inkHulls = new Map<AreaKey, Region["storedRect"]>();
  for (const node of world.areas) {
    regions.set(node.key, { ...node.region });
    const hulls = node.shard.scene ? shardHulls(node.shard.scene) : { blocks: node.shard.ownBlockHull, ink: node.shard.ownInkHull };
    if (hulls.blocks) blockHulls.set(node.key, hulls.blocks);
    if (hulls.ink) inkHulls.set(node.key, hulls.ink);
  }
  return { areas: world.areas.map((node) => node.key), regions, blockHulls, inkHulls };
}

/** The world a preview installs: each changed Area carries the region the solver authored, and every other node is untouched. */
export function worldWithRegions(world: World, regions: ReadonlyMap<AreaKey, Region>, changed: ReadonlySet<AreaKey>): World {
  const areas = world.areas.map((node) => {
    const solved = changed.has(node.key) ? regions.get(node.key) : undefined;
    return solved === undefined ? node : { ...node, region: { ...solved, source: "stored" as const } };
  });
  return { ...world, areas };
}

/** Follows a chain of claimed ids to the world id that ended it, stopping rather than looping on a malformed chain. */
export function resolveClaimedId(mapping: ReadonlyMap<RuntimeId, RuntimeId>, id: RuntimeId): RuntimeId {
  let current = id;
  const seen = new Set<RuntimeId>();
  while (mapping.has(current) && !seen.has(current)) {
    seen.add(current);
    current = mapping.get(current) ?? current;
  }
  return current;
}

/** Rewrites every claimed id one element carries: its own, its container, its frame and its bound elements. */
function remapElement(element: SceneElement, mapping: ReadonlyMap<RuntimeId, RuntimeId>): SceneElement {
  const remapped: SceneElement = {
    ...element,
    id: resolveClaimedId(mapping, element.id),
    frameId: element.frameId === null ? null : resolveClaimedId(mapping, element.frameId),
    boundElements: element.boundElements?.map((bound) => ({ ...bound, id: resolveClaimedId(mapping, bound.id) })) ?? null,
  };
  if (element.containerId !== undefined && element.containerId !== null) remapped.containerId = resolveClaimedId(mapping, element.containerId);
  return remapped;
}

/**
 * Rewrites the temporary ids Excalidraw minted for elements the Map claimed during the gesture into
 * the world ids that replaced them. A publish that skipped this would store an element under an id
 * the world does not know, and the next composition would drop it.
 */
export function remapClaimedIdentities(elements: readonly SceneElement[], mapping: ReadonlyMap<RuntimeId, RuntimeId>): SceneElement[] {
  if (mapping.size === 0) return [...elements];
  return elements.map((element) => remapElement(element, mapping));
}

/** One pointer gesture. One instance lives for the life of the Map root and is empty between gestures. */
export class PointerSession {
  private readonly deps: PointerSessionDeps;
  private baseline: World | null = null;
  private solverBaseline: GestureBaseline | null = null;
  private baselineComposition: Composition | null = null;
  private meaning: PressMeaning | null = null;
  private origin: Point<"scene"> | null = null;
  private current: Point<"scene"> | null = null;
  private handle: ResizeHandle | null = null;
  private areas: ReadonlySet<AreaKey> = NO_AREAS;
  private settling = false;
  private settleToken: Count = NO_SETTLE_TOKEN;
  private settleWaiters: (() => void)[] = [];
  private claimed: Map<RuntimeId, RuntimeId> = new Map();

  /** Builds a session over the injected controller, publish callback and frame scheduler. */
  constructor(deps: PointerSessionDeps) {
    this.deps = deps;
  }

  /** True while a controller gesture is open, which is from `begin` until `settle`. */
  isOpen(): boolean {
    return this.baseline !== null;
  }

  /** True between `end` and the settle it scheduled, while the release callbacks still belong to this word. */
  isSettling(): boolean {
    return this.settling;
  }

  /** What this gesture means, or null when none is open. */
  currentMeaning(): PressMeaning | null {
    return this.meaning;
  }

  /** Where the pointer last was, or null when no gesture is open. */
  currentPoint(): Point<"scene"> | null {
    return this.current;
  }

  /** The Areas this gesture moves or resizes. Empty for every meaning the kernel does not solve. */
  selectedAreas(): ReadonlySet<AreaKey> {
    return this.areas;
  }

  /**
   * The composition of the baseline world, composed on the first ask and kept for the gesture. It
   * is the scene as it stood at the press, which is what a consumer measures a drag against while
   * the live composition is already showing previews.
   */
  composition(): Composition | null {
    if (this.baseline === null) return null;
    if (this.baselineComposition === null) this.baselineComposition = composeAreaMapWorld(this.baseline);
    return this.baselineComposition;
  }

  /**
   * Opens the controller's pointer word and records the baseline every preview solves from. A press
   * that arrives while a gesture is already open is ignored, as the old component ignored it: the
   * open gesture owns the pointer until it settles.
   */
  begin(meaning: PressMeaning, context: GestureContext): void {
    if (this.isOpen()) return;
    this.meaning = meaning;
    this.origin = context.point;
    this.current = context.point;
    this.handle = handleOfMeaning(meaning);
    this.areas = areasOfMeaning(meaning);
    this.settling = false;
    this.claimed = new Map();
    this.baselineComposition = null;
    this.baseline = this.deps.controller.beginGesture(POINTER_GESTURE);
    this.solverBaseline = gestureBaselineOf(this.baseline);
    this.deps.recordEvent?.("area_map_pointer_down", { gestureKind: this.gestureKind(), selectedCount: count(this.areas.size) });
  }

  /**
   * Solves one preview from the immutable baseline and installs it in the controller. Only an Area
   * move and an Area resize reach the kernel; every other meaning is Excalidraw dragging its own
   * elements, and this returns null so the caller paints nothing of its own.
   */
  preview(point: Point<"scene">): PointerPreview | null {
    this.current = point;
    const solver = this.solverBaseline;
    if (solver === null || this.origin === null || !isSolvedMeaning(this.meaning) || this.areas.size === 0) return null;
    const solved = solveAreaMapGesture(solver, {
      selectedAreas: [...this.areas],
      handle: this.handle,
      desiredWorldDelta: deltaBetween(this.origin, point),
    });
    const changedAreas = new Set([...this.areas, ...solved.changedAreas]);
    this.deps.controller.preview(worldWithRegions(this.deps.controller.world(), solved.regions, changedAreas), { changedAreas });
    this.deps.recordEvent?.("area_map_gesture_solved", { gestureKind: this.gestureKind(), previewCount: count(changedAreas.size), valid: solved.valid });
    return { elements: this.deps.controller.snapshot().scene.elements, changedAreas, appliedDelta: solved.appliedDelta, valid: solved.valid };
  }

  /** Publishes one scene the Map itself moved into the open command. The keyboard nudge is its only caller. */
  publishScene(elements: readonly SceneElement[], selection: Selection): void {
    if (!this.isOpen()) return;
    this.deps.publish({ elements, selection });
  }

  /** Records that Excalidraw's temporary id for a claimed element is now this world id. */
  claim(temporary: RuntimeId, actual: RuntimeId): void {
    this.claimed.set(temporary, actual);
  }

  /** The world id one temporary id became, or the id itself when nothing claimed it. */
  claimedId(id: RuntimeId): RuntimeId {
    return resolveClaimedId(this.claimed, id);
  }

  /** The claimed identities of this gesture, for a publish that must rewrite a whole scene. */
  claimedIdentities(): ReadonlyMap<RuntimeId, RuntimeId> {
    return this.claimed;
  }

  /**
   * Publishes the release state and closes the word now, superseding any settle `end` scheduled.
   * A new command that must own the next callback calls this rather than waiting for the frames.
   */
  settle(): void {
    this.settleToken = count(this.settleToken + 1);
    if (!this.isOpen()) {
      this.finishSettle();
      return;
    }
    this.deps.publish({ elements: null, selection: null });
    this.deps.controller.endGesture(POINTER_GESTURE);
    this.clear();
    this.finishSettle();
  }

  /**
   * Ends the gesture the way a release does. The release state is published at once, and the word
   * stays open across two animation frames so Excalidraw's own final callback lands inside it
   * rather than opening a second word of its own.
   */
  end(): void {
    if (!this.isOpen() || this.settling) return;
    this.settling = true;
    this.deps.publish({ elements: null, selection: null });
    this.settleToken = count(this.settleToken + 1);
    const token = this.settleToken;
    this.deps.scheduler.frame(() => this.deps.scheduler.frame(() => {
      if (token !== this.settleToken) return;
      this.settle();
    }));
  }

  /** Resolves once the released gesture has entered controller history, which is what a save waits for. */
  waitForSettle(): Promise<void> {
    if (!this.isOpen() && !this.settling) return Promise.resolve();
    return new Promise((resolve) => { this.settleWaiters.push(resolve); });
  }

  /** The word the diagnostics record this gesture as. */
  private gestureKind(): string {
    if (this.meaning?.kind === "resize-area") return "region-resize";
    return this.meaning?.kind === "move-area" ? "region-move" : "selection";
  }

  /** Empties every field, so the session between gestures is indistinguishable from a fresh one. */
  private clear(): void {
    this.baseline = null;
    this.solverBaseline = null;
    this.baselineComposition = null;
    this.meaning = null;
    this.origin = null;
    this.current = null;
    this.handle = null;
    this.areas = NO_AREAS;
    this.claimed = new Map();
  }

  /** Lowers the settling flag and releases everyone waiting on the fence. */
  private finishSettle(): void {
    this.settling = false;
    const waiters = this.settleWaiters;
    this.settleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}
