// Every effect the Map root installs, in one hook.
//
// The controller subscription, the one keyboard listener, the projection push, the announce clock,
// the narrow-width watch, the resource cadence, the shell inert guard and the bridge the host holds
// are each one `useEffect` here, so `MapRoot.tsx` stays the composition and this file stays the
// lifecycle. Nothing here renders.

import { useEffect } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
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
import type { AreaKey } from "../units/ids.ts";
import { placementPreviewElements, placementProjectionKey } from "../surfaces/placement/placement-effects.ts";
import { installAnnounceClock, installInertGuard, pushProjection, readMapKinds, reconcileSurfaces, settleMount, subscribeSnapshots } from "./map-root-effects.ts";
import type { OpenSurfaces } from "./map-root-effects.ts";
import { rowForLocator } from "../surfaces/resources/resources-views.ts";
import type { SurfaceId } from "../surfaces/surface-registry.ts";
import type { MapCore } from "./use-map-core.ts";
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
        hasSelectedBlock: selectedBlockOf(core.controller.snapshot()) !== null,
        hasSelection: core.controller.snapshot().selection.size > 0,
        findActive: stores.find.query.trim().length > 0,
      }),
      /** The open surface an event target sits inside, or null for the canvas. */
      surfaceOf: (target) => surfaceOfTarget(target),
      /** Keeps the flag rule 1 of `press-meaning.ts` reads. */
      setSpaceHeld: (held) => { core.session.spaceHeld = held; },
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
    () => installResourceCadence(wiring.effects, null),
    [wiring.effects],
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

  useEffect(
    /** Makes the shell and the canvas inert while a modal Map surface owns the screen. */
    () => installInertGuard(core.host, hasModalSurface(stores.stack)),
    [core.host, stores.stack],
  );

  useEffect(
    /** Keeps the shell header aligned without moving Map state into the shell. */
    () => {
      core.options.onViewState?.({
        locatedArea: snapshot.locatedArea,
        selectedArea: selectedVisibleArea(wiring.reads.scene, snapshot.selection) ?? "",
        restrictionArea: snapshot.restrictionArea,
        findOpen: stores.stack.includes("find"),
        nextEscape: snapshot.nextEscape,
      });
    },
    [core.options, snapshot, stores.stack, wiring.reads.scene],
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

/** Keeps the surface stack in step with the stores that own each surface's own state. */
function useSurfaceSync(input: EffectsInput): void {
  const open = openSurfacesOf(input);
  useEffect(
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

/** The Block that is the whole live selection, or null. */
function selectedBlockOf(snapshot: Snapshot): SceneElement | null {
  return selectedMapEntityElement(snapshot.composition.scene.elements, snapshot.selection);
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
