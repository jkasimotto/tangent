import { strict as assert } from "node:assert";
import { test } from "node:test";
import { LAYOUT } from "../layout/layout-tokens.ts";
import { EMPTY_SURFACE_STACK } from "../surfaces/surface-stack.ts";
import type { SurfaceStack } from "../surfaces/surface-stack.ts";
import type { KeyModifiers } from "../ui/key-bindings.ts";
import { areaKey } from "../units/ids.ts";
import { CANVAS_ROUTES, routeKey } from "./key-routes.ts";
import type { KeyDecision, KeyFacts, KeyPress } from "./key-routes.ts";

const NO_MODIFIERS: KeyModifiers = { shiftKey: false, metaKey: false, ctrlKey: false, altKey: false };
const AREA = areaKey("otto/tangent");

/** What a test may vary about one press. The modifiers are given a few at a time; the rest stay up. */
type PressOverrides = Omit<Partial<KeyPress>, "modifiers"> & { readonly modifiers?: Partial<KeyModifiers> };

/** A press of one key on the canvas with the given modifiers. */
function press(key: string, overrides: PressOverrides = {}): KeyPress {
  return {
    key,
    repeat: false,
    composing: false,
    targetIsTextEntry: false,
    targetSurface: null,
    ...overrides,
    modifiers: { ...NO_MODIFIERS, ...overrides.modifiers }
  };
}

/** The Map with nothing open, nothing selected and no text edit. */
function facts(overrides: Partial<KeyFacts> = {}): KeyFacts {
  return { surfaces: EMPTY_SURFACE_STACK, editingText: false, selectedArea: null, hasSelectedBlock: false, hasSelection: false, findActive: false, ...overrides };
}

/** The command kind of a Map decision, or the owner otherwise. */
function outcome(decision: KeyDecision): string {
  return decision.owner === "map" ? `${decision.command.kind}/${decision.consume}` : decision.owner;
}

test("a composing key belongs to nobody", () => {
  assert.equal(outcome(routeKey(press("b", { composing: true }), facts())), "ignored");
});

test("the canvas keys open Find, the picker, Help and toggle the Outline", () => {
  assert.equal(outcome(routeKey(press("/"), facts())), "open-find/stop");
  assert.equal(outcome(routeKey(press("f", { modifiers: { metaKey: true } }), facts())), "open-find/stop");
  assert.equal(outcome(routeKey(press("f", { modifiers: { ctrlKey: true } }), facts())), "open-find/stop");
  assert.equal(outcome(routeKey(press("f"), facts())), "native", "a bare F is Excalidraw's frame tool");
  assert.equal(outcome(routeKey(press("b"), facts())), "open-picker/stop");
  assert.equal(outcome(routeKey(press("B", { modifiers: { shiftKey: true } }), facts())), "open-picker/stop");
  assert.equal(outcome(routeKey(press("b", { modifiers: { metaKey: true } }), facts())), "native");
  assert.equal(outcome(routeKey(press("?", { modifiers: { shiftKey: true } }), facts())), "open-help/stop");
  assert.equal(outcome(routeKey(press("?"), facts())), "open-help/stop");
  assert.equal(outcome(routeKey(press("o", { modifiers: { metaKey: true, shiftKey: true } }), facts())), "toggle-outline/stop");
  assert.equal(outcome(routeKey(press("O", { modifiers: { ctrlKey: true, shiftKey: true } }), facts())), "toggle-outline/stop");
});

test("undo and redo take Cmd or Ctrl Z; Cmd D and Delete are Excalidraw's with a history word", () => {
  assert.equal(outcome(routeKey(press("z", { modifiers: { metaKey: true } }), facts())), "undo/stop");
  assert.equal(outcome(routeKey(press("z", { modifiers: { ctrlKey: true, shiftKey: true } }), facts())), "redo/stop");
  const duplicate = routeKey(press("d", { modifiers: { metaKey: true } }), facts());
  assert.deepEqual(duplicate, { owner: "map", route: "duplicate", command: { kind: "expect-excalidraw-command", word: "duplicate" }, consume: "none" });
  const remove = routeKey(press("Delete"), facts());
  assert.deepEqual(remove, { owner: "map", route: "delete", command: { kind: "expect-excalidraw-command", word: "delete" }, consume: "none" });
});

test("Escape on the bare canvas runs the Map's Escape order", () => {
  assert.equal(outcome(routeKey(press("Escape"), facts())), "escape/stop");
});

test("arrows nudge the selection by the nudge tokens and stay native with nothing selected", () => {
  assert.equal(outcome(routeKey(press("ArrowLeft"), facts())), "native");
  const slow = routeKey(press("ArrowLeft"), facts({ hasSelection: true }));
  assert.deepEqual(slow, { owner: "map", route: "nudge", command: { kind: "nudge-selection", delta: { dx: -LAYOUT.nudge, dy: 0 } }, consume: "stop" });
  const fast = routeKey(press("ArrowDown", { modifiers: { shiftKey: true } }), facts({ hasSelection: true }));
  assert.deepEqual(fast, { owner: "map", route: "nudge", command: { kind: "nudge-selection", delta: { dx: 0, dy: LAYOUT.nudgeFast } }, consume: "stop" });
});

test("with an Area selected: Enter fits it, Space folds it once per press, Delete is refused, Shift O is Only", () => {
  const selected = facts({ selectedArea: AREA, hasSelection: true });
  assert.deepEqual(routeKey(press("Enter"), selected), { owner: "map", route: "fit-area", command: { kind: "fit-selected-area", area: AREA }, consume: "stop" });
  assert.deepEqual(routeKey(press(" "), selected), { owner: "map", route: "fold", command: { kind: "fold-selected-area", area: AREA }, consume: "prevent" });
  assert.equal(outcome(routeKey(press(" ", { repeat: true }), selected)), "native", "a held Space does not fold again");
  assert.equal(outcome(routeKey(press(" "), facts())), "native", "Space with nothing selected is Excalidraw's pan modifier");
  assert.equal(outcome(routeKey(press("Backspace"), selected)), "refuse-area-delete/stop");
  assert.deepEqual(routeKey(press("O", { modifiers: { shiftKey: true } }), selected), { owner: "map", route: "only", command: { kind: "toggle-only", area: AREA }, consume: "stop" });
  assert.deepEqual(routeKey(press("O", { modifiers: { shiftKey: true } }), facts()), { owner: "map", route: "only", command: { kind: "toggle-only", area: null }, consume: "stop" });
});

test("with a Block selected: Enter opens it, X hides it, O reads it, and Shift O still reads it", () => {
  const block = facts({ hasSelectedBlock: true, hasSelection: true });
  assert.equal(outcome(routeKey(press("Enter"), block)), "open-selected-block/stop");
  assert.equal(outcome(routeKey(press("x"), block)), "hide-selected-block/stop");
  assert.deepEqual(routeKey(press("o"), block).owner === "map" ? routeKey(press("o"), block) : null, { owner: "map", route: "read-block", command: { kind: "open-selected-block", verb: "read" }, consume: "stop" });
  assert.equal(outcome(routeKey(press("O", { modifiers: { shiftKey: true } }), block)), "open-selected-block/stop");
  assert.equal(outcome(routeKey(press("x", { modifiers: { metaKey: true } }), block)), "native", "Cmd X is a cut, not a hide");
  assert.equal(outcome(routeKey(press("Enter"), facts())), "native");
  assert.equal(outcome(routeKey(press("x"), facts())), "native");
});

test("n and N step Find only while a query is held", () => {
  assert.equal(outcome(routeKey(press("n"), facts())), "native");
  assert.deepEqual(routeKey(press("n"), facts({ findActive: true })), { owner: "map", route: "find-next", command: { kind: "step-find", direction: "next" }, consume: "stop" });
  assert.deepEqual(routeKey(press("N", { modifiers: { shiftKey: true } }), facts({ findActive: true })), { owner: "map", route: "find-previous", command: { kind: "step-find", direction: "previous" }, consume: "stop" });
});

test("a text field swallows every canvas key, and a text edit settles on Escape or Cmd Enter", () => {
  assert.equal(outcome(routeKey(press("b", { targetIsTextEntry: true }), facts())), "native");
  assert.equal(outcome(routeKey(press("Escape", { targetIsTextEntry: true }), facts())), "native");
  const editing = facts({ editingText: true, hasSelection: true });
  assert.equal(outcome(routeKey(press("b"), editing)), "native");
  assert.equal(outcome(routeKey(press("ArrowLeft"), editing)), "native");
  assert.equal(outcome(routeKey(press("Escape"), editing)), "finish-text-edit/none");
  assert.equal(outcome(routeKey(press("Enter", { modifiers: { metaKey: true } }), editing)), "finish-text-edit/none");
  assert.equal(outcome(routeKey(press("Enter"), editing)), "native");
});

test("with a surface open, Escape always pops the stack, from any target", () => {
  const surfaces: SurfaceStack = ["resources", "resourceDetails"];
  assert.equal(outcome(routeKey(press("Escape"), facts({ surfaces }))), "escape/stop");
  assert.equal(outcome(routeKey(press("Escape", { targetSurface: "resourceDetails", targetIsTextEntry: true }), facts({ surfaces }))), "escape/stop");
  assert.equal(outcome(routeKey(press("Escape"), facts({ surfaces: ["picker"] }))), "escape/stop");
  assert.equal(outcome(routeKey(press("Escape"), facts({ surfaces: ["placement"] }))), "escape/stop");
});

test("a modal surface owns every other key", () => {
  const picker = facts({ surfaces: ["resources", "picker"], selectedArea: AREA, hasSelection: true });
  assert.deepEqual(routeKey(press("b"), picker), { owner: "surface", surface: "picker" });
  assert.deepEqual(routeKey(press("Enter"), picker), { owner: "surface", surface: "picker" });
  assert.deepEqual(routeKey(press("Tab"), picker), { owner: "surface", surface: "picker" });
  assert.deepEqual(routeKey(press("ArrowDown"), picker), { owner: "surface", surface: "picker" });
  assert.deepEqual(routeKey(press("b"), facts({ surfaces: ["help"] })), { owner: "surface", surface: "help" });
});

test("a panel owns the keys typed inside it and the canvas keeps the keys typed beside it", () => {
  const panel = facts({ surfaces: ["resources"], selectedArea: AREA, hasSelection: true });
  assert.deepEqual(routeKey(press("Enter", { targetSurface: "resources" }), panel), { owner: "surface", surface: "resources" });
  assert.deepEqual(routeKey(press("b", { targetSurface: "resources", targetIsTextEntry: true }), panel), { owner: "surface", surface: "resources" });
  assert.equal(outcome(routeKey(press("b"), panel)), "open-picker/stop", "B on the host beside the wide panel opens the picker");
  assert.equal(outcome(routeKey(press("Enter"), panel)), "fit-selected-area/stop");
  const find = facts({ surfaces: ["find"], findActive: true });
  assert.deepEqual(routeKey(press("n", { targetSurface: "find", targetIsTextEntry: true }), find), { owner: "surface", surface: "find" });
  assert.equal(outcome(routeKey(press("n"), find)), "step-find/stop");
  assert.deepEqual(routeKey(press("b", { targetSurface: "picker" }), panel), { owner: "map", route: "picker", command: { kind: "open-picker" }, consume: "stop" }, "a target inside a closed surface is treated as the canvas");
});

test("the placement bar owns Enter and the arrows and leaves every other key native", () => {
  const placing = facts({ surfaces: ["resources", "placement"], selectedArea: AREA, hasSelection: true });
  assert.deepEqual(routeKey(press("Enter"), placing), { owner: "map", route: "placement-commit", command: { kind: "commit-placement" }, consume: "stop" });
  assert.deepEqual(routeKey(press("ArrowRight"), placing), { owner: "map", route: "placement-move", command: { kind: "move-placement", delta: { dx: LAYOUT.placementStep, dy: 0 } }, consume: "stop" });
  assert.deepEqual(routeKey(press("ArrowUp", { modifiers: { shiftKey: true } }), placing), { owner: "map", route: "placement-move", command: { kind: "move-placement", delta: { dx: 0, dy: -LAYOUT.placementStepFine } }, consume: "stop" });
  assert.equal(outcome(routeKey(press("b"), placing)), "native");
  assert.equal(outcome(routeKey(press(" "), placing)), "native");
});

test("the transaction toast claims nothing", () => {
  assert.equal(outcome(routeKey(press("b"), facts({ surfaces: ["transaction"] }))), "open-picker/stop");
  assert.equal(outcome(routeKey(press("Escape"), facts({ surfaces: ["transaction"] }))), "escape/stop");
});

test("every canvas route is a named function and returns null for a key that is not its own", () => {
  const names = CANVAS_ROUTES.map((route) => route.name);
  assert.equal(new Set(names).size, names.length, "route names are unique");
  const everything = facts({ selectedArea: AREA, hasSelectedBlock: true, hasSelection: true, findActive: true });
  for (const route of CANVAS_ROUTES) {
    assert.ok(route.name.endsWith("Route"), `${route.name} is named as a route`);
    assert.equal(route(press("F13"), everything), null, `${route.name} claims F13`);
  }
});
