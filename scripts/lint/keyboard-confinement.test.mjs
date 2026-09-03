import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { makeFixtureRoot, runLint, writeFixture } from "./lint-test-support.mjs";

const SCRIPT = fileURLToPath(new URL("./keyboard-confinement.mjs", import.meta.url));
const DISPATCHER = "packages/agent-shell/app/map/input/keyboard-dispatch.ts";
const KIT_FIELD = "packages/agent-shell/app/map/ui/TextField.tsx";
const ROGUE_SURFACE = "packages/agent-shell/app/map/surfaces/find/Find.tsx";
const ROGUE_STORE = "packages/agent-shell/app/map/surfaces/find/find-effects.ts";

test("keyboard-confinement accepts the dispatcher's listener and the kit's onKeyDown", () => {
  const root = makeFixtureRoot("keyboard-confinement-pass");
  const dispatcher = writeFixture(root, DISPATCHER, [
    "/** Installs the one host keydown listener. */",
    "export function installKeyboard(host: HTMLElement): void {",
    "  host.addEventListener(\"keydown\", () => undefined);",
    "  window.onkeyup = null;",
    "}",
    ""
  ].join("\n"));
  const field = writeFixture(root, KIT_FIELD, [
    "/** Renders a text field that handles its own keys. */",
    "export function TextField(): JSX.Element {",
    "  return <input onKeyDown={() => undefined} onKeyUp={() => undefined} />;",
    "}",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [dispatcher, field]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /keyboard-confinement lint passed/);
});

test("keyboard-confinement rejects a surface prop and a feature listener outside the owners", () => {
  const root = makeFixtureRoot("keyboard-confinement-fail");
  const surface = writeFixture(root, ROGUE_SURFACE, [
    "/** Renders Find with its own key edge. */",
    "export function Find(): JSX.Element {",
    "  return <div onKeyDown={() => undefined} />;",
    "}",
    ""
  ].join("\n"));
  const effects = writeFixture(root, ROGUE_STORE, [
    "/** Reads keys directly instead of through the dispatcher. */",
    "export function listen(): void {",
    "  document.addEventListener(\"keyup\", () => undefined);",
    "  document.onkeydown = () => undefined;",
    "}",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [surface, effects]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`^${ROGUE_SURFACE}:3  `, "m"));
  assert.match(result.stderr, new RegExp(`^${ROGUE_STORE}:3  `, "m"));
  assert.match(result.stderr, new RegExp(`^${ROGUE_STORE}:4  `, "m"));
  assert.match(result.stderr, /keyboard-confinement lint failed with 3 hit/);
});
