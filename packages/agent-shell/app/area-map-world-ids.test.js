import test from "node:test";
import assert from "node:assert/strict";
import { composeShard, remapAreaMapWorld, runtimeId, splitComposed } from "./public/area-map-world-core.js";

/** Builds a small bound-element fixture. */
const scene = (id = "same") => ({ elements: [
  { id: "frame", type: "frame", x: 0, y: 0, width: 10, height: 10, groupIds: [], frameId: null, boundElements: [] },
  { id, type: "rectangle", x: 1, y: 2, width: 3, height: 4, groupIds: ["g"], frameId: "frame", fileId: "f", boundElements: [{ id: "label", type: "text" }] },
  { id: "label", type: "text", x: 1, y: 2, width: 3, height: 4, groupIds: ["g"], frameId: "frame", containerId: id },
], files: { f: { mimeType: "image/png", id: "f", dataURL: "data:image/png;base64,AA==" } } });

test("namespaces equal source IDs from different owners", () => {
  assert.notEqual(runtimeId("neara", "same"), runtimeId("neara/delivery", "same"));
});

test("rewrites bindings and group IDs and splits to stable source IDs", () => {
  const composed = composeShard("neara", scene(), { x: 10, y: 20 });
  assert.equal(composed.elements[1].boundElements[0].id, composed.elements[2].id);
  assert.equal(composed.elements[2].containerId, composed.elements[1].id);
  assert.equal(composed.elements[1].groupIds[0], composed.elements[2].groupIds[0]);
  assert.equal(composed.elements[1].frameId, composed.elements[0].id);
  assert.notEqual(composed.elements[1].fileId, "f");
  assert.deepEqual(Object.keys(composed.files), [composed.elements[1].fileId]);
  const split = splitComposed(composed.elements, composed.origins, new Map([["neara", { x: 10, y: 20 }]])).get("neara");
  assert.deepEqual(split.map((element) => element.id), ["frame", "same", "label"]);
  assert.equal(split[1].boundElements[0].id, "label");
  assert.equal(split[2].containerId, "same");
  assert.equal(split[1].frameId, "frame");
  assert.equal(split[1].fileId, "f");
  assert.deepEqual(split[1].groupIds, ["g"]);
  assert.equal(split[1].x, 1);
});

test("remaps every world identity through an explicit Area move table", () => {
  const world = {
    locatedArea: "neara/delivery/standards",
    areas: [{
      key: "neara/delivery/standards", parent: "neara/delivery", children: [],
      region: { key: "neara/delivery>neara/delivery/standards", owner: "neara/delivery", child: "neara/delivery/standards" },
      shard: { owner: "neara/delivery/standards", scene: { elements: [{ id: "arrow", customData: { tangentWorldEndpoint: { owner: "neara/delivery/standards", sourceId: "block" } } }] } },
    }],
  };
  const moved = remapAreaMapWorld(world, new Map([
    ["neara/delivery", "neara/operations"],
    ["neara/delivery/standards", "neara/operations/standards"],
  ]));
  assert.equal(moved.locatedArea, "neara/operations/standards");
  assert.equal(moved.areas[0].key, "neara/operations/standards");
  assert.equal(moved.areas[0].parent, "neara/operations");
  assert.equal(moved.areas[0].region.key, "neara/operations>neara/operations/standards");
  assert.equal(moved.areas[0].shard.scene.elements[0].customData.tangentWorldEndpoint.owner, "neara/operations/standards");
});
