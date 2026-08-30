import test from "node:test";
import assert from "node:assert/strict";
import { composeShard, runtimeId, splitComposed } from "./public/area-map-world-core.js";

/** Builds a small bound-element fixture. */
const scene = (id = "same") => ({ elements: [{ id, type: "rectangle", x: 1, y: 2, width: 3, height: 4, groupIds: ["g"], frameId: null, boundElements: [{ id: "label", type: "text" }] }, { id: "label", type: "text", x: 1, y: 2, width: 3, height: 4, groupIds: ["g"], containerId: id }], files: {} });

test("namespaces equal source IDs from different owners", () => {
  assert.notEqual(runtimeId("neara", "same"), runtimeId("neara/delivery", "same"));
});

test("rewrites bindings and group IDs and splits to stable source IDs", () => {
  const composed = composeShard("neara", scene(), { x: 10, y: 20 });
  assert.equal(composed.elements[0].boundElements[0].id, composed.elements[1].id);
  assert.equal(composed.elements[1].containerId, composed.elements[0].id);
  assert.equal(composed.elements[0].groupIds[0], composed.elements[1].groupIds[0]);
  const split = splitComposed(composed.elements, composed.origins, new Map([["neara", { x: 10, y: 20 }]])).get("neara");
  assert.deepEqual(split.map((element) => element.id), ["same", "label"]);
  assert.equal(split[0].boundElements[0].id, "label");
  assert.equal(split[1].containerId, "same");
  assert.equal(split[0].x, 1);
});
