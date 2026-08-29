import test from "node:test";
import assert from "node:assert/strict";
import core from "./public/area-board-core.js";

test("ancestry frames draw equal deterministic bands around a blank scope", () => {
  const scene = core.createEmptyScene(); scene.elements.push(core.defaultScopeBoundary("neara/pgande/megabranch/viz-input"));
  const context = { ancestors: ["neara", "neara/pgande", "neara/pgande/megabranch"].map((area) => ({ area, name: area.split("/").at(-1), boundary: null, regionForChild: null })) };
  const frames = core.ancestryFrames("neara/pgande/megabranch/viz-input", context, scene);
  assert.deepEqual(frames.map((frame) => [frame.area, frame.rect.width, frame.rect.height]), [["neara", 2440, 1840], ["neara/pgande", 2160, 1560], ["neara/pgande/megabranch", 1880, 1280], ["neara/pgande/megabranch/viz-input", 1600, 1000]]);
  assert.equal(core.stripSpatialProjections({ ...scene, elements: [...scene.elements, ...core.ancestryProjection(frames)] }).elements.length, 1);
});

test("placement uses the deepest frame, edge tolerance, and exact Area space", () => {
  const frames = [{ area: "otto", depth: 0, order: 0, rect: { x: -140, y: -140, width: 1880, height: 1280 }, toArea: { scale: 1, offsetX: -140, offsetY: -140 } }, { area: "otto/tangent", depth: 1, order: 1, rect: { x: 0, y: 0, width: 1600, height: 1000 }, toArea: { scale: 1, offsetX: 0, offsetY: 0 } }];
  assert.equal(core.areaAtPoint(frames, { x: 8, y: 8 }, 1).area, "otto/tangent");
  assert.equal(core.areaAtPoint(frames, { x: -80, y: 20 }, 1).area, "otto");
  assert.equal(core.areaAtPoint(frames, { x: -200, y: 0 }, 1), null);
  assert.deepEqual(core.toAreaSpace({ x: -80, y: 20 }, frames[0]), { x: -220, y: -120 });
});

test("fingerprint ignores Excalidraw bookkeeping but keeps authored geometry", () => {
  const element = core.createShapeElement({ id: "shape", x: 1, y: 2 });
  const first = core.authoredFingerprint([element]);
  element.version += 1; element.versionNonce += 4; element.updated += 10; element.seed += 1; element.index = "a0";
  assert.equal(core.authoredFingerprint([element]), first);
  element.x += 2;
  assert.notEqual(core.authoredFingerprint([element]), first);
});

test("blank slate conversion retires baseline cards, keeps moved cards, and is idempotent", () => {
  const area = "otto/tangent"; const own = `${area}/tangent.md`; const child = `${area}/desk/desk.md`;
  const scene = core.createEmptyScene(); delete scene.tangent;
  scene.elements.push(...core.createBlockElements({ id: "own", kind: "area", ref: own, x: 10, y: 10 }), ...core.createBlockElements({ id: "child", kind: "area", ref: child, x: 60, y: 60 }));
  const docs = [{ kind: "area", file: child, area: `${area}/desk`, title: "Desk" }];
  const converted = core.convertToBlankSlate(scene, area, docs, { own: { x: 10, y: 10 }, child: { x: 60.2, y: 60 } });
  assert.equal(converted.scene.tangent.format, 2); assert.deepEqual(converted.inboxed, [child]);
  assert.equal(converted.scene.elements.filter((element) => core.tangentOf(element) && !core.isAreaBoundary(element)).length, 0);
  assert.equal(core.convertToBlankSlate(converted.scene, area, docs, {}).changed, false);
});
