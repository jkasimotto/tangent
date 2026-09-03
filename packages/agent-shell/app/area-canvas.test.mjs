import assert from "node:assert/strict";
import test from "node:test";
import { areaCanvasPath, areaCanvasSummary, legacyAreaCanvasPath, parseAreaCanvas, parseLegacyAreaCanvas, safeCanvasPath, serializeAreaCanvas, validateAreaCanvas } from "./area-canvas.mjs";
import { createBlockElements, createEmptyScene, createTextElement, kindForReference, tangentOf } from "./public/area-board-core.js";

const sample = createEmptyScene();
sample.elements.push(createTextElement({ id: "ink", text: "Try this", x: 20, y: 40, width: 180, height: 90 }));

test("accepts an Excalidraw scene and preserves forward-compatible fields and order", () => {
  sample.elements[0].customData = { futureViewerField: { kept: true } };
  const text = serializeAreaCanvas(sample);
  assert.deepEqual(parseAreaCanvas(text).canvas, sample);
  assert.deepEqual(Object.keys(parseAreaCanvas(text).canvas.elements[0]), Object.keys(sample.elements[0]));
});

test("derives the new canonical path and keeps the old path migration-only", () => {
  assert.equal(areaCanvasPath("otto/tangent"), "otto/tangent/tangent.excalidraw");
  assert.equal(legacyAreaCanvasPath("otto/tangent"), "otto/tangent/tangent.canvas");
  assert.equal(areaCanvasPath("../otto"), null);
  assert.equal(safeCanvasPath("/vault", "../escape.excalidraw"), null);
  assert.equal(safeCanvasPath("/vault", "otto/otto.excalidraw").absolute, "/vault/otto/otto.excalidraw");
});

test("retired capture metadata is ordinary canvas content", () => {
  const retired = ["id", "ea"].join("");
  const file = `otto/${retired}s.md`;
  assert.equal(kindForReference(file), "document");
  assert.equal(tangentOf({ customData: { tangent: { kind: retired, ref: file } } }), null);
});

test("rejects duplicate ids, unsafe numbers, invalid Tangent metadata, and unsupported types", () => {
  const invalid = createEmptyScene();
  const [block, label] = createBlockElements({ id: "same", kind: "goal", ref: "otto/goal-a.md", x: 0, y: 0 });
  label.id = "same";
  block.x = Number.NaN;
  block.customData.tangent.kind = "made-up";
  invalid.elements.push(block, label, { ...label, id: "other", type: "video" });
  const result = validateAreaCanvas(invalid);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /duplicate id/);
  assert.match(result.errors.join("\n"), /finite scene number/);
  assert.match(result.errors.join("\n"), /customData\.tangent/);
  assert.match(result.errors.join("\n"), /type is unsupported/);
});

test("reads and round-trips inert resource references without treating their IDs as vault files", () => {
  const scene = createEmptyScene();
  const [visible, visibleLabel] = createBlockElements({ id: "resource-visible", kind: "resource", ref: "0198e8c5-2be6-7d6a-a142-f0903a13a23b", title: "Resource", x: 10, y: 20 });
  const [hidden, hiddenLabel] = createBlockElements({ id: "resource-hidden", kind: "resource", ref: "0198e8c5-2be6-7d6a-a142-f0903a13a23c", title: "Hidden", x: 40, y: 50 });
  hidden.isDeleted = true; hiddenLabel.isDeleted = true;
  scene.elements.push(visible, visibleLabel, hidden, hiddenLabel);
  const parsed = parseAreaCanvas(serializeAreaCanvas(scene));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.scene.elements, scene.elements, "visible and deleted additive records retain exact source bytes");
  assert.deepEqual(areaCanvasSummary(parsed.scene).references, [{ id: "resource-visible", resourceId: "0198e8c5-2be6-7d6a-a142-f0903a13a23b" }]);

  visible.customData.tangent.ref = "../not-an-opaque-resource";
  const invalid = validateAreaCanvas(scene);
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join("\n"), /safe opaque ID/);
});

test("converts legacy blocks, frames, ink, and edges to bound Excalidraw elements", () => {
  const legacy = { nodes: [
    { id: "frame", type: "group", label: "Now", x: 0, y: 0, width: 700, height: 400 },
    { id: "goal", type: "file", file: "otto/goal-a.md", x: 20, y: 20, width: 260, height: 120 },
    { id: "ink", type: "text", text: "why?", x: 360, y: 40, width: 120, height: 80 },
  ], edges: [{ id: "arrow", fromNode: "goal", toNode: "ink", toEnd: "arrow", label: "feeds" }] };
  const parsed = parseLegacyAreaCanvas(JSON.stringify(legacy));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.canvas.type, "excalidraw");
  assert.equal(parsed.canvas.elements.find((element) => element.id === "frame").type, "frame");
  assert.equal(parsed.canvas.elements.find((element) => element.id === "goal").customData.tangent.kind, "goal");
  assert.equal(parsed.canvas.elements.find((element) => element.id === "arrow").endBinding.elementId, "ink");
  assert.equal(parsed.canvas.elements.find((element) => element.id === "ink").boundElements[0].id, "arrow");
  assert.equal(parsed.canvas.elements.find((element) => element.id === "arrow").boundElements[0].id, "arrow-label");
  assert.equal(parsed.canvas.elements.find((element) => element.id === "arrow-label").containerId, "arrow");
  assert.deepEqual(areaCanvasSummary(parsed.canvas), {
    references: [{ id: "goal", file: "otto/goal-a.md", subpath: null }],
    ink: [{ id: "ink", text: "why?" }],
    frames: [{ id: "frame", label: "Now" }],
    arrows: [{ id: "arrow", from: "goal", to: "ink", label: "feeds" }],
  });
});
