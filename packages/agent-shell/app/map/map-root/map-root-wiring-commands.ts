// The key commands and the Escape order of the Map root.
//
// `use-map-wiring.ts` assembles the records every module declared; this file holds the two of them
// that are decisions rather than plumbing. `buildCommandDeps` is what one routed key runs against,
// and `buildEscape` is the Map's Escape order: the open placement, then the top surface, then a
// Show on Map layer, then the canvas.

import { CANVAS_ANNOUNCEMENTS } from "../copy.ts";
import { browserSettle, finishBufferedTextEdit } from "../canvas/text-edit.ts";
import { asSceneElements } from "../canvas/projection.ts";
import { cancelFind, openFind, stepFind } from "../surfaces/find/find-effects.ts";
import { openPicker } from "../surfaces/picker/picker-effects.ts";
import { cancelPlacement, commitPlacement, movePlacement, returnFromShow } from "../surfaces/placement/placement-effects.ts";
import { closeResourceDetails, closeResourceRecovery, closeSceneRecovery, holdResourceDraft } from "../surfaces/resources/resource-actions.ts";
import type { SurfaceId } from "../surfaces/surface-registry.ts";
import { translate } from "../units/scalar-math.ts";
import type { AreaKey } from "../units/ids.ts";
import { mapCanvasElement } from "../ui/canvas-focus.ts";
import { publishToWorld } from "./map-publish.ts";
import type { PublishDeps } from "./map-publish.ts";
import { targetArea } from "./map-runtime.ts";
import type { RuntimeReads } from "./map-runtime.ts";
import { buildFindEnvironment, buildPickerEnvironment, buildPlacementPorts } from "./map-runtime-surfaces.ts";
import type { SurfaceInput } from "./map-runtime-surfaces.ts";
import { runKeyCommand } from "./map-root-commands.ts";
import type { CommandDeps } from "./map-root-commands.ts";
import type { WiringInput } from "./use-map-wiring.ts";

/** Builds the record every routed key command runs against. */
export function buildCommandDeps(input: WiringInput, reads: RuntimeReads, publish: PublishDeps, surfaces: SurfaceInput, openSurface: (id: SurfaceId, opener?: HTMLElement | null) => void, closeSurface: (id: SurfaceId) => void): CommandDeps {
  const { core, stores } = input;
  return {
    controller: core.controller,
    session: core.session,
    pointer: core.pointer,
    projection: core.projection,
    buffer: core.buffer,
    /** Speaks and shows one sentence. */
    announce: (text: string) => reads.announce(text),
    areaName: reads.view.areaName,
    resolveBlock: reads.view.resolveBlock,
    runAction: reads.runAction,
    hideBlock: reads.hideBlock,
    openSurface,
    closeSurface,
    /** Replaced by the caller with the Map's own Escape order. */
    escape: () => ({ kind: "back" }),
    /** Opens Find and records the view Cancel restores. */
    openFind: () => {
      openFind(buildFindEnvironment(surfaces));
      openSurface("find");
    },
    /** Opens the keys dialog, with the canvas as the control focus returns to. */
    openHelp: () => openSurface("help", mapCanvasElement(core.host)),
    /** Opens the picker at the placement spot. */
    openPicker: () => {
      openPicker(buildPickerEnvironment(surfaces));
      openSurface("picker");
    },
    /** Opens or closes the Outline. */
    toggleOutline: () => {
      if (stores.stack.includes("outline")) closeSurface("outline");
      else openSurface("outline");
    },
    /** Steps Find to the next or previous match. */
    stepFind: (direction) => stepFind(buildFindEnvironment(surfaces), stores.find, direction),
    /** Publishes the text Excalidraw buffered after a finishing key. */
    finishTextEdit: () => finishBufferedTextEdit({
      buffer: core.buffer,
      /** The api the forced finish reads Excalidraw's settled elements from. */
      api: () => core.session.api,
      settle: browserSettle,
      /** Runs the publish a natural close would have run. */
      onChange: (elements, appState) => publishToWorld(publish, asSceneElements(elements), { ...appState, editingTextElement: null }),
    }),
    /** Commits the open placement from the keyboard. */
    commitPlacement: () => { commitPlacement(buildPlacementPorts(surfaces), stores.placement, null, "key"); },
    /** Moves the open placement preview by one arrow step. */
    nudgePlacement: (command) => {
      const placing = stores.placement.placing;
      if (placing === null) return;
      movePlacement(buildPlacementPorts(surfaces), stores.placement, translate(placing.point, command.delta));
    },
    /** Scrolls Excalidraw so the elements fit the view. */
    scrollTo: (elements, animate) => reads.scrollTo(elements, animate && !reads.reducedMotion()),
    /** Toggles the Only restriction on one Area. */
    toggleRestriction: (area) => toggleRestriction(input, reads, area),
  };
}

/** Toggles the ancestor-and-descendant restriction and announces what it did. */
function toggleRestriction(input: WiringInput, reads: RuntimeReads, area: AreaKey | null): void {
  const result = input.core.controller.toggleRestriction(area ?? targetArea(input.snapshot, reads.scene));
  if (result.active && result.element) reads.scrollTo([result.element], !reads.reducedMotion());
  reads.announce(result.active && result.area !== null
    ? CANVAS_ANNOUNCEMENTS.only(reads.view.areaName(result.area), result.excludedCount)
    : CANVAS_ANNOUNCEMENTS.wholeMap);
}

/** The Map's Escape order: the top surface, then a Show on Map layer, then the canvas. */
export function buildEscape(input: WiringInput, surfaces: SurfaceInput, commands: CommandDeps): () => { readonly kind: string } {
  const { stores, core } = input;
  return () => {
    if (stores.placement.placing !== null) {
      cancelPlacement(buildPlacementPorts(surfaces), stores.placement);
      return { kind: "placement" };
    }
    const top = stores.stack.at(-1);
    if (top !== undefined) {
      closeTopSurface(input, surfaces, commands, top);
      return { kind: top };
    }
    if (stores.placement.locating !== null) {
      returnFromShow(buildPlacementPorts(surfaces), stores.placement);
      return { kind: "resource-locate" };
    }
    return { kind: core.controller.escape().kind };
  };
}

/** Closes the surface Escape reached, through the command each surface declared. */
function closeTopSurface(input: WiringInput, surfaces: SurfaceInput, commands: CommandDeps, top: SurfaceId): void {
  const { stores, effects } = { ...input, effects: surfaces.resourceEffects };
  if (top === "find") cancelFind(buildFindEnvironment(surfaces), stores.find);
  else if (top === "picker") stores.dispatchPicker({ kind: "close" });
  else if (top === "resources") stores.dispatchResources({ type: "close" });
  else if (top === "resourceDetails") closeResourceDetails(effects);
  else if (top === "resourceEditor") holdResourceDraft(effects, true);
  else if (top === "resourceRecovery") closeResourceRecovery(effects);
  else if (top === "sceneRecovery") closeSceneRecovery(effects);
  void commands;
  stores.dispatchStack({ type: "escape" });
}

