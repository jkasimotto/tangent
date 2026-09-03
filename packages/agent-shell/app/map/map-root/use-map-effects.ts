// Every effect the Map root installs, in one hook.
//
// The controller subscription, the one keyboard listener, the projection push, the announce clock,
// the narrow-width watch, the resource cadence, the shell inert guard and the bridge the host holds
// are each one `useEffect` here, so `MapRoot.tsx` stays the composition and this file stays the
// lifecycle. Nothing here renders.

import { useEffect, useLayoutEffect } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { selectedIds } from "../canvas/projection.ts";
import { installKeyboardDispatch } from "../input/keyboard-dispatch.ts";
import { fitArea } from "./map-root-commands.ts";
import { focusMapCanvas } from "../ui/canvas-focus.ts";
import { selectedVisibleArea } from "../input/hit-test.ts";
import { selectedMapEntityElement } from "../kernel/kernel-boundary.ts";
import type { Focus, SceneElement, Snapshot } from "../kernel/kernel-types.ts";
import { LAYOUT } from "../layout/layout-tokens.ts";
import type { AreaBoardBridge } from "../mount-options.ts";
import { installResourceCadence, refreshOpenPanel, resolveSceneResources } from "../surfaces/resources/resources-effects.ts";
import { hasModalSurface } from "../surfaces/surface-stack.ts";
import type { AreaKey, RuntimeId } from "../units/ids.ts";
import { placementPreviewElements, placementProjectionKey } from "../surfaces/placement/placement-effects.ts";
import { installAnnounceClock, installBlockDoubleClick, installInertGuard, pushProjection, readMapKinds, reconcileSurfaces, settleMount, subscribeSnapshots } from "./map-root-effects.ts";
import type { OpenSurfaces } from "./map-root-effects.ts";
import { rowForLocator } from "../surfaces/resources/resources-views.ts";
import type { SurfaceId } from "../surfaces/surface-registry.ts";
import type { MapCore } from "./use-map-core.ts";
import type { MapSession } from "./map-session.ts";
import type { MapStores } from "./use-map-stores.ts";
import type { MapWiring } from "./use-map-wiring.ts";

/** What the effects are given. */
export type EffectsInput = {
  readonly core: MapCore;
  readonly stores: MapStores;
  readonly wiring: MapWiring;
  readonly snapshot: Snapshot;
  readonly api: ExcalidrawImperativeAPI | null;
  readonly bridge: AreaBoardBridge;
  readonly applySnapshot: (snapshot: Snapshot) => void;
};

/** Installs every effect the Map root owns. */
export function useMapEffects(input: EffectsInput): void {
  useSurfaceSync(input);
  useCanvasEffects(input);
  useSurfaceEffects(input);
  useHostEffects(input);
}

/** The effects that keep Excalidraw and the controller in step. */
function useCanvasEffects(input: EffectsInput): void {
  const { core, stores, wiring, snapshot, api } = input;
  const placementKey = placementProjectionKey(stores.placement.placing);

  useEffect(
    /** Mirrors the controller's newest snapshot into React. */
    () => subscribeSnapshots(core.controller, input.applySnapshot),
    [core.controller],
  );

  useEffect(
    /** Installs the Map's one keyboard listener on the host. */
    () => installKeyboardDispatch(core.host, {
      /** What the Map knows at the moment of the press. */
      facts: () => ({
        surfaces: stores.stack,
        editingText: Boolean(core.session.api?.getAppState().editingTextElement),
        selectedArea: selectedVisibleArea(wiring.reads.scene, core.controller.snapshot().selection),
        hasSelectedBlock: selectedBlockOf(core.controller.snapshot(), core.session) !== null,
        hasSelection: liveSelectionIds(core).length > 0,
        findActive: stores.find.query.trim().length > 0,
      }),
      /** The open surface an event target sits inside, or null for the canvas. */
      surfaceOf: (target) => surfaceOfTarget(target),
      /** Keeps the flag rule 1 of `press-meaning.ts` reads. */
      setSpaceHeld: (held) => { core.session.spaceHeld = held; if (held) core.session.spaceDragged = false; },
      /** Whether a pointer dragged while Space was held, which makes the Space press a pan and not a fold. */
      draggedWhileSpaceHeld: () => core.session.spaceDragged,
      /** Keeps the flag rule 5 of `press-meaning.ts` reads, which Excalidraw never reports. */
      setShiftHeld: (held) => { core.session.shiftPress = held; },
      run: wiring.runCommand,
    }),
    [core, stores, wiring],
  );

  useEffect(
    /** Pushes the controller's scene and selection into Excalidraw when it is not already showing them. */
    () => {
      pushProjection({
        api, controller: core.controller, projection: core.projection, pointer: core.pointer, session: core.session, icons: core.icons,
        snapshot,
        placementElements: stores.placement.placing === null ? [] : placementPreviewElements(stores.placement.placing),
        placementKey,
        textEditActive: core.buffer.isActive(),
      });
    },
    [api, core, snapshot, placementKey, stores.placement.placing],
  );

}

/** The effects the surfaces own: the announce clock, the narrow watch and the resource cadence. */
function useSurfaceEffects(input: EffectsInput): void {
  const { core, stores, wiring, snapshot } = input;
  const narrowQuery = `(max-width: ${LAYOUT.narrowBreakpoint}px)`;

  useEffect(
    /** Settles the mount: lower the mount flag, take the keys, and fit the Area the Map opened on. */
    () => {
      if (input.api === null) return;
      settleMount(input.core.session, input.api);
      focusMapCanvas(input.core.host);
      openOnLocatedArea(input);
    },
    [input.api, input.core.session],
  );

  useEffect(
    /** Opens the selected Block when a double click lands on it, and leaves every other one to Excalidraw. */
    () => installBlockDoubleClick(input.core.host, {
      session: input.core.session,
      controller: input.core.controller,
      /** The Block that is the whole live selection now. */
      selectedBlock: () => selectedBlockOf(input.core.controller.snapshot(), input.core.session),
      /** Runs the Block's primary action from the canvas. */
      openBlock: (block, opener) => runPrimaryAction(input, block, opener),
    }),
    [input.core, input.wiring],
  );

  useEffect(
    /** Advances the announce store's clock so every announcement clears. */
    () => installAnnounceClock(stores.dispatchAnnounce),
    [stores.dispatchAnnounce],
  );

  useEffect(
    /** Tracks the width at which the Resources panel becomes a modal sheet. */
    () => {
      const query = globalThis.matchMedia(narrowQuery);
      /** Reports the current width to the panel store. */
      const apply = (): void => stores.dispatchResources({ type: "set-narrow", narrow: query.matches });
      apply();
      query.addEventListener("change", apply);
      return () => query.removeEventListener("change", apply);
    },
    [narrowQuery, stores.dispatchResources],
  );

  useEffect(
    /** Re-reads the Map kinds definition on the shared cadence and installs it. */
    () => readMapKinds(wiring.effects, core.controller),
    [wiring.effects, stores.resources.cadence],
  );

  useEffect(
    /** Re-reads resource facts on the workspace cadence, and the open panel with them. */
    () => installResourceCadence(wiring.effects, core.options.resourceCadenceMs ?? null),
    [wiring.effects, core.options.resourceCadenceMs],
  );

  useEffect(
    /** Resolves the resource Blocks the scene holds, without touching Map authority. */
    () => {
      void resolveSceneResources(wiring.effects, snapshot.composition.scene.elements, stores.resources.cadence);
      if (stores.resources.cadence > 0) void refreshOpenPanel(wiring.effects);
    },
    [wiring.effects, snapshot.revision, stores.resources.cadence],
  );

}

/** The effects the shell around the Map sees: the inert guard, the header notice and the bridge. */
function useHostEffects(input: EffectsInput): void {
  const { core, stores, wiring, snapshot } = input;

  useLayoutEffect(
    /**
     * Makes the shell and the canvas inert while a modal Map surface owns the screen. The Resources
     * panel is declared a panel, but at narrow widths it is shown as a sheet, and a sheet is modal.
     * A layout effect, so the inert attributes change in the same paint as the dialog that needs them.
     */
    () => installInertGuard(core.host, hasModalSurface(stores.stack) || (stores.stack.includes("resources") && stores.resources.narrow)),
    [core.host, stores.stack, stores.resources.narrow],
  );

  // The five values the shell is told about, computed in the render so the effect below can depend
  // on the values themselves. `snapshot` is a new object on every controller notify and
  // `wiring.reads.scene` is rebuilt on every render, so an effect keyed on those reports the same
  // view state again on every render, and every report makes the shell rebuild its whole Map context
  // bar from innerHTML. The Map reports its view state when the view state changes, not when it renders.
  const { locatedArea, restrictionArea, nextEscape } = snapshot;
  const selectedArea = selectedVisibleArea(wiring.reads.scene, snapshot.selection) ?? "";
  const findOpen = stores.stack.includes("find");

  useEffect(
    /** Keeps the shell header aligned without moving Map state into the shell. */
    () => {
      core.options.onViewState?.({ locatedArea, selectedArea, restrictionArea, findOpen, nextEscape });
    },
    [core.options, locatedArea, selectedArea, restrictionArea, findOpen, nextEscape],
  );

  useEffect(
    /** Installs the bridge the host holds while the Map is mounted. */
    () => installBridge(input),
  );

  useEffect(
    /** Flushes and destroys a controller the Map created for itself. */
    () => () => {
      core.pointer.settle();
      if (core.owned) void Promise.resolve(core.controller.flush()).catch(() => null).finally(() => core.controller.destroy());
    },
    [core],
  );
}

/** The surfaces whose own store says whether they are open, in the order the stack should hold them. */
function openSurfacesOf(input: EffectsInput): OpenSurfaces {
  const { stores, snapshot } = input;
  const draft = snapshot.draft;
  return new Map<SurfaceId, boolean>([
    ["resources", stores.resources.open],
    ["resourceDetails", stores.resources.open && rowForLocator(stores.resources.projection, stores.resources.details ?? undefined) !== null],
    ["resourceEditor", stores.resources.editor !== null && !stores.resources.editor.hidden],
    ["transaction", stores.resources.sceneBusy !== null],
    ["resourceRecovery", stores.resources.recovery !== null],
    ["sceneRecovery", stores.resources.sceneRecovery !== null],
    ["placement", stores.placement.placing !== null],
    ["picker", stores.picker.target !== null],
    ["find", stores.find.open],
    ["mapRecovery", draft !== null && draft.restored !== true],
  ]);
}

/**
 * Keeps the surface stack in step with the stores that own each surface's own state. A layout
 * effect, so the stack catches up before the browser paints: a dialog that left the DOM with its
 * store is off the stack, and the inert guard that keys on the stack lifts, in the same paint.
 */
function useSurfaceSync(input: EffectsInput): void {
  const open = openSurfacesOf(input);
  useLayoutEffect(
    /** Opens or closes each store-owned surface on the stack. */
    () => reconcileSurfaces(input.stores.stack, open, input.stores.dispatchStack),
  );
}

/**
 * Fits the Area the Map opened on, unless the controller restored a private view. The fit also
 * starts the deferred shard loads around that Area, which is why it runs even when the camera is
 * already where it should be.
 */
function openOnLocatedArea(input: EffectsInput): void {
  const snapshot = input.core.controller.snapshot();
  if (snapshot.viewRestored) return;
  const element = input.core.controller.fitArea(snapshot.locatedArea, { push: false, select: false });
  if (element === null) return;
  requestAnimationFrame(() => requestAnimationFrame(() => input.wiring.reads.scrollTo([element], false)));
}

/** Runs one Block's primary action, when it has one. */
function runPrimaryAction(input: EffectsInput, block: SceneElement, opener: HTMLElement): void {
  const facts = input.wiring.reads.view.resolveBlock(block);
  const action = facts?.primaryAction;
  if (facts === null || facts === undefined || action === null || action === undefined) return;
  input.wiring.reads.runAction(facts, action, opener);
}

/** The ids Excalidraw holds selected, or the controller's selection before Excalidraw has mounted. */
function liveSelectionIds(core: MapCore): readonly RuntimeId[] {
  const appState = core.session.api?.getAppState();
  return appState === undefined ? [...core.controller.snapshot().selection] : selectedIds(appState);
}

/** The Block that is the whole live selection, or null. */
function selectedBlockOf(snapshot: Snapshot, session: MapSession): SceneElement | null {
  const appState = session.api?.getAppState();
  const ids = appState === undefined ? snapshot.selection : selectedIds(appState);
  return selectedMapEntityElement(snapshot.composition.scene.elements, ids);
}

/** The open surface an event target sits inside, from the class the surface renders. */
function surfaceOfTarget(target: EventTarget | null): "resources" | "find" | "outline" | "picker" | "help" | null {
  if (target === null || !(target instanceof Element)) return null;
  if (target.closest(".tangent-map-resources")) return "resources";
  if (target.closest(".tangent-map-find")) return "find";
  if (target.closest(".tangent-map-outline")) return "outline";
  if (target.closest(".tangent-map-picker")) return "picker";
  if (target.closest(".tangent-map-help")) return "help";
  return null;
}

/** Fills in the bridge the host and the browser suites call. */
function installBridge(input: EffectsInput): () => void {
  const { core, bridge, wiring } = input;
  bridge.setSaveState = null;
  bridge.current = () => core.controller.snapshot().composition.scene;
  bridge.rendered = () => (core.session.api?.getSceneElements() ?? null) as readonly SceneElement[] | null;
  bridge.appState = () => core.session.api?.getAppState() ?? null;
  bridge.controller = core.controller;
  bridge.fitArea = (area: AreaKey, settings) => fitArea(wiring.commands, area, settings?.push ?? true, settings?.select ?? true);
  bridge.navigateArea = (area: AreaKey, settings) => fitArea(wiring.commands, area, settings?.push ?? true, settings?.select ?? true);
  bridge.selectArea = (area: AreaKey) => core.controller.selectArea(area);
  bridge.openFind = () => wiring.commands.openFind();
  bridge.toggleRestriction = (area?: AreaKey) => wiring.commands.toggleRestriction(area ?? null);
  bridge.escape = () => wiring.escape();
  bridge.flush = async () => {
    core.pointer.settle();
    await core.pointer.waitForSettle();
    return core.controller.flush();
  };
  bridge.refreshFacts = (documentsOrFocus?: unknown, maybeFocus?: Focus) =>
    core.controller.refreshFacts(maybeFocus ?? (Array.isArray(documentsOrFocus) ? core.controller.snapshot().focus : documentsOrFocus as Focus));
  bridge.setFocus = (focus: Focus | null) => core.controller.setFocus(focus);
  bridge.reload = () => core.controller.reload();
  bridge.keepMine = () => core.controller.keepMine();
  bridge.captureView = () => core.controller.captureView();
  bridge.restoreView = (value) => core.controller.restoreView(value);
  bridge.moveFocus = () => focusMapCanvas(core.host);
  return () => {
    bridge.controller = null;
    bridge.rendered = () => null;
  };
}
