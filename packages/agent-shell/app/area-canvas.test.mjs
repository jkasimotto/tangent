import assert from "node:assert/strict";
import test from "node:test";
import { areaCanvasPath, parseAreaCanvas, safeCanvasPath, serializeAreaCanvas, validateAreaCanvas } from "./area-canvas.mjs";

const sample = { nodes: [{ id: "frame", type: "group", label: "Now", x: 0, y: 0, width: 600, height: 400 }, { id: "ink", type: "text", text: "Try this", x: 20, y: 40, width: 180, height: 90 }], edges: [{ id: "arrow", fromNode: "ink", toNode: "frame", toEnd: "arrow", label: "feeds" }] };

test("accepts the standard profile and preserves field and array order", () => {
  const text = serializeAreaCanvas(sample);
  assert.deepEqual(parseAreaCanvas(text).canvas, sample);
  assert.deepEqual(Object.keys(parseAreaCanvas(text).canvas.nodes[0]), Object.keys(sample.nodes[0]));
});

test("rejects traversal and derives one canonical path", () => {
  assert.equal(areaCanvasPath("otto/tangent"), "otto/tangent/tangent.canvas");
  assert.equal(areaCanvasPath("../otto"), null);
  assert.equal(safeCanvasPath("/vault", "../escape.canvas"), null);
  assert.equal(safeCanvasPath("/vault", "otto/otto.canvas").absolute, "/vault/otto/otto.canvas");
});

test("rejects duplicate IDs, bad endpoints, unsafe values, limits, and unknown fields", () => {
  const invalid = structuredClone(sample);
  invalid.nodes[1].id = "frame";
  invalid.nodes[1].x = Number.NaN;
  invalid.nodes[1].privateState = true;
  invalid.edges[0].toNode = "missing";
  const result = validateAreaCanvas(invalid);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /duplicate id/);
  assert.match(result.errors.join("\n"), /finite canvas coordinate/);
  assert.match(result.errors.join("\n"), /unsupported fields/);
  assert.match(result.errors.join("\n"), /does not name a node/);
});

test("enforces published geometry, identifier, and reference limits", () => {
  const base = { id: "a", type: "text", text: "ok", x: 0, y: 0, width: 100, height: 100 };
  assert.equal(validateAreaCanvas({ nodes: [{ ...base, x: 0.5 }], edges: [] }).ok, false);
  assert.equal(validateAreaCanvas({ nodes: [{ ...base, width: 100_001 }], edges: [] }).ok, false);
  assert.equal(validateAreaCanvas({ nodes: [{ ...base, id: "x".repeat(129) }], edges: [] }).ok, false);
  assert.equal(validateAreaCanvas({ nodes: [{ ...base, type: "file", file: "../outside.md", text: undefined }], edges: [] }).ok, false);
  assert.equal(validateAreaCanvas({ nodes: [{ ...base, type: "link", url: "javascript:alert(1)", text: undefined }], edges: [] }).ok, false);
});
