import assert from "node:assert/strict";
import test from "node:test";
import core from "./public/area-board-core.js";

const documents = [
  { file: "otto/goal-map.md", kind: "goal", title: "Make the map", status: "active" },
  { file: "otto/otto.md", kind: "document", title: "Otto" },
];

test("creates connectable fact-backed blocks with one authoritative reference", () => {
  const [block, label] = core.createBlockElements({ id: "goal", kind: "goal", ref: "otto/goal-map.md", title: "Cached" });
  assert.deepEqual(block.customData.tangent, { kind: "goal", ref: "otto/goal-map.md" });
  assert.equal(label.containerId, block.id);
  assert.equal(block.boundElements[0].id, label.id);
  assert.equal(core.factForBlock(block, documents).title, "Make the map");
});

test("fact refresh changes words but preserves geometry, style, and z-order", () => {
  const scene = core.createEmptyScene();
  scene.elements.push(...core.createBlockElements({ id: "goal", kind: "goal", ref: "otto/goal-map.md", title: "Old", x: 71, y: 93, style: { strokeColor: "#ff00ff", roughness: 2 } }));
  const before = scene.elements.map(({ id, x, y, width, height, angle, strokeColor, roughness }) => ({ id, x, y, width, height, angle, strokeColor, roughness }));
  const refreshed = core.refreshTangentFacts(scene, documents);
  assert.equal(refreshed.changed, true);
  assert.deepEqual(refreshed.scene.elements.map(({ id, x, y, width, height, angle, strokeColor, roughness }) => ({ id, x, y, width, height, angle, strokeColor, roughness })), before);
  assert.match(refreshed.scene.elements.find((element) => element.type === "text").text, /Make the map/);
});

test("a missing fact ghosts a block and restores its authored stroke style", () => {
  const scene = core.createEmptyScene();
  scene.elements.push(...core.createBlockElements({ id: "goal", kind: "goal", ref: "otto/goal-map.md", style: { strokeStyle: "dotted" } }));
  const missing = core.refreshTangentFacts(scene, []);
  assert.equal(missing.scene.elements[0].strokeStyle, "dashed");
  const restored = core.refreshTangentFacts(missing.scene, documents);
  assert.equal(restored.scene.elements[0].strokeStyle, "dotted");
  assert.deepEqual(restored.scene.elements[0].customData.tangent, { kind: "goal", ref: "otto/goal-map.md" });
});

test("fact cache prints live, stale, and duplicate signals without becoming authority", () => {
  const scene = core.createEmptyScene();
  scene.elements.push(...core.createBlockElements({ id: "one", kind: "goal", ref: "otto/goal-map.md" }));
  scene.elements.push(...core.createBlockElements({ id: "two", kind: "goal", ref: "otto/goal-map.md", x: 300 }));
  const refreshed = core.refreshTangentFacts(scene, [{ ...documents[0], live: true, stale: true }]);
  const labels = refreshed.scene.elements.filter((element) => element.type === "text").map((element) => element.text);
  assert.ok(labels.every((label) => label.includes("GOAL  ●")));
  assert.ok(labels.every((label) => label.includes("older than the notes")));
  assert.ok(labels.every((label) => label.includes("duplicate")));
  assert.deepEqual(refreshed.scene.elements[0].customData.tangent, { kind: "goal", ref: "otto/goal-map.md" });
});

test("picker and paste resolve Area-scoped entities while plain prose stays text", () => {
  const choices = core.entityChoices("otto", documents);
  assert.deepEqual(choices.map((choice) => choice.kind), ["area", "goal"]);
  assert.equal(core.referenceFromText("map", choices).ref, "otto/goal-map.md");
  assert.equal(core.referenceFromText("[[otto/goal-map.md]]", choices).kind, "goal");
  assert.equal(core.referenceFromText("https://example.com", choices).kind, "link");
  assert.equal(core.referenceFromText("remember to ask Toby", choices), null);
});

test("hidden blocks remain recoverable and the outline names facts and notes", () => {
  let scene = core.createEmptyScene();
  scene.elements.push(...core.createBlockElements({ id: "goal", kind: "goal", ref: "otto/goal-map.md", x: 0, y: 0 }));
  scene.elements.push(core.createTextElement({ id: "note", text: "why?", x: 320, y: 0 }));
  scene = core.setBlockHidden(scene, "goal", true);
  assert.equal(scene.elements.find((element) => element.id === "goal").isDeleted, true);
  scene = core.setBlockHidden(scene, "goal", false);
  assert.equal(scene.elements.find((element) => element.id === "goal").isDeleted, false);
  assert.deepEqual(core.sceneOutline(scene, documents).map((item) => item.label), ["goal: Make the map, active", "note: why?"]);
});

test("scene saves omit viewport and selection state", () => {
  const saved = core.sceneForSave([], { scrollX: 500, scrollY: -10, zoom: { value: 2 }, selectedElementIds: { a: true }, gridSize: 20, gridModeEnabled: true });
  assert.deepEqual(saved.appState, { theme: "dark", viewBackgroundColor: "#121216", gridSize: 20, gridModeEnabled: true });
});

test("viewport round-trips through disposable shell state, outside the scene save", () => {
  const appState = core.appStateWithView({ theme: "dark" }, { pan: { x: 72, y: -14 }, zoom: 1.75 });
  assert.deepEqual(appState, { theme: "dark", scrollX: 72, scrollY: -14, zoom: { value: 1.75 } });
  assert.deepEqual(core.viewFromAppState(appState), { schema: "area-board-view.v1", pan: { x: 72, y: -14 }, zoom: 1.75, foldedGroupIds: [], openInlineAreaNodeIds: [], hiddenKinds: [], showDone: false });
  assert.deepEqual(core.viewFromAppState(appState, null), core.viewFromAppState(appState), "a missing persisted view arrives from the server as null");
  assert.equal("scrollX" in core.sceneForSave([], appState).appState, false);
});
