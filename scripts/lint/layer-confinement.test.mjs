import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { makeFixtureRoot, runLint, writeFixture } from "./lint-test-support.mjs";

const SCRIPT = fileURLToPath(new URL("./layer-confinement.mjs", import.meta.url));
const LAYERS = "packages/agent-shell/app/map/ui/layers.css";
const MAP_CSS = "packages/agent-shell/app/map/ui/map.css";
const SURFACE = "packages/agent-shell/app/map/ui/Surface.tsx";
const ROGUE_CSS = "packages/agent-shell/app/map/surfaces/find/find.css";
const ROGUE_TSX = "packages/agent-shell/app/map/surfaces/find/FindBar.tsx";

test("layer-confinement accepts the scale in layers.css and var() reads elsewhere", () => {
  const root = makeFixtureRoot("layer-confinement-pass");
  const layers = writeFixture(root, LAYERS, ":root {\n  --tangent-layer-panel: 20;\n  --tangent-layer-dialog: 40;\n}\n");
  const mapCss = writeFixture(root, MAP_CSS, ".tangent-map-panel { z-index: var(--tangent-layer-panel); }\n");
  const surface = writeFixture(root, SURFACE, [
    "/** Renders a surface on its registered layer. */",
    "export function Surface(): JSX.Element {",
    "  return <div style={{ zIndex: \"var(--tangent-layer-dialog)\" }} />;",
    "}",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [layers, mapCss, surface]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /layer-confinement lint passed \(2 file\(s\) checked\)/);
});

test("layer-confinement rejects literal z-index values and layer definitions outside layers.css", () => {
  const root = makeFixtureRoot("layer-confinement-fail");
  const rogueCss = writeFixture(root, ROGUE_CSS, [
    ".find { z-index: 50; }",
    ".find-dialog { z-index: calc(var(--tangent-layer-dialog) + 1); }",
    ":root { --tangent-layer-find: 60; }",
    ""
  ].join("\n"));
  const rogueTsx = writeFixture(root, ROGUE_TSX, [
    "/** Renders the find bar with its own stacking number. */",
    "export function FindBar(): JSX.Element {",
    "  return <div style={{ zIndex: 70 }} />;",
    "}",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [rogueCss, rogueTsx]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`^${ROGUE_CSS}:1  a z-index not read from`, "m"));
  assert.match(result.stderr, new RegExp(`^${ROGUE_CSS}:2  a z-index not read from`, "m"));
  assert.match(result.stderr, new RegExp(`^${ROGUE_CSS}:3  a --tangent-layer-\\* definition outside`, "m"));
  assert.match(result.stderr, new RegExp(`^${ROGUE_TSX}:3  a z-index not read from`, "m"));
  assert.match(result.stderr, /layer-confinement lint failed with 4 hit/);
});
