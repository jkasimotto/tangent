import test from "node:test";
import assert from "node:assert/strict";
import { sourceSceneElementMutation } from "./public/area-board.js";
import { createBlockElements, createEmptyScene, createTextElement, setBlockHidden } from "./public/area-board-core.js";

test("source persistence retains a hidden resource Block and label instead of removing them", () => {
  const oldScene = createEmptyScene();
  const [resource, label] = createBlockElements({ id: "resource", kind: "resource", ref: "0198e8c5-2be6-7d6a-a142-f0903a13a23b", title: "Checkout", x: 20, y: 30 });
  const [document, documentLabel] = createBlockElements({ id: "document", kind: "document", ref: "otto/tangent/design.md", title: "Design", x: 400, y: 30 });
  oldScene.elements.push(resource, label, document, documentLabel);
  const nextScene = setBlockHidden(oldScene, resource.id, true);
  nextScene.elements = nextScene.elements.filter((element) => ![document.id, documentLabel.id].includes(element.id));
  const before = structuredClone(nextScene);

  const mutation = sourceSceneElementMutation(nextScene, oldScene);
  const put = new Map(mutation.put.map((element) => [element.id, element]));
  assert.equal(put.get(resource.id).isDeleted, true);
  assert.equal(put.get(label.id).isDeleted, true);
  assert.equal(mutation.remove.includes(resource.id), false);
  assert.equal(mutation.remove.includes(label.id), false);
  assert.deepEqual(mutation.remove, [document.id, documentLabel.id]);
  assert.deepEqual(nextScene, before, "building persistence mutations never changes the source scene");
});

test("ordinary deleted records remain disposable while an existing hidden resource survives unrelated saves", () => {
  const oldScene = createEmptyScene();
  const [resource, label] = createBlockElements({ id: "resource", kind: "resource", ref: "0198e8c5-2be6-7d6a-a142-f0903a13a23b", title: "Checkout", x: 20, y: 30 });
  resource.isDeleted = true; label.isDeleted = true;
  const deletedInk = createTextElement({ id: "deleted-ink", text: "Discard", x: 10, y: 10, width: 80, height: 30 });
  deletedInk.isDeleted = true;
  oldScene.elements.push(resource, label, deletedInk);
  const nextScene = structuredClone(oldScene);
  nextScene.elements.push(createTextElement({ id: "new-note", text: "Unrelated edit", x: 500, y: 200, width: 120, height: 30 }));

  const mutation = sourceSceneElementMutation(nextScene, oldScene);
  assert.deepEqual(mutation.put.map((element) => element.id), [resource.id, label.id, "new-note"]);
  assert.equal(mutation.put.some((element) => element.id === deletedInk.id), false);
  assert.deepEqual(mutation.remove, []);
});
