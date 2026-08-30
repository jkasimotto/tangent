import test from "node:test";
import assert from "node:assert/strict";
import { composeAreaMapWorld, composeShard, provisionalRegions, remapAreaMapWorld, runtimeId, splitComposed } from "./public/area-map-world-core.js";

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
      region: {
        key: "neara/delivery>neara/delivery/standards", owner: "neara/delivery", child: "neara/delivery/standards",
        layout: { schema: "area-placement.v1", priority: 1, overlapWith: ["neara/delivery/other"] },
      },
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
  assert.deepEqual(moved.areas[0].region.layout.overlapWith, ["neara/operations/other"]);
  assert.equal(moved.areas[0].shard.scene.elements[0].customData.tangentWorldEndpoint.owner, "neara/operations/standards");
});

test("resolves cross-Area endpoints at runtime and keeps source bindings local", () => {
  const areas = ["root", "root/a", "root/b"];
  const regions = provisionalRegions(areas, new Map([
    ["@root>root", { x: 0, y: 0, width: 1_400, height: 800 }],
    ["root>root/a", { x: 60, y: 60, width: 500, height: 400 }],
    ["root>root/b", { x: 700, y: 60, width: 500, height: 400 }],
  ]));
  const arrow = {
    id: "cross", type: "arrow", x: 80, y: 100, width: 700, height: 10, points: [[0, 0], [700, 10]],
    startBinding: { elementId: "a-block", focus: 0, gap: 1 }, endBinding: null,
    customData: { tangentWorldEndpoints: { start: { owner: "root/a", sourceId: "a-block" }, end: { owner: "root/b", sourceId: "b-block" } } },
  };
  const world = { locatedArea: "root/a", areas: [
    { key: "root", parent: "@root", region: regions.get("root"), shard: { state: "ready", scene: { elements: [], files: {} } } },
    { key: "root/a", parent: "root", region: regions.get("root/a"), shard: { state: "ready", scene: { elements: [{ id: "a-block", type: "rectangle", x: 40, y: 60, width: 100, height: 60 }, arrow], files: {} } } },
    { key: "root/b", parent: "root", region: regions.get("root/b"), shard: { state: "ready", scene: { elements: [{ id: "b-block", type: "rectangle", x: 40, y: 60, width: 100, height: 60 }], files: {} } } },
  ] };
  const composed = composeAreaMapWorld(world);
  const runtimeArrow = composed.scene.elements.find((element) => element.customData?.tangentWorld?.sourceId === "cross");
  const runtimeStart = composed.scene.elements.find((element) => element.id === runtimeId("root/a", "a-block"));
  const runtimeEnd = composed.scene.elements.find((element) => element.id === runtimeId("root/b", "b-block"));
  assert.equal(runtimeArrow.startBinding.elementId, runtimeId("root/a", "a-block"));
  assert.equal(runtimeArrow.endBinding.elementId, runtimeId("root/b", "b-block"));
  assert.deepEqual(runtimeStart.boundElements, [{ id: runtimeArrow.id, type: "arrow" }]);
  assert.deepEqual(runtimeEnd.boundElements, [{ id: runtimeArrow.id, type: "arrow" }]);
  const splitWorld = splitComposed(composed.scene.elements, composed.origins, composed.offsets);
  const split = splitWorld.get("root/a").find((element) => element.id === "cross");
  assert.equal(split.startBinding.elementId, "a-block");
  assert.equal(split.endBinding, null, "a foreign runtime binding never enters the source shard");
  assert.deepEqual(split.customData.tangentWorldEndpoints.end, { owner: "root/b", sourceId: "b-block" });
  assert.deepEqual(splitWorld.get("root/b").find((element) => element.id === "b-block").boundElements, [], "the derived reverse edge never enters the foreign source shard");
});

test("routes a deferred cross-Area endpoint to its interactive region without changing source geometry", () => {
  const areas = ["root", "root/a", "root/b"];
  const regions = provisionalRegions(areas);
  const source = {
    id: "cross", type: "arrow", x: 10, y: 20, width: 80, height: 30, points: [[0, 0], [80, 30]],
    startBinding: null, endBinding: null,
    customData: { tangentWorldEndpoints: { end: { owner: "root/b", sourceId: "deferred-block" } } },
  };
  const world = { locatedArea: "root/a", areas: [
    { key: "root", parent: "@root", region: regions.get("root"), shard: { state: "ready", scene: { elements: [], files: {} } } },
    { key: "root/a", parent: "root", region: regions.get("root/a"), shard: { state: "ready", scene: { elements: [source], files: {} } } },
    { key: "root/b", parent: "root", region: regions.get("root/b"), shard: { state: "deferred", scene: null } },
  ] };
  const composed = composeAreaMapWorld(world);
  const runtimeArrow = composed.scene.elements.find((element) => element.customData?.tangentWorld?.sourceId === "cross");
  assert.equal(runtimeArrow.endBinding, null);
  assert.equal(composed.scene.elements.filter((element) => element.customData?.tangent?.role === "endpoint-dot").length, 1);
  const split = splitComposed([runtimeArrow], composed.origins, composed.offsets).get("root/a")[0];
  assert.deepEqual({ x: split.x, y: split.y, points: split.points }, { x: source.x, y: source.y, points: source.points });
});
