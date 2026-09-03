import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SURFACES, SURFACE_IDS, isModalSurface, isSurfaceId, surfaceDeclaration } from "./surface-registry.ts";
import type { SurfaceDeclaration, SurfaceId } from "./surface-registry.ts";

const LAYERS = new Set(["panel", "dialog", "transient", "hang", "toast"]);
const MODALITIES = new Set(["panel", "modal", "transient"]);
const ESCAPES = new Set(["close", "back-step", "none"]);
const FOCUS_TARGETS = new Set(["heading", "first-control", "none"]);

/** Every registry row paired with its id. */
function rows(): Array<[SurfaceId, SurfaceDeclaration]> {
  return SURFACE_IDS.map((id) => [id, surfaceDeclaration(id)]);
}

test("the registry holds exactly the surfaces of the design", () => {
  assert.deepEqual(SURFACE_IDS, [
    "resources", "resourceDetails", "resourceEditor", "resourceRecovery", "sceneRecovery",
    "placement", "picker", "find", "outline", "help", "transaction"
  ]);
});

test("every declaration uses only the closed vocabularies", () => {
  for (const [id, declaration] of rows()) {
    assert.ok(LAYERS.has(declaration.layer), `${id} layer`);
    assert.ok(MODALITIES.has(declaration.modality), `${id} modality`);
    assert.ok(ESCAPES.has(declaration.escape), `${id} escape`);
    assert.ok(FOCUS_TARGETS.has(declaration.focusOnOpen), `${id} focusOnOpen`);
    assert.equal(typeof declaration.restoreFocus, "boolean", `${id} restoreFocus`);
  }
});

test("every modal surface sits on the dialog layer, where the stack keeps one open at a time", () => {
  const modalLayers = rows().filter(([, declaration]) => declaration.modality === "modal").map(([, declaration]) => declaration.layer);
  assert.deepEqual(modalLayers, ["dialog", "dialog", "dialog", "dialog"]);
});

test("a modal surface always restores focus and a transient surface never takes it", () => {
  for (const [id, declaration] of rows()) {
    if (declaration.modality === "modal") assert.equal(declaration.restoreFocus, true, id);
    if (declaration.modality === "transient") {
      assert.equal(declaration.focusOnOpen, "none", id);
      assert.equal(declaration.restoreFocus, false, id);
    }
  }
});

test("only the toast ignores Escape", () => {
  const ignoring = rows().filter(([, declaration]) => declaration.escape === "none").map(([id]) => id);
  assert.deepEqual(ignoring, ["transaction"]);
});

test("back-step belongs to the views inside the Resources panel", () => {
  const stepping = rows().filter(([, declaration]) => declaration.escape === "back-step").map(([id]) => id);
  assert.deepEqual(stepping, ["resourceDetails", "resourceEditor"]);
  for (const id of stepping) assert.equal(surfaceDeclaration(id).layer, "panel");
});

test("isSurfaceId and isModalSurface read the table", () => {
  assert.equal(isSurfaceId("picker"), true);
  assert.equal(isSurfaceId("toString"), false);
  assert.equal(isSurfaceId(""), false);
  assert.equal(isModalSurface("picker"), true);
  assert.equal(isModalSurface("find"), false);
  assert.equal(surfaceDeclaration("help"), SURFACES.help);
});
