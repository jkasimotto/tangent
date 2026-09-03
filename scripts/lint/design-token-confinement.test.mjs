import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { makeFixtureRoot, runLint, writeFixture } from "./lint-test-support.mjs";

const SCRIPT = fileURLToPath(new URL("./design-token-confinement.mjs", import.meta.url));
const TOKENS = "packages/agent-shell/app/map/ui/tokens.css";
const MAP_CSS = "packages/agent-shell/app/map/ui/map.css";
const SURFACE = "packages/agent-shell/app/map/ui/Surface.tsx";
const ROGUE_CSS = "packages/agent-shell/app/map/ui/panel.css";
const ROGUE_TSX = "packages/agent-shell/app/map/ui/Dialog.tsx";

test("design-token-confinement accepts raw values in tokens.css and token reads elsewhere", () => {
  const root = makeFixtureRoot("design-token-confinement-pass");
  const tokens = writeFixture(root, TOKENS, [
    ":root {",
    "  --tangent-ink: #1e1e1e;",
    "  --tangent-panel: rgb(250 250 250);",
    "  --tangent-type-body: 14px;",
    "  --tangent-font: system-ui, sans-serif;",
    "}",
    ""
  ].join("\n"));
  const mapCss = writeFixture(root, MAP_CSS, [
    "#add-button { color: var(--tangent-ink); }",
    ".tangent-map-panel {",
    "  background: var(--tangent-panel);",
    "  font-size: var(--tangent-type-body);",
    "  font-family: var(--tangent-font);",
    "}",
    ""
  ].join("\n"));
  const surface = writeFixture(root, SURFACE, [
    "const stroke = \"#1e1e1e\";",
    "/** Renders a surface whose inline style reads tokens only. */",
    "export function Surface(): JSX.Element {",
    "  return <div style={{ color: \"var(--tangent-ink)\", fontSize: \"var(--tangent-type-body)\" }} data-stroke={stroke} />;",
    "}",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [tokens, mapCss, surface]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /design-token-confinement lint passed \(2 file\(s\) checked\)/);
});

test("design-token-confinement rejects raw colours and type outside tokens.css", () => {
  const root = makeFixtureRoot("design-token-confinement-fail");
  const rogueCss = writeFixture(root, ROGUE_CSS, [
    ".panel {",
    "  color: #1e1e1e;",
    "  background: rgba(0, 0, 0, 0.5);",
    "  border-color: hsl(0 0% 50%);",
    "  font-size: 14px;",
    "  font-family: system-ui;",
    "}",
    ""
  ].join("\n"));
  const rogueTsx = writeFixture(root, ROGUE_TSX, [
    "/** Renders a dialog with a raw colour and raw type in its style text. */",
    "export function Dialog(): JSX.Element {",
    "  return (",
    "    <div style={{ color: \"#fff\", fontSize: 12 }}>",
    "      <style>{\".x { background: rgb(0 0 0); }\"}</style>",
    "    </div>",
    "  );",
    "}",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [rogueCss, rogueTsx]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`^${ROGUE_CSS}:2  a raw hex colour`, "m"));
  assert.match(result.stderr, new RegExp(`^${ROGUE_CSS}:3  a raw rgb\\(\\) colour`, "m"));
  assert.match(result.stderr, new RegExp(`^${ROGUE_CSS}:4  a raw hsl\\(\\) colour`, "m"));
  assert.match(result.stderr, new RegExp(`^${ROGUE_CSS}:5  a font-size not drawn`, "m"));
  assert.match(result.stderr, new RegExp(`^${ROGUE_CSS}:6  a font-family not drawn`, "m"));
  assert.match(result.stderr, new RegExp(`^${ROGUE_TSX}:4  a raw hex colour, a font-size not drawn`, "m"));
  assert.match(result.stderr, new RegExp(`^${ROGUE_TSX}:5  a raw rgb\\(\\) colour`, "m"));
  assert.match(result.stderr, /design-token-confinement lint failed with 7 hit/);
});
