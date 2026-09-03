import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { makeFixtureRoot, runLint, writeFixture } from "./lint-test-support.mjs";

const SCRIPT = fileURLToPath(new URL("./no-freestanding-position.mjs", import.meta.url));
const KIT_CSS = "packages/agent-shell/app/map/ui/map.css";
const KIT_SURFACE = "packages/agent-shell/app/map/ui/Surface.tsx";
const FEATURE_CSS = "packages/agent-shell/app/map/surfaces/resources/resources.css";
const FEATURE_TSX = "packages/agent-shell/app/map/surfaces/resources/ResourcesPanel.tsx";

test("no-freestanding-position accepts absolute and fixed positioning inside the kit", () => {
  const root = makeFixtureRoot("no-freestanding-position-pass");
  const kitCss = writeFixture(root, KIT_CSS, ".tangent-map-backdrop { position: fixed; }\n.tangent-map-surface { position: absolute; }\n");
  const kitSurface = writeFixture(root, KIT_SURFACE, [
    "/** Renders a surface the kit positions. */",
    "export function Surface(): JSX.Element {",
    "  return <div style={{ position: \"absolute\" }} />;",
    "}",
    ""
  ].join("\n"));
  const flowFeature = writeFixture(root, FEATURE_TSX, [
    "/** Renders the panel as flow content; relative positioning stays allowed. */",
    "export function ResourcesPanel(): JSX.Element {",
    "  return <div className=\"tangent-map-panel\" style={{ position: \"relative\" }} />;",
    "}",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [kitCss, kitSurface, flowFeature]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no-freestanding-position lint passed \(1 file\(s\) checked\)/);
});

test("no-freestanding-position rejects absolute and fixed positioning outside the kit", () => {
  const root = makeFixtureRoot("no-freestanding-position-fail");
  const featureCss = writeFixture(root, FEATURE_CSS, ".resources {\n  position: absolute;\n}\n.resources-backdrop { position:fixed; }\n");
  const featureTsx = writeFixture(root, FEATURE_TSX, [
    "/** Pins the panel itself instead of going through a surface. */",
    "export function ResourcesPanel(): JSX.Element {",
    "  return <div style={{ position: \"fixed\", right: 0 }} />;",
    "}",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [featureCss, featureTsx]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`^${FEATURE_CSS}:2  position: absolute outside the kit`, "m"));
  assert.match(result.stderr, new RegExp(`^${FEATURE_CSS}:4  position: fixed outside the kit`, "m"));
  assert.match(result.stderr, new RegExp(`^${FEATURE_TSX}:3  position: fixed outside the kit`, "m"));
  assert.match(result.stderr, /no-freestanding-position lint failed with 3 hit/);
});
