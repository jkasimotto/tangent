// The projection fence between the controller and Excalidraw.
//
// The controller is the authority for the composed scene (ADR-0051). Excalidraw shows it, and
// every time the Map pushes a scene or a selection into Excalidraw, Excalidraw answers with an
// `onChange` that looks like a user edit. This class is the one place that pushes, and it fences
// each push: `project` records what it expects Excalidraw to echo, `consume` recognises the echo
// by fingerprint and selection and swallows it, `defer` queues a push until the current React
// lifecycle returns, and `cancel` lets a new user command supersede whatever was queued. It is one
// of the two writers of Excalidraw's `selectedElementIds`; the other is
// `input/excalidraw-subordination.ts`, which decides the selection and applies it through here.
// Every push carries `captureUpdate: "NEVER"` so Excalidraw never owns history.
//
// The Excalidraw api, the scheduler and the clock are injected, so the fence runs under Node with
// a fake api and a scheduler the test steps by hand.

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { authoredFingerprint } from "../kernel/kernel-boundary.ts";
import type { AuthoredFingerprint, SceneElement } from "../kernel/kernel-types.ts";
import { LAYOUT } from "../layout/layout-tokens.ts";
import type { Camera } from "../units/frames.ts";
import { runtimeId } from "../units/ids.ts";
import type { RuntimeId } from "../units/ids.ts";
import { subtract } from "../units/scalar-math.ts";
import { count, milliseconds } from "../units/units.ts";
import type { Count, Milliseconds } from "../units/units.ts";

/** Every reason a projection is pushed. The diagnostic event names the reason so a trace reads as a story. */
export const PROJECTION_REASONS = [
  "additive-pointer-selection", "additive-selection-repair", "area-pointer-preview", "area-selection", "area-style-rejected", "area-transform-rejected",
  "camera-selection", "claim", "claimed-nudge", "no-change", "placed-block-selection", "pointer-down-selection",
  "pointer-release-selection", "projection", "resource-placement-preview", "selection-repair", "stale-region-release",
  "stale-text-repair", "view-return",
] as const;

/** One of the named reasons above. */
export type ProjectionReason = (typeof PROJECTION_REASONS)[number];

/** The three Excalidraw api calls the fence needs. */
export type ProjectionApi = Pick<ExcalidrawImperativeAPI, "updateScene" | "getSceneElements" | "getAppState">;

/**
 * What to push. Elements replace the scene; a selection replaces what Excalidraw holds selected;
 * `clearEditingText` closes a text editor Excalidraw still believes is open. A field left out is
 * left alone in Excalidraw.
 */
export type ProjectionRequest = {
  readonly elements?: readonly SceneElement[];
  readonly selection?: Iterable<RuntimeId>;
  readonly clearEditingText?: boolean;
  /** Where the camera must be put back to, which is how a view layer returns exactly. */
  readonly camera?: Camera;
};

/** How the fence waits: a microtask for a deferred push, a timeout for the fence window. */
export type ProjectionScheduler = {
  readonly microtask: (run: () => void) => void;
  readonly timeout: (run: () => void, delay: Milliseconds) => void;
};

/** What the fence is built on. `now` is a monotonic clock reading, for the duration in the consumed event. */
export type ProjectionDependencies = {
  readonly api: () => ProjectionApi | null;
  readonly recordEvent: (name: "area_map_projection", fields: Record<string, unknown>) => void;
  readonly scheduler: ProjectionScheduler;
  readonly now: () => Milliseconds;
};

/** One expected echo: what Excalidraw's next change callback must look like to be this projection's. */
export type ProjectionToken = {
  readonly id: Count;
  readonly fingerprint: AuthoredFingerprint;
  readonly selection: string;
  readonly reason: ProjectionReason;
  readonly includesElements: boolean;
  readonly affectedCount: Count;
  readonly elementCount: Count;
  readonly startedAt: Milliseconds;
};

/** The appState slice a change callback carries that the fence reads. */
export type SelectionAppState = Pick<AppState, "selectedElementIds">;

/** No fence: token ids start at one. */
const NO_FENCE = count(0);

/** The browser's scheduler: a microtask and a timeout. */
export function browserProjectionScheduler(): ProjectionScheduler {
  return {
    /** Queues one push for after the current React lifecycle returns. */
    microtask: (run) => queueMicrotask(run),
    /** Waits out the fence window before the fence is lifted. */
    timeout: (run, delay) => { setTimeout(run, delay); },
  };
}

/** The browser's monotonic clock, as milliseconds since the time origin. */
export function performanceClock(): Milliseconds {
  return milliseconds(performance.now());
}

/** Claims the Map's element shape for the elements Excalidraw hands back. The one read cast in the canvas. */
export function asSceneElements(elements: readonly ExcalidrawElement[]): readonly SceneElement[] {
  return elements as unknown as readonly SceneElement[];
}

/** Hands the Map's elements to Excalidraw under its own type. The one write cast in the canvas. */
export function asExcalidrawElements(elements: readonly SceneElement[]): readonly ExcalidrawElement[] {
  return elements as unknown as readonly ExcalidrawElement[];
}

/** The ids Excalidraw holds selected, read from any appState that carries the field. */
export function selectedIds(appState: SelectionAppState | null | undefined): RuntimeId[] {
  const selected = appState?.selectedElementIds ?? {};
  return Object.keys(selected).filter((id) => selected[id]).map(runtimeId);
}

/** One stable key for a selection, so two selections compare as strings regardless of order. */
export function selectionKey(ids: Iterable<RuntimeId>): string {
  return JSON.stringify([...new Set(ids)].sort());
}

/** The `selectedElementIds` record Excalidraw reads, built from a list of ids. */
function selectionRecord(ids: readonly RuntimeId[]): AppState["selectedElementIds"] {
  return Object.fromEntries(ids.map((id) => [id, true as const]));
}

/**
 * The appState slice that carries one selection. The fence is one of the two owners of the field,
 * so every other module, tests included, asks for the slice here instead of writing the key.
 */
export function selectionAppState(ids: Iterable<RuntimeId>): SelectionAppState {
  return { selectedElementIds: selectionRecord([...ids]) };
}

/** The appState fields one camera push carries, in the shape Excalidraw reads them. */
function cameraAppState(camera: Camera): Pick<AppState, "scrollX" | "scrollY" | "zoom"> {
  return { scrollX: camera.scrollX, scrollY: camera.scrollY, zoom: { value: camera.zoom } as unknown as AppState["zoom"] };
}

/** Pushes one request into Excalidraw. Four shapes, one per appState slice, so each call carries exact keys. */
function applyRequest(api: ProjectionApi, request: ProjectionRequest, selection: readonly RuntimeId[]): void {
  const elements = request.elements === undefined ? {} : { elements: asExcalidrawElements(request.elements) };
  const captureUpdate = "NEVER" as const;
  if (request.camera !== undefined) {
    api.updateScene({ ...elements, appState: { ...cameraAppState(request.camera), ...selectionAppState(selection) }, captureUpdate });
  } else if (request.clearEditingText) {
    api.updateScene({ ...elements, appState: { ...selectionAppState(selection), editingTextElement: null }, captureUpdate });
  } else if (request.selection !== undefined) {
    api.updateScene({ ...elements, appState: selectionAppState(selection), captureUpdate });
  } else {
    api.updateScene({ ...elements, captureUpdate });
  }
}

/** The fence. One instance lives for the life of the Map root. */
export class Projection {
  private readonly deps: ProjectionDependencies;
  private issued: Count = count(0);
  private deferredSerial: Count = count(0);
  private fence: Count = NO_FENCE;
  private expected: ProjectionToken[] = [];
  private applied: AuthoredFingerprint | null = null;
  private last: AuthoredFingerprint | null = null;

  /** Builds a fence over the injected api, scheduler and clock. */
  constructor(deps: ProjectionDependencies) {
    this.deps = deps;
  }

  /** The fingerprint of the last elements this fence pushed or absorbed, or null before the first. */
  appliedFingerprint(): AuthoredFingerprint | null {
    return this.applied;
  }

  /** The fingerprint of the last scene the fence saw, pushed, echoed or published. */
  lastFingerprint(): AuthoredFingerprint | null {
    return this.last;
  }

  /** Records the fingerprint of a scene the change handler published, so an unchanged echo is skipped later. */
  noteFingerprint(fingerprint: AuthoredFingerprint): void {
    this.last = fingerprint;
  }

  /** True while a push that replaced the elements still fences the callbacks it causes. */
  hasFence(): boolean {
    return this.fence !== NO_FENCE;
  }

  /** Pushes one request now and records the echo to expect. Returns null when Excalidraw is not mounted. */
  project(request: ProjectionRequest, reason: ProjectionReason): ProjectionToken | null {
    const api = this.deps.api();
    if (api === null) return null;
    const elements = request.elements ?? asSceneElements(api.getSceneElements());
    const selection = request.selection === undefined ? selectedIds(api.getAppState()) : [...request.selection];
    const token = this.issue(elements, selection, reason, request);
    this.deps.recordEvent("area_map_projection", {
      projectionId: token.id, phase: "request", projectionKind: token.reason, affectedCount: token.affectedCount, elementCount: token.elementCount,
    });
    applyRequest(api, request, selection);
    if (token.includesElements) this.deps.scheduler.timeout(() => this.releaseFence(token.id), LAYOUT.projectionFenceWindow);
    return token;
  }

  /** Recognises a change callback as the echo of an expected push and swallows it. False for a real change. */
  consume(elements: readonly ExcalidrawElement[], appState: SelectionAppState): boolean {
    const fingerprint = authoredFingerprint(asSceneElements(elements));
    const selection = selectionKey(selectedIds(appState));
    const position = this.expected.findIndex((token) => token.fingerprint === fingerprint && token.selection === selection);
    const token = this.expected[position];
    if (position < 0 || token === undefined) return false;
    this.expected.splice(position, 1);
    this.last = fingerprint;
    if (token.includesElements) this.applied = fingerprint;
    this.deps.recordEvent("area_map_projection", {
      projectionId: token.id, phase: "consumed", projectionKind: token.reason, affectedCount: token.affectedCount,
      elementCount: count(elements.length), duration: subtract(this.deps.now(), token.startedAt),
    });
    return true;
  }

  /**
   * Absorbs a change that arrived while an element push was pending or fenced and no user command
   * was open: Excalidraw is settling the scene it was given. Records the fingerprint and forgets the
   * tokens the fence covers. False when nothing was pending, so the caller treats the change as real.
   */
  absorbFencedChange(elements: readonly ExcalidrawElement[]): boolean {
    const pending = this.expected.find((token) => token.includesElements);
    if (pending === undefined && !this.hasFence()) return false;
    const fingerprint = authoredFingerprint(asSceneElements(elements));
    this.applied = fingerprint;
    this.last = fingerprint;
    const fence = pending?.id ?? this.fence;
    this.expected = this.expected.filter((token) => token.id > fence);
    return true;
  }

  /** Queues one push for after the current React lifecycle returns. A later defer or cancel supersedes it. */
  defer(request: ProjectionRequest, reason: ProjectionReason): void {
    const serial = count(this.deferredSerial + 1);
    this.deferredSerial = serial;
    this.deps.scheduler.microtask(() => {
      if (serial !== this.deferredSerial) return;
      this.project(request, reason);
    });
  }

  /** Drops the queued push, the fence and every expected echo: a new user command owns the next callback. */
  cancel(): void {
    this.deferredSerial = count(this.deferredSerial + 1);
    this.fence = NO_FENCE;
    this.expected = [];
  }

  /** Records one expected echo and, for an element push, moves the fence to it. */
  private issue(elements: readonly SceneElement[], selection: readonly RuntimeId[], reason: ProjectionReason, request: ProjectionRequest): ProjectionToken {
    this.issued = count(this.issued + 1);
    const token: ProjectionToken = {
      id: this.issued,
      fingerprint: authoredFingerprint(elements),
      selection: selectionKey(selection),
      reason,
      includesElements: request.elements !== undefined,
      affectedCount: count(request.elements?.length ?? 0),
      elementCount: count(elements.length),
      startedAt: this.deps.now(),
    };
    this.expected.push(token);
    if (this.expected.length > LAYOUT.projectionTokenCap) this.expected.splice(0, this.expected.length - LAYOUT.projectionTokenCap);
    if (token.includesElements) {
      this.applied = token.fingerprint;
      this.last = token.fingerprint;
      this.fence = token.id;
    }
    return token;
  }

  /** Lifts the fence once its window has passed, unless a later push moved it. */
  private releaseFence(id: Count): void {
    if (this.fence === id) this.fence = NO_FENCE;
  }
}
