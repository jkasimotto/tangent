import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { makeFixtureRoot, runLint, writeFixture } from "./lint-test-support.mjs";

const SCRIPT = fileURLToPath(new URL("./ui-style-confinement.mjs", import.meta.url));
const KIT_CSS = "packages/agent-shell/app/map/ui/map.css";
const KIT_SURFACE = "packages/agent-shell/app/map/ui/Surface.tsx";
const MAP_ROOT = "packages/agent-shell/app/map/MapRoot.tsx";
const ROGUE_CSS = "packages/agent-shell/app/map/surfaces/resources/resources.css";
const ROGUE_PANEL = "packages/agent-shell/app/map/surfaces/resources/ResourcesPanel.tsx";
const ROGUE_EFFECTS = "packages/agent-shell/app/map/surfaces/resources/resources-effects.ts";

test("ui-style-confinement accepts CSS in the kit and the layout token emit in MapRoot", () => {
  const root = makeFixtureRoot("ui-style-confinement-pass");
  const kitCss = writeFixture(root, KIT_CSS, ".tangent-map { color: var(--tangent-ink); }\n");
  const kitSurface = writeFixture(root, KIT_SURFACE, [
    "/** Renders a surface with an inline style, which the kit may do. */",
    "export function Surface(): JSX.Element {",
    "  return <div style={{ inset: 0 }} />;",
    "}",
    ""
  ].join("\n"));
  const mapRoot = writeFixture(root, MAP_ROOT, [
    "/** Emits the layout tokens as custom properties on the root element. */",
    "export function MapRoot(): JSX.Element {",
    "  const styleVariables = layoutCssVariables(LAYOUT);",
    "  return <div style={layoutCssVariables(LAYOUT)} />;",
    "}",
    "/** Sets one layout token on the host, the other allowed form. */",
    "export function emit(host: HTMLElement): void {",
    "  host.style.setProperty(\"--tangent-map-panel-inset\", \"0px\");",
    "}",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [kitCss, kitSurface, mapRoot]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ui-style-confinement lint passed \(1 file\(s\) checked\)/);
});

test("ui-style-confinement rejects a .css file, inline styles and style writes outside the kit", () => {
  const root = makeFixtureRoot("ui-style-confinement-fail");
  const rogueCss = writeFixture(root, ROGUE_CSS, ".resources { color: red; }\n");
  const roguePanel = writeFixture(root, ROGUE_PANEL, [
    "/** Renders the panel with its own styling. */",
    "export function ResourcesPanel(): JSX.Element {",
    "  return <div style={{ color: \"red\" }}><style>{\".x { color: red; }\"}</style></div>;",
    "}",
    ""
  ].join("\n"));
  const rogueEffects = writeFixture(root, ROGUE_EFFECTS, [
    "/** Writes styles on the host directly. */",
    "export function paint(host: HTMLElement): void {",
    "  host.style.color = \"red\";",
    "  host.style.setProperty(\"--tangent-map-panel-inset\", \"0px\");",
    "  host.setAttribute(\"style\", \"color: red\");",
    "}",
    ""
  ].join("\n"));
  const mapRoot = writeFixture(root, MAP_ROOT, [
    "/** Sets a colour inline, which even MapRoot may not do. */",
    "export function MapRoot(): JSX.Element {",
    "  return <div style={{ \"--tangent-map-panel-inset\": \"0px\", color: \"red\" }} />;",
    "}",
    "/** Writes a custom property that is not a layout token. */",
    "export function emit(host: HTMLElement): void {",
    "  host.style.setProperty(\"--tangent-ink\", \"black\");",
    "}",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [rogueCss, roguePanel, rogueEffects, mapRoot]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`^${ROGUE_CSS}:1  `, "m"));
  assert.match(result.stderr, new RegExp(`^${ROGUE_PANEL}:3  `, "m"));
  assert.match(result.stderr, new RegExp(`^${ROGUE_EFFECTS}:3  an element.style write`, "m"));
  assert.match(result.stderr, new RegExp(`^${ROGUE_EFFECTS}:4  `, "m"));
  assert.match(result.stderr, new RegExp(`^${ROGUE_EFFECTS}:5  a style attribute write`, "m"));
  assert.match(result.stderr, new RegExp(`^${MAP_ROOT}:3  MapRoot may only set`, "m"));
  assert.match(result.stderr, new RegExp(`^${MAP_ROOT}:7  a CSS custom-property write`, "m"));
  assert.match(result.stderr, /ui-style-confinement lint failed with 7 hit/);
});
