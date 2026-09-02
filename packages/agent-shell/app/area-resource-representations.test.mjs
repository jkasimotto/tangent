import assert from "node:assert/strict";
import test from "node:test";

import { canvasHash, parseAreaCanvas, serializeAreaCanvas } from "./area-canvas.mjs";
import { createAreaResourceRepresentationCoordinator } from "./area-resource-representations.mjs";
import { createBlockElements, createEmptyScene, setBlockHidden } from "./public/area-board-core.js";
import { placeBlockAtNearestFreePoint, placeBlockInSourceScene } from "./public/area-map-world-core.js";

const OWNER = "otto";
const VIEWED_FROM = "otto/tangent";
const RESOURCE_ID = "0198e8c5-2be6-7d6a-a142-f0903a13a23b";
const RESOURCE = { owner: OWNER, id: RESOURCE_ID };

/** Builds one exact representation request with optional field overrides. */
function request(kind, operationId, overrides = {}) {
  return {
    schema: "area-map-resource-representation.v1",
    operationId,
    kind,
    viewedFrom: VIEWED_FROM,
    resource: RESOURCE,
    ...overrides,
  };
}

/** Returns the active current-resolution shape used by the shared fact model. */
function activeResolution(resource = RESOURCE, label = "Feature checkout") {
  return { state: "current", value: { locator: structuredClone(resource), label } };
}

/** Creates an in-memory transaction authority with exact hash and preflight behavior. */
function fixture({ scene = createEmptyScene(), status = "", resolve = async (resource) => activeResolution(resource), placementContextReader = null, forceConflict = false, saveFailure = null } = {}) {
  let currentScene = structuredClone(scene);
  let currentText = serializeAreaCanvas(currentScene);
  let currentHash = canvasHash(currentText);
  const reads = [];
  const saves = [];
  const receipts = new Map();
  let commits = 0;
  const transactions = {
    /** Holds a complete fixture read behind one transaction lease. */
    async withRead(action) { return await action(); },
    /** Reads the exact current source shard. */
    async read(owner) {
      reads.push(owner);
      return { area: owner, ok: true, exists: true, hash: currentHash, text: currentText, scene: structuredClone(currentScene), canvas: structuredClone(currentScene) };
    },
    /** Applies preflight and optimistic hash checks before installing one source scene. */
    async saveMany(writes, options) {
      saves.push({ writes: structuredClone(writes), options });
      if (saveFailure) return structuredClone(saveFailure);
      const digest = JSON.stringify({ writes, intent: options.intent ?? null });
      const prior = receipts.get(options.operationId);
      if (prior) {
        if (prior.digest !== digest) return { status: 409, code: "operation-id-reused", error: "operation ID reused", operationId: options.operationId, committed: false };
        return { ...structuredClone(prior.result), idempotent: true };
      }
      const preflight = await options.preflight?.();
      if (Number(preflight?.status ?? 0) >= 400) return { ...preflight, operationId: options.operationId, committed: false };
      if (forceConflict || writes[0].baseHash !== currentHash) {
        return { status: 409, code: "shard-conflict", error: "source changed", operationId: options.operationId, committed: false, currentHashes: { [writes[0].area]: currentHash } };
      }
      const nextScene = structuredClone(writes[0].canvas);
      const nextText = serializeAreaCanvas(nextScene);
      const nextHash = canvasHash(nextText);
      const changed = nextHash !== currentHash;
      if (changed) {
        currentScene = nextScene;
        currentText = nextText;
        currentHash = nextHash;
        commits += 1;
      }
      const result = {
        committed: true,
        idempotent: !changed,
        operationId: options.operationId,
        hash: currentHash,
        hashes: { [writes[0].area]: currentHash },
        ...(options.acknowledgement ? { acknowledgement: structuredClone(options.acknowledgement) } : {}),
      };
      receipts.set(options.operationId, { digest, result: structuredClone(result) });
      return result;
    },
  };
  const coordinator = createAreaResourceRepresentationCoordinator({
    transactions,
    resolveCatalogResource: resolve,
    /** Returns the nearest hidden Area status, or an empty active status. */
    async readAreaStatus() { return status; },
    placementContextReader,
  });
  return {
    coordinator, reads, saves,
    /** Returns how many source scenes crossed the fixture commit boundary. */
    commits: () => commits,
    /** Returns a defensive copy of the installed source scene. */
    scene: () => structuredClone(currentScene),
  };
}

/** Returns one parsed authoritative scene from a success receipt. */
function receiptScene(result) {
  assert.equal(result.sourceUpdates.length, 1);
  const parsed = parseAreaCanvas(result.sourceUpdates[0].serializedSource);
  assert.equal(parsed.ok, true);
  return parsed.scene;
}

/** Selects authored geometry, style, grouping, binding, and z-order fields. */
function authoredFields(element) {
  return Object.fromEntries([
    "id", "type", "x", "y", "width", "height", "angle", "strokeColor", "backgroundColor", "fillStyle", "strokeWidth", "strokeStyle", "roughness", "opacity",
    "groupIds", "frameId", "index", "roundness", "seed", "boundElements", "link", "locked", "containerId", "text", "originalText", "fontSize", "fontFamily", "textAlign", "verticalAlign",
  ].filter((key) => Object.hasOwn(element, key)).map((key) => [key, structuredClone(element[key])]));
}

test("Place uses shared Block creation and nearest-free world layout in the resource source owner", async () => {
  const scene = createEmptyScene();
  const existing = createBlockElements({ id: "existing", kind: "goal", ref: "otto/goal-existing.md", title: "Existing", x: 10, y: 24 });
  scene.elements.push(...existing);
  const expected = placeBlockInSourceScene(
    scene,
    { kind: "resource", ref: RESOURCE_ID, title: "Feature checkout" },
    `tangent-resource-${RESOURCE_ID}`,
  ).root;
  const resolved = [];
  const value = fixture({
    scene,
    /** Records the exact owner-local catalog lookup used before and during preflight. */
    async resolve(resource) { resolved.push(structuredClone(resource)); return activeResolution(resource); },
  });

  const result = await value.coordinator.apply(request("place", "place-1"), { session: "otto-brain" });

  assert.equal(result.status, 200);
  assert.equal(result.representation, "on-map");
  assert.equal(result.idempotent, false);
  assert.deepEqual(resolved, [RESOURCE, RESOURCE], "Place rechecks active catalog evidence under transaction preflight");
  assert.deepEqual(value.reads, [OWNER]);
  assert.equal(value.saves.length, 1);
  assert.equal(value.saves[0].writes[0].area, OWNER);
  assert.equal(value.saves[0].options.area, OWNER);
  assert.equal(value.saves[0].options.worldId, "area-map-resources");
  assert.equal(value.saves[0].options.session, "otto-brain");
  const placedScene = receiptScene(result);
  const root = placedScene.elements.find((element) => element.id === result.sourceId);
  const label = placedScene.elements.find((element) => element.containerId === root.id);
  assert.deepEqual({ x: root.x, y: root.y, width: root.width, height: root.height }, {
    x: expected.x, y: expected.y, width: expected.width, height: expected.height,
  });
  assert.deepEqual(root.customData.tangent, { kind: "resource", ref: RESOURCE_ID });
  assert.equal(root.customData.tangentWorld, undefined, "source ownership stays implicit in the source shard");
  assert.equal(label.containerId, root.id);
  assert.match(label.text, /RESOURCE.*Feature checkout/s);
  assert.deepEqual(result.sourceUpdates[0], { owner: OWNER, serializedSource: result.sourceUpdates[0].serializedSource, hash: canvasHash(result.sourceUpdates[0].serializedSource) });
});

test("Place uses composed owner geometry and derived-child obstacles, then rechecks its world revision", async () => {
  const scene = createEmptyScene();
  const context = {
    revision: "force-widened-world-1",
    point: { x: 700, y: 420 },
    occupied: [{ x: 560, y: 354, width: 460, height: 320 }],
  };
  const reads = [];
  const expected = placeBlockAtNearestFreePoint(
    scene,
    { kind: "resource", ref: RESOURCE_ID, title: "Feature checkout" },
    context.point,
    `tangent-resource-${RESOURCE_ID}`,
    { occupied: context.occupied },
  ).root;
  const value = fixture({
    scene,
    /** Models the source-local projection of one force-widened composed Area and its child region. */
    async placementContextReader(owner) { reads.push(owner); return structuredClone(context); },
  });

  const result = await value.coordinator.apply(request("place", "composed-place-1"));

  assert.equal(result.status, 200);
  assert.deepEqual(reads, [OWNER, OWNER], "Place rechecks the composed world under transaction preflight");
  const root = receiptScene(result).elements.find((element) => element.id === result.sourceId);
  assert.deepEqual({ x: root.x, y: root.y, width: root.width, height: root.height }, {
    x: expected.x, y: expected.y, width: expected.width, height: expected.height,
  });
  assert.equal(root.y + root.height < context.occupied[0].y, true, "the shared nearest-free solver avoids the derived child rectangle");
});

test("Place refuses a composed-world revision race before source installation", async () => {
  let revision = 0;
  const value = fixture({
    /** Returns a changed complete-world revision during locked preflight. */
    async placementContextReader() {
      revision += 1;
      return { revision: `world-${revision}`, point: { x: 300, y: 300 }, occupied: [] };
    },
  });

  const result = await value.coordinator.apply(request("place", "composed-race-1"));

  assert.equal(result.status, 409);
  assert.equal(result.code, "resource-representation-conflict");
  assert.equal(value.commits(), 0);
  assert.equal(result.sourceUpdates, undefined);
});

test("Hide retains the exact root and bound label as deleted, then Restore revives authored geometry and style", async () => {
  const scene = createEmptyScene();
  const elements = createBlockElements({
    id: "styled-resource",
    kind: "resource",
    ref: RESOURCE_ID,
    title: "Styled checkout",
    x: 213,
    y: 377,
    width: 345,
    height: 167,
    style: { strokeColor: "#ff00ff", backgroundColor: "#123456", strokeStyle: "dotted", roughness: 2, opacity: 73, groupIds: ["group-one"], frameId: "frame-one", index: "a7" },
  });
  scene.elements.push(...elements);
  const beforeRoot = authoredFields(elements[0]);
  const beforeLabel = authoredFields(elements[1]);
  const value = fixture({ scene });

  const hidden = await value.coordinator.apply(request("hide", "hide-1"));
  assert.equal(hidden.status, 200);
  assert.equal(hidden.representation, "hidden");
  const hiddenScene = receiptScene(hidden);
  assert.equal(hiddenScene.elements.find((element) => element.id === elements[0].id).isDeleted, true);
  assert.equal(hiddenScene.elements.find((element) => element.id === elements[1].id).isDeleted, true);

  const restored = await value.coordinator.apply(request("restore", "restore-1"));
  assert.equal(restored.status, 200);
  assert.equal(restored.representation, "on-map");
  const restoredScene = receiptScene(restored);
  const restoredRoot = restoredScene.elements.find((element) => element.id === elements[0].id);
  const restoredLabel = restoredScene.elements.find((element) => element.id === elements[1].id);
  assert.equal(restoredRoot.isDeleted, false);
  assert.equal(restoredLabel.isDeleted, false);
  assert.deepEqual(authoredFields(restoredRoot), beforeRoot);
  assert.deepEqual(authoredFields(restoredLabel), beforeLabel);
  assert.equal(value.commits(), 2);
});

test("a visible-plus-hidden duplicate representation refuses every source mutation", async () => {
  const scene = createEmptyScene();
  scene.elements.push(
    ...createBlockElements({ id: "visible", kind: "resource", ref: RESOURCE_ID, title: "Visible" }),
    ...createBlockElements({ id: "hidden", kind: "resource", ref: RESOURCE_ID, title: "Hidden", x: 400 }),
  );
  const duplicated = setBlockHidden(scene, "hidden", true);
  const value = fixture({ scene: duplicated });

  const result = await value.coordinator.apply(request("hide", "duplicate-1"));

  assert.equal(result.status, 409);
  assert.equal(result.code, "resource-representation-conflict");
  assert.equal(result.representationCount, 2);
  assert.equal(value.saves.length, 0);
  assert.equal(value.commits(), 0);
});

test("Hide is idempotent for one consistently retained hidden root and label", async () => {
  const scene = createEmptyScene();
  const elements = createBlockElements({ id: "hidden", kind: "resource", ref: RESOURCE_ID, title: "Hidden", x: 44, y: 55 });
  scene.elements.push(...elements);
  const value = fixture({ scene: setBlockHidden(scene, "hidden", true) });

  const result = await value.coordinator.apply(request("hide", "hide-again"));

  assert.equal(result.status, 200);
  assert.equal(result.idempotent, true);
  assert.equal(result.representation, "hidden");
  assert.equal(value.saves.length, 1, "the no-op still crosses transaction authority to claim its operation ID");
  const retained = receiptScene(result);
  assert.equal(retained.elements.find((element) => element.id === elements[0].id).isDeleted, true);
  assert.equal(retained.elements.find((element) => element.id === elements[1].id).isDeleted, true);

  const replay = await value.coordinator.apply(request("hide", "hide-again"));
  assert.equal(replay.idempotent, true);
  assert.deepEqual(replay.sourceUpdates, result.sourceUpdates);
  const reused = await value.coordinator.apply(request("restore", "hide-again"));
  assert.equal(reused.status, 409);
  assert.equal(reused.code, "operation-id-reused");
  assert.equal(reused.sourceUpdates, undefined);
});

test("typed not-found, read-only, unsafe-owner, and optimistic conflict results never claim a source update", async () => {
  const missing = fixture({
    /** Returns explicit missing catalog evidence. */
    async resolve() { return { state: "missing" }; },
  });
  const notFound = await missing.coordinator.apply(request("place", "missing-1"));
  assert.equal(notFound.status, 404);
  assert.equal(notFound.code, "resource-not-found");
  assert.equal(notFound.sourceUpdates, undefined);
  assert.equal(missing.saves.length, 0);

  const archived = fixture({ status: "archived" });
  const readOnly = await archived.coordinator.apply(request("place", "archived-1"));
  assert.equal(readOnly.status, 423);
  assert.equal(readOnly.code, "area-resource-read-only");
  assert.equal(archived.reads.length, 0);

  const unsafe = fixture();
  const rootOwned = await unsafe.coordinator.apply(request("place", "root-1", { viewedFrom: "@root", resource: { owner: "@root", id: RESOURCE_ID } }));
  assert.equal(rootOwned.status, 422);
  assert.equal(rootOwned.code, "invalid-resource-target");
  assert.equal(unsafe.reads.length, 0);

  const scene = createEmptyScene();
  scene.elements.push(...createBlockElements({ id: "visible", kind: "resource", ref: RESOURCE_ID, title: "Visible" }));
  const conflicted = fixture({ scene, forceConflict: true });
  const conflict = await conflicted.coordinator.apply(request("hide", "conflict-1"));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.code, "resource-representation-conflict");
  assert.deepEqual(conflict.currentHashes, { [OWNER]: canvasHash(serializeAreaCanvas(scene)) });
  assert.equal(conflict.sourceUpdates, undefined);
  assert.equal(conflicted.commits(), 0);

  const recovering = fixture({
    scene,
    saveFailure: { status: 503, code: "recovery-required", error: "internal recovery detail", committed: false },
  });
  const recovery = await recovering.coordinator.apply(request("hide", "recovery-1"));
  assert.equal(recovery.status, 503);
  assert.equal(recovery.code, "resource-transaction-recovery");
  assert.equal(recovery.sourceUpdates, undefined);
});

test("Place loses authority safely when the exact catalog record becomes a tombstone during preflight", async () => {
  let calls = 0;
  const value = fixture({
    /** Returns active evidence for the initial read and a tombstone for locked preflight. */
    async resolve(resource) {
      calls += 1;
      return calls === 1 ? activeResolution(resource) : { state: "tombstone", owner: resource.owner, record: { id: resource.id, membership: { state: "removed" } } };
    },
  });

  const result = await value.coordinator.apply(request("place", "catalog-race-1"));

  assert.equal(result.status, 404);
  assert.equal(result.code, "resource-not-found");
  assert.equal(result.operationId, "catalog-race-1");
  assert.equal(value.saves.length, 1, "the transaction owns the final catalog preflight");
  assert.equal(value.commits(), 0);
  assert.equal(result.sourceUpdates, undefined);
});

test("source-owner semantics allow ancestors only and Hide or Restore do not require a live catalog record", async () => {
  const scene = createEmptyScene();
  scene.elements.push(...createBlockElements({ id: "gone", kind: "resource", ref: RESOURCE_ID, title: "Gone", x: 20, y: 30 }));
  let catalogReads = 0;
  const value = fixture({
    scene,
    /** Proves source-only commands do not consult missing catalog authority. */
    async resolve() { catalogReads += 1; return { state: "missing" }; },
  });

  const hidden = await value.coordinator.apply(request("hide", "gone-hide-1"));
  const restored = await value.coordinator.apply(request("restore", "gone-restore-1"));
  assert.equal(hidden.status, 200);
  assert.equal(restored.status, 200);
  assert.equal(catalogReads, 0);
  assert.deepEqual(value.saves.map((entry) => entry.writes[0].area), [OWNER, OWNER]);

  const sibling = await value.coordinator.apply(request("hide", "sibling-1", { viewedFrom: "neara", resource: RESOURCE }));
  assert.equal(sibling.status, 422);
  assert.equal(sibling.code, "invalid-resource-target");
  assert.deepEqual(value.reads, [OWNER, OWNER]);
});
