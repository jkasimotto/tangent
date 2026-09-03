import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { makeFixtureRoot, runLint, writeFixture } from "./lint-test-support.mjs";

const SCRIPT = fileURLToPath(new URL("./pointer-confinement.mjs", import.meta.url));
const CANVAS_HOST = "packages/agent-shell/app/map/canvas/MapCanvas.tsx";
const ROGUE_LABELS = "packages/agent-shell/app/map/canvas/AreaLabels.tsx";
const ROGUE_SESSION = "packages/agent-shell/app/map/input/pointer-session.ts";

test("pointer-confinement accepts Excalidraw's pointer props in the canvas host", () => {
  const root = makeFixtureRoot("pointer-confinement-pass");
  const host = writeFixture(root, CANVAS_HOST, [
    "/** Renders the Excalidraw element and forwards its pointer props. */",
    "export function MapCanvas(): JSX.Element {",
    "  return <Excalidraw onPointerDown={() => undefined} onPointerUp={() => undefined} onPointerUpdate={() => undefined} />;",
    "}",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [host]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /pointer-confinement lint passed/);
});

test("pointer-confinement rejects a pointer prop elsewhere and a pointer listener anywhere", () => {
  const root = makeFixtureRoot("pointer-confinement-fail");
  const labels = writeFixture(root, ROGUE_LABELS, [
    "/** Renders labels that grab the pointer themselves. */",
    "export function AreaLabels(): JSX.Element {",
    "  return <div onPointerDown={() => undefined} />;",
    "}",
    ""
  ].join("\n"));
  const host = writeFixture(root, CANVAS_HOST, [
    "/** Installs a second pointer edge beside the props. */",
    "export function attach(host: HTMLElement): void {",
    "  host.addEventListener(\"pointermove\", () => undefined);",
    "}",
    ""
  ].join("\n"));
  const session = writeFixture(root, ROGUE_SESSION, [
    "/** Listens to the mouse instead of the session. */",
    "export function attach(): void {",
    "  window.addEventListener(\"mouseup\", () => undefined);",
    "}",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [labels, host, session]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`^${ROGUE_LABELS}:3  `, "m"));
  assert.match(result.stderr, new RegExp(`^${CANVAS_HOST}:3  `, "m"));
  assert.match(result.stderr, new RegExp(`^${ROGUE_SESSION}:3  `, "m"));
  assert.match(result.stderr, /pointer-confinement lint failed with 3 hit/);
});
