import assert from "node:assert/strict";
import test from "node:test";
import { rebaseAreaMapOwners, rebaseAreaMapScene } from "./public/area-map-world-conflict.js";

/** Creates one small source element for conflict fixtures. */
const element = (id, x, extra = {}) => ({ id, type: "rectangle", x, y: 0, width: 40, height: 40, ...extra });
/** Creates one complete source scene for conflict fixtures. */
const scene = (elements, files = {}) => ({ type: "excalidraw", version: 2, source: "tangent", elements, appState: { theme: "dark" }, files });

test("Keep mine preserves unrelated external elements by source ID", () => {
  const base = scene([element("mine", 0), element("external", 0)]);
  const mine = scene([element("mine", 100), element("external", 0)]);
  const current = scene([element("mine", 0), element("external", 200), element("new-external", 300)]);

  const rebased = rebaseAreaMapScene(base, mine, current);

  assert.deepEqual(rebased.elements.map(({ id, x }) => ({ id, x })), [
    { id: "mine", x: 100 },
    { id: "external", x: 200 },
    { id: "new-external", x: 300 },
  ]);
});

test("Keep mine wins when both sides changed the same source element", () => {
  const base = scene([element("same", 0)], { image: { id: "image", dataURL: "base" } });
  const mine = scene([element("same", 100, { strokeColor: "#fff" })], { image: { id: "image", dataURL: "mine" } });
  const current = scene([element("same", 200, { strokeColor: "#000" })], { image: { id: "image", dataURL: "external" }, outside: { id: "outside" } });

  const rebased = rebaseAreaMapScene(base, mine, current);

  assert.equal(rebased.elements[0].x, 100);
  assert.equal(rebased.elements[0].strokeColor, "#fff");
  assert.equal(rebased.files.image.dataURL, "mine");
  assert.deepEqual(rebased.files.outside, { id: "outside" });
});

test("multi-owner rebase keeps local deletions and external additions without changing ownership", () => {
  const baseByOwner = new Map([
    ["neara", scene([element("removed", 0)])],
    ["neara/delivery", scene([element("standard", 0)])],
  ]);
  const mineByOwner = new Map([
    ["neara", scene([])],
    ["neara/delivery", scene([element("standard", 80)])],
  ]);
  const currentByOwner = new Map([
    ["neara", scene([element("removed", 20), element("external", 30)])],
    ["neara/delivery", scene([element("standard", 40), element("external-standard", 60)])],
  ]);

  const rebased = rebaseAreaMapOwners({ baseByOwner, mineByOwner, currentByOwner });

  assert.deepEqual(rebased.get("neara").elements.map((item) => item.id), ["external"]);
  assert.deepEqual(rebased.get("neara/delivery").elements.map(({ id, x }) => ({ id, x })), [
    { id: "standard", x: 80 },
    { id: "external-standard", x: 60 },
  ]);
});
