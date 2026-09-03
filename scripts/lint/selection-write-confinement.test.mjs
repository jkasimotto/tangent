import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { makeFixtureRoot, runLint, writeFixture } from "./lint-test-support.mjs";

const SCRIPT = fileURLToPath(new URL("./selection-write-confinement.mjs", import.meta.url));
const SUBORDINATION = "packages/agent-shell/app/map/input/excalidraw-subordination.ts";
const PROJECTION = "packages/agent-shell/app/map/canvas/projection.ts";
const READER = "packages/agent-shell/app/map/input/hit-test.ts";
const ROGUE_WRITER = "packages/agent-shell/app/map/input/pointer-session.ts";

test("selection-write-confinement accepts the two owners and a reader elsewhere", () => {
  const root = makeFixtureRoot("selection-write-confinement-pass");
  const subordination = writeFixture(root, SUBORDINATION, [
    "/** Builds the selection Excalidraw must hold. */",
    "export function selectionFor(id: string): object {",
    "  return { selectedElementIds: { [id]: true } };",
    "}",
    ""
  ].join("\n"));
  const projection = writeFixture(root, PROJECTION, [
    "/** Applies the selection to the app state. */",
    "export function apply(state: { selectedElementIds: object }, next: object): void {",
    "  state.selectedElementIds = next;",
    "}",
    ""
  ].join("\n"));
  const reader = writeFixture(root, READER, [
    "/** Reads the stable selection without writing it. */",
    "export function selectedIds(state: { selectedElementIds: Record<string, boolean> }): string[] {",
    "  const { selectedElementIds } = state;",
    "  return Object.keys(selectedElementIds).concat(Object.keys(state.selectedElementIds));",
    "}",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [subordination, projection, reader]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /selection-write-confinement lint passed/);
});

test("selection-write-confinement rejects an assignment and an object key outside the owners", () => {
  const root = makeFixtureRoot("selection-write-confinement-fail");
  const writer = writeFixture(root, ROGUE_WRITER, [
    "/** Corrects Excalidraw's selection from the session. */",
    "export function correct(state: { selectedElementIds: object }, next: object, id: string): object {",
    "  state.selectedElementIds = next;",
    "  state[\"selectedElementIds\"] ??= next;",
    "  const selectedElementIds = next;",
    "  return { selectedElementIds, other: { \"selectedElementIds\": { [id]: true } } };",
    "}",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [writer]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`^${ROGUE_WRITER}:3  `, "m"));
  assert.match(result.stderr, new RegExp(`^${ROGUE_WRITER}:4  `, "m"));
  assert.match(result.stderr, new RegExp(`^${ROGUE_WRITER}:6  `, "m"));
  assert.match(result.stderr, /selection-write-confinement lint failed with 4 hit/);
});
