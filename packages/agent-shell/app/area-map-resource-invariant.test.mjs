import assert from "node:assert/strict";
import test from "node:test";

import { createBlockElements, createEmptyScene } from "./public/area-board-core.js";
import { validateAreaResourceSceneTransition } from "./area-map-resource-invariant.mjs";

const ACTIVE = "11111111-1111-4111-8111-111111111111";
const REMOVED = "22222222-2222-4222-8222-222222222222";

/** Creates one scene with a canonical resource Block and bound label. */
function scene(id, sourceId = `resource-${id}`, hidden = false) {
  const value = createEmptyScene();
  value.elements.push(...createBlockElements({ id: sourceId, kind: "resource", ref: id, title: "Checkout" }).map((element) => ({ ...element, isDeleted: hidden })));
  return value;
}

/** Resolves the two fixture catalog records. */
async function resolveResource(locator) {
  if (locator.id === ACTIVE) return { state: "active" };
  if (locator.id === REMOVED) return { state: "removed" };
  return { state: "missing" };
}

test("a new resource reference requires active same-owner catalog membership", async () => {
  assert.equal(await validateAreaResourceSceneTransition({ owner: "otto/tangent", currentScene: createEmptyScene(), nextScene: scene(ACTIVE), resolveResource }), null);
  const removed = await validateAreaResourceSceneTransition({ owner: "otto/tangent", currentScene: createEmptyScene(), nextScene: scene(REMOVED), resolveResource });
  assert.equal(removed.code, "resource-not-found");
  const root = await validateAreaResourceSceneTransition({ owner: "@root", currentScene: createEmptyScene(), nextScene: scene(ACTIVE), resolveResource });
  assert.equal(root.code, "invalid-resource-target");
});

test("existing unresolved and tombstoned references survive geometry, style, and Hide edits", async () => {
  const current = scene(REMOVED);
  const changed = structuredClone(current);
  changed.elements[0].x = 900;
  changed.elements[0].strokeColor = "#ff0000";
  changed.elements[0].isDeleted = true;
  changed.elements[1].isDeleted = true;
  let reads = 0;
  /** Records an unexpected catalog lookup. */
  const resolver = async () => { reads += 1; return { state: "missing" }; };
  assert.equal(await validateAreaResourceSceneTransition({ owner: "otto/tangent", currentScene: current, nextScene: changed, resolveResource: resolver }), null);
  assert.equal(reads, 0);
});

test("visible and hidden duplicate representations are rejected before save", async () => {
  const current = scene(ACTIVE);
  const next = structuredClone(current);
  next.elements.push(...scene(ACTIVE, "copied-resource", true).elements);
  const result = await validateAreaResourceSceneTransition({ owner: "otto/tangent", currentScene: current, nextScene: next, resolveResource });
  assert.equal(result.code, "resource-representation-conflict");
  assert.deepEqual(result.sourceElementIds, [`resource-${ACTIVE}`, "copied-resource"]);
});

test("changing an existing Block to another ID revalidates the new association", async () => {
  const current = scene(REMOVED);
  const next = scene(ACTIVE, `resource-${REMOVED}`);
  assert.equal(await validateAreaResourceSceneTransition({ owner: "otto/tangent", currentScene: current, nextScene: next, resolveResource }), null);
  const invalid = scene("33333333-3333-4333-8333-333333333333", `resource-${REMOVED}`);
  assert.equal((await validateAreaResourceSceneTransition({ owner: "otto/tangent", currentScene: current, nextScene: invalid, resolveResource })).code, "resource-not-found");
});
