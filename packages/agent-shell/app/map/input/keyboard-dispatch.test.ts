import { strict as assert } from "node:assert";
import { test } from "node:test";
import { EMPTY_SURFACE_STACK } from "../surfaces/surface-stack.ts";
import type { SurfaceId } from "../surfaces/surface-registry.ts";
import { areaKey } from "../units/ids.ts";
import { dispatchKeydown, dispatchKeyup, installKeyboardDispatch, isTextEntryTarget, pressOf } from "./keyboard-dispatch.ts";
import type { KeyEventInput, KeyboardDeps, KeyboardHost } from "./keyboard-dispatch.ts";
import type { KeyCommand, KeyDecision, KeyFacts, KeyPress } from "./key-routes.ts";

/** A fake element that answers `matches` and `isContentEditable` the way the dispatcher asks. */
type FakeTarget = { matches: (selector: string) => boolean; isContentEditable: boolean; surface?: SurfaceId };

/** A fake key event that records whether its default was prevented and its propagation stopped. */
type FakeEvent = KeyEventInput & { prevented: boolean; stopped: boolean };

/** Builds a fake key event on the host or on a given target. */
function fakeEvent(key: string, overrides: Partial<Omit<FakeEvent, "preventDefault" | "stopPropagation">> = {}): FakeEvent {
  const event: FakeEvent = {
    key,
    code: key === " " ? "Space" : key,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    repeat: false,
    isComposing: false,
    target: null,
    prevented: false,
    stopped: false,
    /** Records the prevented default. */
    preventDefault() {
      event.prevented = true;
    },
    /** Records the stopped propagation. */
    stopPropagation() {
      event.stopped = true;
    },
    ...overrides
  };
  return event;
}

/** A fake target: a text field, an editable element, or a plain element, optionally inside a surface. */
function fakeTarget(kind: "field" | "editable" | "plain", surface?: SurfaceId): EventTarget {
  const target: FakeTarget = {
    /** True only for the fake text field, which is the question the dispatcher's selector test asks. */
    matches: () => kind === "field",
    isContentEditable: kind === "editable"
  };
  if (surface !== undefined) target.surface = surface;
  return target as unknown as EventTarget;
}

/** The record one fake deps object keeps. */
type Recorded = { commands: KeyCommand[]; space: boolean[]; shift: boolean[]; decisions: KeyDecision[]; presses: KeyPress[] };

/** Fake deps over fixed facts that record every call. */
function fakeDeps(facts: Partial<KeyFacts> = {}): KeyboardDeps & { recorded: Recorded } {
  const recorded: Recorded = { commands: [], space: [], shift: [], decisions: [], presses: [] };
  return {
    recorded,
    /** The fixed facts. */
    facts: () => ({ surfaces: EMPTY_SURFACE_STACK, editingText: false, selectedArea: null, hasSelectedBlock: false, hasSelection: false, findActive: false, ...facts }),
    /** Reads the surface a fake target carries. */
    surfaceOf: (target) => (target as unknown as FakeTarget | null)?.surface ?? null,
    /** Records the Space flag. */
    setSpaceHeld: (held) => {
      recorded.space.push(held);
    },
    /** Records the Shift flag. */
    setShiftHeld: (held) => {
      recorded.shift.push(held);
    },
    /** Records the command. */
    run: (command) => {
      recorded.commands.push(command);
    },
    /** Records the decision. */
    observe: (press, decision) => {
      recorded.presses.push(press);
      recorded.decisions.push(decision);
    }
  };
}

test("a text field, a select and an editable element are text entry targets; the host and the canvas are not", () => {
  assert.equal(isTextEntryTarget(fakeTarget("field")), true);
  assert.equal(isTextEntryTarget(fakeTarget("editable")), true);
  assert.equal(isTextEntryTarget(fakeTarget("plain")), false);
  assert.equal(isTextEntryTarget(null), false);
});

test("pressOf reads the key, the modifiers, the repeat, the composition, the target and the surface", () => {
  const press = pressOf(fakeEvent("b", { metaKey: true, repeat: true, target: fakeTarget("field", "find") }), "find");
  assert.deepEqual(press, { key: "b", modifiers: { shiftKey: false, metaKey: true, ctrlKey: false, altKey: false }, repeat: true, composing: false, targetIsTextEntry: true, targetSurface: "find" });
  assert.equal(pressOf(fakeEvent("Process"), null).composing, true);
  assert.equal(pressOf(fakeEvent("Spacebar", { code: "Space" }), null).key, " ", "the physical Space code normalises the key");
});

test("a routed key is consumed as the route says and its command runs", () => {
  const deps = fakeDeps();
  const event = fakeEvent("b");
  const decision = dispatchKeydown(event, deps);
  assert.equal(decision.owner, "map");
  assert.deepEqual(deps.recorded.commands, [{ kind: "open-picker" }]);
  assert.deepEqual({ prevented: event.prevented, stopped: event.stopped }, { prevented: true, stopped: true });
});

test("a native key is left untouched and runs nothing", () => {
  const deps = fakeDeps();
  const event = fakeEvent("r");
  dispatchKeydown(event, deps);
  assert.deepEqual(deps.recorded.commands, []);
  assert.deepEqual({ prevented: event.prevented, stopped: event.stopped }, { prevented: false, stopped: false });
});

test("Space sets the flag on its first keydown, folds a selected Area with only the default prevented, and clears on keyup", () => {
  const deps = fakeDeps({ selectedArea: areaKey("otto"), hasSelection: true });
  const down = fakeEvent(" ");
  dispatchKeydown(down, deps);
  assert.deepEqual(deps.recorded.space, [true]);
  assert.deepEqual(deps.recorded.commands, [{ kind: "fold-selected-area", area: areaKey("otto") }]);
  assert.deepEqual({ prevented: down.prevented, stopped: down.stopped }, { prevented: true, stopped: false }, "Excalidraw still sees Space held for the pan");
  dispatchKeydown(fakeEvent(" ", { repeat: true }), deps);
  assert.deepEqual(deps.recorded.space, [true], "a repeat does not set the flag again");
  assert.equal(deps.recorded.commands.length, 1, "a repeat does not fold again");
  dispatchKeyup(fakeEvent(" "), deps);
  assert.deepEqual(deps.recorded.space, [true, false]);
});

test("Space typed into a text field never sets the flag", () => {
  const deps = fakeDeps();
  dispatchKeydown(fakeEvent(" ", { target: fakeTarget("field") }), deps);
  assert.deepEqual(deps.recorded.space, []);
});

test("the surface an event target sits inside reaches the routes", () => {
  const deps = fakeDeps({ surfaces: ["resources"] });
  const inside = fakeEvent("Enter", { target: fakeTarget("plain", "resources") });
  assert.deepEqual(dispatchKeydown(inside, deps), { owner: "surface", surface: "resources" });
  assert.equal(inside.prevented, false);
  const beside = fakeEvent("b", { target: fakeTarget("plain") });
  assert.equal(dispatchKeydown(beside, deps).owner, "map");
});

test("install adds capture-phase keydown and keyup listeners on the host and a blur listener on its window; uninstall removes them", () => {
  const listeners: { where: string; type: string; capture: boolean | AddEventListenerOptions | undefined }[] = [];
  const removed: { where: string; type: string }[] = [];
  /** A fake listener target that records what is added and removed. */
  function fakeNode(where: string): KeyboardHost {
    return {
      /** Records the added listener. */
      addEventListener: (type: string, _listener: unknown, capture?: boolean | AddEventListenerOptions) => {
        listeners.push({ where, type, capture });
      },
      /** Records the removed listener. */
      removeEventListener: (type: string) => {
        removed.push({ where, type });
      }
    } as unknown as KeyboardHost;
  }
  const view = fakeNode("window");
  const host: KeyboardHost = { ...fakeNode("host"), ownerDocument: { defaultView: view as unknown as Window & typeof globalThis } };
  const deps = fakeDeps();
  const uninstall = installKeyboardDispatch(host, deps);
  assert.deepEqual(listeners, [
    { where: "host", type: "keydown", capture: true },
    { where: "host", type: "keyup", capture: true },
    { where: "window", type: "blur", capture: undefined }
  ]);
  uninstall();
  assert.deepEqual(removed, [{ where: "host", type: "keydown" }, { where: "host", type: "keyup" }, { where: "window", type: "blur" }]);
  assert.deepEqual(deps.recorded.space, [false], "uninstall clears the Space flag");
});

test("install works on a host with no window, as in a test", () => {
  const host = {
    /** Accepts a listener and keeps nothing: this host only proves uninstall is safe with no window. */
    addEventListener: () => undefined,
    /** Drops a listener and keeps nothing, as above. */
    removeEventListener: () => undefined
  } as unknown as KeyboardHost;
  const uninstall = installKeyboardDispatch(host, fakeDeps());
  assert.doesNotThrow(uninstall);
});

test("the Shift flag follows every key event, because Excalidraw never reports Shift on a press", () => {
  const deps = fakeDeps();
  dispatchKeydown(fakeEvent("Shift", { shiftKey: true }), deps);
  dispatchKeyup(fakeEvent("Shift", { shiftKey: false }), deps);
  assert.deepEqual(deps.recorded.shift, [true, false]);
});
