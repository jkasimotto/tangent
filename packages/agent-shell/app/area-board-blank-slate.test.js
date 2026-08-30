import test from "node:test";
import assert from "node:assert/strict";
import core from "./public/area-board-core.js";

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
