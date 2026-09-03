// What the Map does when a key is routed to it, and the few actions the toolbar shares with it.
//
// `input/keyboard-dispatch.ts` decides which key belongs to the Map and hands over one `KeyCommand`.
// This file runs them. Nothing here reads an event: every command is a value, so the Outline button
// and the Outline key run exactly the same code, and a test can run a command with no DOM.

import { CANVAS_ANNOUNCEMENTS } from "../copy.ts";
import type { TextEditBuffer } from "../canvas/text-edit.ts";
import type { Projection } from "../canvas/projection.ts";
import { visibleSceneFromSnapshot } from "../input/hit-test.ts";
import type { KeyCommand } from "../input/key-routes.ts";
import { nudgeSelection } from "../input/nudge.ts";
import { PointerSession } from "../input/pointer-session.ts";
import { areaForBlock, selectedMapEntityElement } from "../kernel/kernel-boundary.ts";
import type { AreaMapController, MapEntityFacts, SceneElement } from "../kernel/kernel-types.ts";
import type { BlockActions } from "./map-runtime.ts";
import { areaKey } from "../units/ids.ts";
import type { AreaKey } from "../units/ids.ts";
import type { MapSession } from "./map-session.ts";

/** Everything a command needs. Each field is one door out of this module. */
export type CommandDeps = BlockActions & {
  readonly controller: AreaMapController;
  readonly session: MapSession;
  readonly pointer: PointerSession;
  readonly projection: Projection;
  readonly buffer: TextEditBuffer;
  readonly announce: (text: string) => void;
  /** The display name of one Area: its document title, else its leaf. */
  readonly areaName: (area: AreaKey) => string;
  /** Resolves one Block element into the facts every surface shares. */
  readonly resolveBlock: (element: SceneElement) => MapEntityFacts | null;
  /** Runs the Map's Escape order and reports what it closed. */
  readonly escape: () => { readonly kind: string };
  /** Opens Find, the picker, Help and the Outline through their own effects. */
  readonly openFind: () => void;
  readonly openHelp: () => void;
  readonly openPicker: () => void;
  readonly toggleOutline: () => void;
  /** Steps Find to the next or previous match. */
  readonly stepFind: (direction: "next" | "previous") => void;
  /** Publishes the text Excalidraw buffered after it consumed a finishing key. */
  readonly finishTextEdit: () => void;
  /** Commits or moves the open placement from the keyboard. */
  readonly commitPlacement: () => void;
  readonly nudgePlacement: (command: Extract<KeyCommand, { kind: "move-placement" }>) => void;
  /** Scrolls Excalidraw so the elements fit the view. */
  readonly scrollTo: (elements: readonly SceneElement[], animate: boolean) => void;
  /** Toggles the Only restriction on one Area. */
  readonly toggleRestriction: (area: AreaKey | null) => void;
};

/** The leaf name of one Area key, the word the announcements use for it. */
function leafOf(area: AreaKey): string {
  return area.split("/").at(-1) ?? area;
}

/** The Block that is the whole live selection, or null. */
export function selectedBlock(deps: CommandDeps): SceneElement | null {
  const snapshot = deps.controller.snapshot();
  return selectedMapEntityElement(snapshot.composition.scene.elements, snapshot.selection);
}

/** Fits one Area and announces that it is in view. */
export function fitArea(deps: CommandDeps, area: AreaKey, push: boolean, select: boolean): SceneElement | null {
  const element = deps.controller.navigateArea(area, { push, select });
  if (element === null) return null;
  if (select) {
    deps.session.programmaticSelection = new Set([element.id]);
    deps.projection.project({ selection: [element.id] }, "camera-selection");
  }
  deps.scrollTo([element], true);
  deps.announce(CANVAS_ANNOUNCEMENTS.inView(leafOf(area)));
  return element;
}

/** Folds or unfolds one Area and announces the view action. */
export function changeFold(deps: CommandDeps, area: AreaKey): void {
  const folded = deps.controller.toggleFold(area);
  if (folded === null) {
    deps.announce(CANVAS_ANNOUNCEMENTS.mustStayOpen(leafOf(area), leafOf(deps.controller.snapshot().restrictionArea ?? area)));
    return;
  }
  deps.announce(CANVAS_ANNOUNCEMENTS.fold(leafOf(area), folded));
}

/** Runs the primary or the read action of the selected Block. */
function openSelectedBlock(deps: CommandDeps, verb: "open" | "read"): void {
  const block = selectedBlock(deps);
  const facts = block === null ? null : deps.resolveBlock(block);
  const action = verb === "read" ? facts?.readAction : facts?.primaryAction;
  if (facts === null || facts === undefined || action === null || action === undefined) return;
  deps.runAction(facts, action, null);
}

/** Moves the selection by one arrow step through the same session a pointer drag opens. */
function runNudge(deps: CommandDeps, command: Extract<KeyCommand, { kind: "nudge-selection" }>): void {
  const snapshot = deps.controller.snapshot();
  const result = nudgeSelection(deps.pointer, {
    scene: visibleSceneFromSnapshot(snapshot),
    selection: snapshot.selection,
    delta: command.delta,
  });
  deps.session.actionKind = "nudge";
  if (result.kind === "area" && result.preview !== null) deps.projection.project({ elements: result.preview.elements }, "claimed-nudge");
  else if (result.kind === "elements") deps.projection.project({ elements: result.elements }, "claimed-nudge");
}

/** The Area an Only toggle targets: the selected one, else the located one. */
function restrictionTarget(deps: CommandDeps, area: AreaKey | null): AreaKey {
  return area ?? deps.controller.snapshot().locatedArea;
}

/** Runs one routed key command. */
export function runKeyCommand(deps: CommandDeps, command: KeyCommand): void {
  switch (command.kind) {
    case "escape": deps.escape(); return;
    case "open-find": deps.openFind(); return;
    case "open-help": deps.openHelp(); return;
    case "open-picker": deps.openPicker(); return;
    case "toggle-outline": deps.toggleOutline(); return;
    case "undo": deps.controller.undo(); return;
    case "redo": deps.controller.redo(); return;
    case "nudge-selection": runNudge(deps, command); return;
    case "commit-placement": deps.commitPlacement(); return;
    case "move-placement": deps.nudgePlacement(command); return;
    case "finish-text-edit": deps.finishTextEdit(); return;
    case "fit-selected-area": fitArea(deps, command.area, true, true); return;
    case "fold-selected-area": changeFold(deps, command.area); return;
    case "refuse-area-delete": deps.announce(CANVAS_ANNOUNCEMENTS.outlinesFromTree); return;
    case "open-selected-block": openSelectedBlock(deps, command.verb); return;
    case "hide-selected-block": {
      const block = selectedBlock(deps);
      if (block !== null) deps.hideBlock(block);
      return;
    }
    case "toggle-only": deps.toggleRestriction(restrictionTarget(deps, command.area)); return;
    case "step-find": deps.stepFind(command.direction); return;
    case "expect-excalidraw-command": deps.session.actionKind = command.word; return;
  }
}

/** The Area a Block belongs to, for the toolbar and the Resources button. */
export function areaOfBlock(deps: CommandDeps, block: SceneElement | null): AreaKey | "" {
  if (block === null) return "";
  const owner = block.customData?.tangentWorld?.owner === undefined ? undefined : areaKey(block.customData.tangentWorld.owner);
  return owner ?? areaForBlock(block);
}
