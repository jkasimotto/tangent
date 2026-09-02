import assert from "node:assert/strict";
import test from "node:test";
import core from "./public/area-board-core.js";

const documents = [
  { file: "otto/goal-map.md", area: "otto", kind: "goal", title: "Make the map", status: "active" },
  { file: "otto/otto.md", kind: "document", title: "Otto" },
];

test("first spatial migration makes direct children regions, deeper Areas shortcuts, and keeps ink", () => {
  const records = [
    { file: "neara/pgande/pgande.md", area: "neara/pgande", kind: "area", title: "PG&E" },
    { file: "neara/pgande/megabranch/megabranch.md", area: "neara/pgande/megabranch", kind: "area", title: "Megabranch" },
  ];
  const scene = core.createEmptyScene();
  scene.elements.push(...core.createBlockElements({ id: "parent", kind: "area", ref: records[0].file, x: 100, y: 120 }));
  scene.elements.push(...core.createBlockElements({ id: "deep", kind: "area", ref: records[1].file, x: 700, y: 120 }));
  scene.elements.push(core.createTextElement({ id: "ink", text: "ask Toby", x: 50, y: 600 }));
  const migrated = core.migrateAreaCardsToRegions(scene, "neara", records);
  assert.equal(migrated.changed, true);
  assert.equal(core.isAreaBoundary(migrated.scene.elements[0]), true);
  assert.equal(core.isAreaRegion(migrated.scene.elements.find((element) => element.id === "parent")), true);
  assert.equal(migrated.scene.elements.find((element) => element.id === "deep").customData.tangent.role, "shortcut");
  assert.equal(migrated.scene.elements.find((element) => element.id === "ink").text, "ask Toby");
  assert.equal(core.migrateAreaCardsToRegions(migrated.scene, "neara", records).changed, false, "the migration runs once");
});

test("creates connectable fact-backed blocks with one authoritative reference", () => {
  const [block, label] = core.createBlockElements({ id: "goal", kind: "goal", ref: "otto/goal-map.md", title: "Cached" });
  assert.deepEqual(block.customData.tangent, { kind: "goal", ref: "otto/goal-map.md" });
  assert.equal(label.containerId, block.id);
  assert.equal(block.boundElements[0].id, label.id);
  assert.equal(core.factForBlock(block, documents).title, "Make the map");
});

test("resource metadata is a compatible inert Block and source ownership scopes resources and Links", () => {
  const [resource] = core.createBlockElements({ id: "resource", kind: "resource", ref: "0198e8c5-2be6-7d6a-a142-f0903a13a23b", title: "Cached words" });
  resource.customData.tangentWorld = { owner: "otto/tangent", sourceId: "resource" };
  assert.deepEqual(core.tangentOf(resource), { kind: "resource", ref: "0198e8c5-2be6-7d6a-a142-f0903a13a23b" });
  assert.deepEqual(core.factForBlock(resource, documents), { kind: "resource", title: "Map resource", status: "unresolved", ghost: true, ref: "0198e8c5-2be6-7d6a-a142-f0903a13a23b" });
  assert.equal(core.areaForBlock(resource, documents), "otto/tangent");
  assert.equal(core.splitReference(resource.customData.tangent.ref).file, resource.customData.tangent.ref, "generic reference splitting is never resource resolution authority");

  const [link] = core.createBlockElements({ id: "link", kind: "link", ref: "https://example.com/exact" });
  link.customData.tangentWorld = { owner: "otto/other", sourceId: "link" };
  assert.equal(core.areaForBlock(link, documents), "otto/other");
  delete link.customData.tangentWorld;
  assert.equal(core.areaForBlock(link, documents, "otto/explicit"), "otto/explicit");
});

test("resource duplicate facts use owner plus ID and ephemeral success rails never dirty the scene", () => {
  const scene = core.createEmptyScene();
  const one = core.createBlockElements({ id: "one", kind: "resource", ref: "same-local-id", title: "One" });
  const two = core.createBlockElements({ id: "two", kind: "resource", ref: "same-local-id", title: "Two" });
  one.forEach((element) => { element.customData = { ...(element.customData ?? {}), tangentWorld: { owner: "otto/one", sourceId: element.id } }; });
  two.forEach((element) => { element.customData = { ...(element.customData ?? {}), tangentWorld: { owner: "otto/two", sourceId: element.id } }; });
  scene.elements.push(...one, ...two);
  const distinct = core.refreshTangentFacts(scene, []);
  assert.ok(distinct.scene.elements.filter((element) => element.type === "text").every((element) => !element.text.includes("duplicate")));
  two.forEach((element) => { element.customData.tangentWorld.owner = "otto/one"; });
  const duplicate = core.refreshTangentFacts({ ...scene, elements: [...one, ...two] }, []);
  assert.ok(duplicate.scene.elements.filter((element) => element.type === "text").every((element) => element.text.includes("duplicate")));

  const fingerprint = core.authoredFingerprint(scene.elements);
  const rail = { id: "rail", type: "rectangle", x: 1, y: 2, width: 3, height: 4, customData: { tangentWorldEphemeral: true } };
  assert.equal(core.authoredFingerprint([...scene.elements, rail]), fingerprint);
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
  assert.deepEqual(saved.appState, { viewBackgroundColor: "#ffffff", gridSize: 20, gridModeEnabled: true });
});

test("viewport round-trips through disposable shell state, outside the scene save", () => {
  const appState = core.appStateWithView({ theme: "dark" }, { pan: { x: 72, y: -14 }, zoom: 1.75 });
  assert.deepEqual(appState, { theme: "dark", scrollX: 72, scrollY: -14, zoom: { value: 1.75 } });
  assert.deepEqual(core.viewFromAppState(appState), { schema: "area-board-view.v1", pan: { x: 72, y: -14 }, zoom: 1.75, foldedGroupIds: [], openInlineAreaNodeIds: [], hiddenKinds: [], showDone: false });
  assert.deepEqual(core.viewFromAppState(appState, null), core.viewFromAppState(appState), "a missing persisted view arrives from the server as null");
  assert.equal("scrollX" in core.sceneForSave([], appState).appState, false);
});

test("scenes store Excalidraw's light-theme colours so the dark theme inverts them once", () => {
  assert.deepEqual(core.createEmptyScene().appState, { viewBackgroundColor: "#ffffff" });
  const [block, label] = core.createBlockElements({ id: "goal", kind: "goal", ref: "otto/goal-map.md" });
  assert.equal(block.strokeColor, "#1971c2");
  assert.equal(block.backgroundColor, "#a5d8ff");
  assert.equal(label.strokeColor, "#1e1e1e", "the label uses the same ink as text a person types");
  assert.equal(core.createTextElement({ id: "note", text: "why?" }).strokeColor, "#1e1e1e");
});

test("a scene saved with dark-theme colours is rewritten once on load", () => {
  const legacy = { type: "excalidraw", version: 2, source: "test", appState: { theme: "dark", viewBackgroundColor: "#121216" }, files: {}, elements: [
    { id: "b", type: "rectangle", strokeColor: "#a5d8ff", backgroundColor: "#1e1e2e" },
    { id: "t", type: "text", strokeColor: "#f1f3f5", backgroundColor: "transparent" },
    { id: "n", type: "text", strokeColor: "#e9ecef", backgroundColor: "transparent" },
    { id: "own", type: "arrow", strokeColor: "#e03131", backgroundColor: "transparent" },
  ] };
  const { scene, changed } = core.normalizeSceneColors(legacy);
  assert.equal(changed, true);
  assert.deepEqual(scene.appState, { viewBackgroundColor: "#ffffff" });
  assert.deepEqual(scene.elements.map((element) => [element.strokeColor, element.backgroundColor]), [["#1971c2", "#a5d8ff"], ["#1e1e1e", "transparent"], ["#1e1e1e", "transparent"], ["#e03131", "transparent"]]);
  assert.equal(legacy.appState.viewBackgroundColor, "#121216", "the input is not mutated");
  const current = core.createEmptyScene();
  assert.equal(core.normalizeSceneColors(current).changed, false);
  assert.equal(core.normalizeSceneColors(null).scene, null);
});

test("block labels wrap long titles instead of being clipped by the block", () => {
  const label = core.blockLabel({ kind: "document", title: "A second comment lands on the text Julian selected", status: "active" });
  assert.deepEqual(label.split("\n"), ["DOCUMENT", "A second comment lands on", "the text Julian selected", "active"]);
  assert.ok(label.split("\n").every((line) => line.length <= 26));
  assert.equal(core.blockLabel({ kind: "area", title: "desk", status: "active", live: true }), "AREA  ●\ndesk\nactive");
  assert.deepEqual(core.blockLabel({ kind: "goal", title: "Map", status: "active · older than the notes · duplicate" }).split("\n"), ["GOAL", "Map", "active", "older than the notes", "duplicate"], "status phrases stay whole");
});
