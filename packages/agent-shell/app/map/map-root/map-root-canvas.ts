// The Map's side of every Excalidraw callback.
//
// `canvas/MapCanvas.tsx` wires Excalidraw's props and forwards each one here. A press becomes a
// `PressContext`, `input/press-meaning.ts` says what it means, `input/excalidraw-subordination.ts`
// tells Excalidraw what it may hold selected before its first move frame, and
// `input/pointer-session.ts` opens the gesture. A change is either the echo of a projection, a
// buffered text edit, or a real change that `map-publish.ts` turns into world authority.

import type { ExcalidrawImperativeAPI, PointerDownState } from "@excalidraw/excalidraw/types";
import { asSceneElements, selectedIds } from "../canvas/projection.ts";
import type { Projection, SelectionAppState } from "../canvas/projection.ts";
import { TextEditBuffer, captureLiveTextEdit, finishTextEdit, staleEditingText } from "../canvas/text-edit.ts";
import type { TextEditAppState } from "../canvas/text-edit.ts";
import type { CanvasHandlers } from "../canvas/MapCanvas.tsx";
import { CANVAS_ANNOUNCEMENTS } from "../copy.ts";
import { authoredFingerprint } from "../kernel/kernel-boundary.ts";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { hitTest, selectedVisibleArea, visibleSceneFromSnapshot } from "../input/hit-test.ts";
import type { VisibleScene } from "../input/hit-test.ts";
import { applySubordination, regionIdsOf, selectionForMeaning } from "../input/excalidraw-subordination.ts";
import { meaningOfPress } from "../input/press-meaning.ts";
import type { PressContext, PressMeaning } from "../input/press-meaning.ts";
import { PointerSession, resolveClaimedId } from "../input/pointer-session.ts";
import { areaMapPointerCommand } from "../kernel/kernel-boundary.ts";

/** The app state one change callback carries that the Map reads. */
type ChangeAppState = SelectionAppState & TextEditAppState;
import type { SceneElement, Snapshot } from "../kernel/kernel-types.ts";
import { point } from "../units/frames.ts";
import type { Camera, Point } from "../units/frames.ts";
import type { RuntimeId } from "../units/ids.ts";
import { scenePx } from "../units/units.ts";
import { publishToWorld } from "./map-publish.ts";
import type { PublishDeps } from "./map-publish.ts";
import type { MapSession } from "./map-session.ts";

/** What the canvas handlers need beyond the publish dependencies they share. */
export type CanvasDeps = PublishDeps & {
  readonly buffer: TextEditBuffer;
  /** True while a resource placement waits for its point; such a press commits it instead. */
  readonly placementOpen: () => boolean;
  /** Commits the open placement at one scene point. */
  readonly commitPlacement: (at: Point<"scene">) => void;
  /** Moves the open placement preview to one scene point. */
  readonly movePlacement: (at: Point<"scene">) => void;
  /** Claims a pasted Tangent reference; true when the paste was the Map's and Excalidraw must not paste it. */
  readonly claimPaste: (text: string) => boolean;
  /** Called after every change that reaches the world, so the root can drop a Show on Map layer. */
  readonly onUserChange: () => void;
};

/** The pointer state Excalidraw reports, with the modifier flags the Map reads. */
type PressState = PointerDownState & { readonly shiftKey?: boolean; readonly withCmdOrCtrl?: boolean };

/** The scene point of Excalidraw's own pointer origin. */
function originPoint(state: PointerDownState): Point<"scene"> {
  return point("scene", scenePx(state.origin.x), scenePx(state.origin.y));
}

/** Everything a press can see, gathered once at pointer down. */
function pressContextOf(deps: CanvasDeps, tool: { type: string }, state: PressState, snapshot: Snapshot, scene: VisibleScene): PressContext {
  const appState = deps.session.api?.getAppState();
  const at = originPoint(state);
  return {
    point: at,
    modifiers: { shift: state.shiftKey === true, cmdOrCtrl: state.withCmdOrCtrl === true },
    spaceHeld: deps.session.spaceHeld,
    tool: tool.type as PressContext["tool"],
    placementOpen: deps.placementOpen(),
    editingText: Boolean(appState?.editingTextElement),
    selection: snapshot.selection,
    selectedArea: selectedVisibleArea(scene, snapshot.selection),
    command: areaMapPointerCommand(state),
    hit: hitTest(scene, at),
  };
}

/** The selection the Map holds after a press: the one the meaning names, else what it held. */
function selectionAfterPress(meaning: PressMeaning, session: MapSession, ids: ReadonlySet<RuntimeId> | null): ReadonlySet<RuntimeId> {
  if (ids === null) return session.stableSelection;
  return meaning.kind === "pan" || meaning.kind === "rubber-band" ? new Set<RuntimeId>() : ids;
}

/** True for a meaning whose gesture the Map itself carries rather than leaving it to Excalidraw. */
function movesTheMap(meaning: PressMeaning): boolean {
  return meaning.kind === "move-area" || meaning.kind === "resize-area" || meaning.kind === "grab-element" || meaning.kind === "add-to-selection";
}

/** Opens one press: decide, subordinate Excalidraw's selection, then begin the gesture. */
function beginPress(deps: CanvasDeps, tool: { type: string }, state: PressState): void {
  if (deps.placementOpen()) {
    deps.commitPlacement(originPoint(state));
    return;
  }
  if (tool.type === "text") deps.session.textPlacement = originPoint(state);
  else deps.session.textPlacement = null;
  const snapshot = deps.controller.snapshot();
  const scene = visibleSceneFromSnapshot(snapshot);
  const context = pressContextOf(deps, tool, state, snapshot, scene);
  if (context.editingText) return;
  const meaning = meaningOfPress(context);
  if (meaning.kind === "ignore" && meaning.reason === "rotation") {
    deps.announce(CANVAS_ANNOUNCEMENTS.outlinesCannotRotate);
    deps.projection.project({ elements: snapshot.scene.elements }, "area-transform-rejected");
    return;
  }
  deps.projection.cancel();
  repairStaleEditor(deps, true);
  deps.session.claimedIds = new Map();
  deps.session.claimedOrigins = new Map();
  deps.session.outlineProtectionAnnounced = false;
  deps.session.stableSelection = new Set(snapshot.selection);
  const subordination = selectionForMeaning(meaning, snapshot.selection, regionIdsOf(snapshot.composition.scene.elements));
  applySubordination(deps.projection, subordination);
  const held = selectionAfterPress(meaning, deps.session, subordination === null ? null : subordination.ids);
  if (subordination !== null) {
    deps.session.stableSelection = held;
    deps.session.programmaticSelection = new Set(held);
    deps.controller.setSelection(held);
  }
  deps.session.additiveSelection = meaning.kind === "add-to-selection" ? new Set(held) : null;
  deps.session.pointerSelected = movesTheMap(meaning) ? new Set(held) : new Set<RuntimeId>();
  deps.pointer.begin(meaning, { point: context.point, selection: held });
}

/** Repairs an Excalidraw text editor left holding an id the composed scene no longer has. */
function repairStaleEditor(deps: CanvasDeps, force: boolean): void {
  const api = deps.session.api;
  if (api === null) return;
  const repair = staleEditingText({
    appState: api.getAppState(),
    validRuntimeIds: new Set(deps.controller.snapshot().composition.scene.elements.map((element) => element.id)),
    /** Follows a claimed temporary id to the world id that replaced it. */
    resolveClaimedId: (id: RuntimeId) => resolveClaimedId(deps.session.claimedIds, id),
    force,
  });
  if (repair === null) return;
  deps.projection.project({ selection: repair.selection, clearEditingText: true }, "stale-text-repair");
}

/** True while a command of the Map's own owns the change callbacks Excalidraw is reporting. */
function userCommandOpen(deps: CanvasDeps): boolean {
  return deps.pointer.isOpen() || deps.session.nonPointer !== null || deps.buffer.isActive() || deps.session.actionKind !== null;
}

/**
 * Keeps the controller's selection in step with Excalidraw's, and repairs a selection the Map asked
 * for that Excalidraw dropped. False means the repair owns this callback and nothing is published.
 */
function syncSelection(deps: CanvasDeps, appState: SelectionAppState): boolean {
  const ids = selectedIds(appState);
  const additive = deps.session.additiveSelection;
  let selection = ids;
  if (additive !== null && additive.size > 0 && ![...additive].every((id) => ids.includes(id))) {
    selection = [...new Set([...ids, ...additive])];
    requestAnimationFrame(() => deps.projection.project({ selection }, "additive-selection-repair"));
  }
  const programmatic = deps.session.programmaticSelection;
  if (programmatic !== null && programmatic.size > 0 && ![...programmatic].every((id) => selection.includes(id))) {
    requestAnimationFrame(() => deps.projection.project({ selection: programmatic }, "selection-repair"));
    return false;
  }
  deps.controller.setSelection(selection);
  if (selection.length > 0) deps.session.stableSelection = new Set(selection);
  for (const element of deps.controller.snapshot().composition.scene.elements) {
    const area = element.customData?.tangent?.area;
    if (area === undefined || element.customData?.tangent?.role !== "area-region" || !selection.includes(element.id)) continue;
    void deps.controller.prioritizeLoads(area, { includeDescendants: false, requireSelectedDeferred: true });
  }
  return true;
}

/** Normalises one Excalidraw callback into source-owned world authority. */
function handleChange(deps: CanvasDeps, elements: readonly ExcalidrawElement[], appState: ChangeAppState): void {
  if (deps.projection.consume(elements, appState)) return;
  const command = userCommandOpen(deps);
  if (!command && deps.projection.absorbFencedChange(elements)) return;
  if (captureLiveTextEdit(deps.buffer, elements, appState)) {
    deps.projection.cancel();
    return;
  }
  const buffered = deps.buffer.isActive();
  if (!command && deps.session.initializing) return;
  if (deps.pointer.isSettling() && !buffered) return;
  const scene = asSceneElements(elements);
  const settled = finishTextEdit(deps.buffer, scene) ?? scene;
  if (buffered) {
    deps.session.programmaticSelection = null;
    deps.session.actionKind = "text";
  }
  if (deps.session.nonPointer?.kind === "text" && !appState.editingTextElement) deps.settleNonPointer();
  if (!syncSelection(deps, appState)) return;
  const fingerprint = authoredFingerprint(settled);
  if (fingerprint === deps.projection.lastFingerprint()) return;
  deps.projection.noteFingerprint(fingerprint);
  publishToWorld(deps, settled, appState);
  deps.onUserChange();
}

/** Builds every Excalidraw callback the Map answers. */
export function createCanvasHandlers(deps: CanvasDeps, setApi: (api: ExcalidrawImperativeAPI) => void): CanvasHandlers {
  return {
    setApi,
    /** Opens one press through the pointer authority. */
    onPointerDown: (tool, state) => beginPress(deps, tool, state as PressState),
    /** Ends the open gesture when the pointer is released. */
    onPointerUp: () => deps.pointer.end(),
    /** Previews the open gesture, or moves the open placement preview. */
    onPointerMove: (at, button) => {
      deps.session.lastPointer = at;
      if (deps.placementOpen()) {
        deps.movePlacement(at);
        return;
      }
      if (button !== "down" || !deps.pointer.isOpen()) return;
      const preview = deps.pointer.preview(at);
      if (preview !== null) deps.projection.project({ elements: preview.elements }, "area-pointer-preview");
    },
    /** Stores the camera without entering authored history. */
    onCamera: (camera: Camera) => deps.controller.setCamera(camera),
    /** Claims a pasted Tangent reference, or records where an ordinary paste lands. */
    onPaste: (data) => {
      if (data.files?.length) return true;
      deps.session.actionKind = "paste";
      const at = deps.session.lastPointer;
      if (at !== null) deps.session.pastePlacement = { point: at, area: deps.ownerAt(at) };
      const text = typeof data.text === "string" ? data.text : "";
      if (!text || !deps.claimPaste(text)) return false;
      deps.session.pastePlacement = null;
      return true;
    },
    /** Normalises one Excalidraw callback into source-owned world authority. */
    onChange: (elements, appState) => handleChange(deps, elements, appState),
  };
}

/** The ids Excalidraw holds selected now, for a caller that has only the api. */
export function liveSelection(api: ExcalidrawImperativeAPI | null): RuntimeId[] {
  return selectedIds(api?.getAppState());
}
