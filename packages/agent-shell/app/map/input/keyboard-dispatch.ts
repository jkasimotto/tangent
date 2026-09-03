// The one keydown listener of the Map. It sits on the host element in the capture phase, so it
// runs before Excalidraw's own document listener and before any control inside the Map, and it
// receives keys the browser suites dispatch on the host itself. It gathers what the event said
// into a `KeyPress`, asks `MapRoot.tsx` what the Map knows through `deps.facts()`, hands both to
// `key-routes.ts`, and acts on the decision: consume the event as the route says and run the
// command through `deps.run`. It also keeps the Space flag `press-meaning.ts` reads, so a
// Space-drag is a pan before any selection logic runs. The keyboard-confinement lint allows a
// host, document or window key listener in this file only.

import { keyboardEventIsComposing } from "../kernel/kernel-boundary.ts";
import type { SurfaceId } from "../surfaces/surface-registry.ts";
import { modifiersOf } from "../ui/key-bindings.ts";
import { routeKey } from "./key-routes.ts";
import type { KeyCommand, KeyDecision, KeyFacts, KeyPress } from "./key-routes.ts";

/** What the dispatcher needs from the Map root. Every function is read at the moment of the press, never cached. */
export type KeyboardDeps = {
  /** What the Map knows now: the open surfaces, the text edit, the selection, Find. */
  readonly facts: () => KeyFacts;
  /** The open surface an event target sits inside, or null for the canvas and the host. */
  readonly surfaceOf: (target: EventTarget | null) => SurfaceId | null;
  /** Told true on the first keydown of Space and false on its keyup or when the window loses focus. */
  readonly setSpaceHeld: (held: boolean) => void;
  /**
   * Told whether Shift is held, on every key event and on blur. Excalidraw's own pointer state
   * carries Cmd and Ctrl but never Shift, and Shift is what makes a press additive, so the Map has
   * to keep the flag itself. Optional, because the rollback editor has no additive selection.
   */
  readonly setShiftHeld?: ((held: boolean) => void) | undefined;
  /** Runs one routed command. */
  readonly run: (command: KeyCommand) => void;
  /** Called with every decision, for a diagnostic or a test. Optional. */
  readonly observe?: ((press: KeyPress, decision: KeyDecision) => void) | undefined;
};

/** The parts of a key event the dispatcher reads, so a test can hand it a plain object. */
export type KeyEventInput = Pick<KeyboardEvent, "key" | "code" | "shiftKey" | "metaKey" | "ctrlKey" | "altKey" | "repeat" | "isComposing" | "target" | "preventDefault" | "stopPropagation">;

/** The host the listeners are installed on: an element, or a plain object with the same listener methods in a test. */
export type KeyboardHost = Pick<HTMLElement, "addEventListener" | "removeEventListener"> & { readonly ownerDocument?: Pick<Document, "defaultView"> | null | undefined };

const SPACE_CODE = "Space";
const SPACE_KEY = " ";
const TEXT_ENTRY_SELECTOR = "input, textarea, select";

/** Removes the listeners `installKeyboardDispatch` added. */
export type UninstallKeyboardDispatch = () => void;

/** True when the key was typed into a text field, a select, or an editable element. Duck-typed so a test needs no DOM. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== "object" || !("matches" in target)) return false;
  const element = target as Partial<Pick<HTMLElement, "matches" | "isContentEditable">>;
  return element.matches?.(TEXT_ENTRY_SELECTOR) === true || element.isContentEditable === true;
}

/** True for the Space key by name or by physical code. */
function isSpace(event: KeyEventInput): boolean {
  return event.key === SPACE_KEY || event.code === SPACE_CODE;
}

/** Gathers what one event said into the shape the routes read. */
export function pressOf(event: KeyEventInput, targetSurface: SurfaceId | null): KeyPress {
  return {
    key: isSpace(event) ? SPACE_KEY : event.key,
    modifiers: modifiersOf(event),
    repeat: event.repeat,
    composing: keyboardEventIsComposing(event),
    targetIsTextEntry: isTextEntryTarget(event.target),
    targetSurface
  };
}

/** Takes as much of the event as the decision says. */
function consume(event: KeyEventInput, decision: KeyDecision): void {
  if (decision.owner !== "map" || decision.consume === "none") return;
  event.preventDefault();
  if (decision.consume === "stop") event.stopPropagation();
}

/** Routes one keydown and acts on the decision. Exported so a test can drive it without listeners. */
export function dispatchKeydown(event: KeyEventInput, deps: KeyboardDeps): KeyDecision {
  const press = pressOf(event, deps.surfaceOf(event.target));
  deps.setShiftHeld?.(press.modifiers.shiftKey);
  if (press.key === SPACE_KEY && !press.repeat && !press.targetIsTextEntry) deps.setSpaceHeld(true);
  const decision = routeKey(press, deps.facts());
  deps.observe?.(press, decision);
  consume(event, decision);
  if (decision.owner === "map") deps.run(decision.command);
  return decision;
}

/** Clears the Space flag when Space comes up. */
export function dispatchKeyup(event: KeyEventInput, deps: KeyboardDeps): void {
  deps.setShiftHeld?.(event.shiftKey);
  if (isSpace(event)) deps.setSpaceHeld(false);
}

/**
 * Installs the Map's key listeners on the host and returns the function that removes them. Keydown
 * and keyup are capture-phase listeners on the host, as the old component installed them, so they
 * run before every control inside the Map and see keys dispatched on the host itself. The window's
 * blur clears the Space flag, because a keyup never arrives once focus has left the page.
 */
export function installKeyboardDispatch(host: KeyboardHost, deps: KeyboardDeps): UninstallKeyboardDispatch {
  /** The keydown listener. */
  const onKeydown = (event: KeyboardEvent): void => {
    dispatchKeydown(event, deps);
  };
  /** The keyup listener. */
  const onKeyup = (event: KeyboardEvent): void => {
    dispatchKeyup(event, deps);
  };
  /** The window blur listener. */
  const onBlur = (): void => {
    deps.setSpaceHeld(false);
    deps.setShiftHeld?.(false);
  };
  const view = host.ownerDocument?.defaultView ?? null;
  host.addEventListener("keydown", onKeydown, true);
  host.addEventListener("keyup", onKeyup, true);
  view?.addEventListener("blur", onBlur);
  return () => {
    host.removeEventListener("keydown", onKeydown, true);
    host.removeEventListener("keyup", onKeyup, true);
    view?.removeEventListener("blur", onBlur);
    deps.setSpaceHeld(false);
    deps.setShiftHeld?.(false);
  };
}
