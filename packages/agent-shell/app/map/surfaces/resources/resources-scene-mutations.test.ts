import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createAreaMapWorldController, createEmptyScene, placeBlockInSourceScene, tangentOf } from "../../kernel/kernel-boundary.ts";
import type { AreaMapController, RegionKey, ResourceEntity, ResourcePanelProjection, ResourcePanelRow, SceneElement, ShardHash, SourceScene, TreeDigest, World, WorldDigest, WorldId } from "../../kernel/kernel-types.ts";
import { rect } from "../../units/frames.ts";
import { areaKey, operationId, shardOwner, sourceId } from "../../units/ids.ts";
import type { AreaKey, OperationId, ResourceId } from "../../units/ids.ts";
import { count, sourcePx } from "../../units/units.ts";
import { createResourceEffects, loadResources } from "./resources-effects.ts";
import type { ResourceEffectDeps, ResourceEffects, ResourceRequestInit } from "./resources-effects.ts";
import {
  applySceneResourceMutation, associateGenericLink, confirmAddBack, hideResourceOnMap, representationForRow,
  requestAddBack, retrySceneResourceMutation, sourceResourceBlock, undoResourceChange,
} from "./resources-scene-mutations.ts";
import { INITIAL_RESOURCES_STATE, resourcesReducer } from "./resources-store.ts";
import type { ResourcesState } from "./resources-state.ts";
import type { ResourcesAction } from "./resources-store-actions.ts";

const TANGENT = areaKey("otto/tangent");
const OTTO = areaKey("otto");

/** The Tangent shard: one placed worktree Block and one Block whose resource was removed. */
function tangentScene(): SourceScene {
  const placed = placeBlockInSourceScene(createEmptyScene(), { kind: "resource", ref: "worktree-main", title: "Main checkout" }, sourceId("block-main")).scene;
  return placeBlockInSourceScene(placed, { kind: "resource", ref: "gone-old", title: "Removed checkout" }, sourceId("block-gone")).scene;
}

/** One ready Area node over a scene. */
function areaNode(key: AreaKey, parent: string, scene: SourceScene): World["areas"][number] {
  return {
    key, parent: shardOwner(parent), children: [], depth: count(key.split("/").length - 1),
    region: {
      key: `${parent}>${key}` as RegionKey, owner: shardOwner(parent), child: key,
      sourceId: sourceId(`region-${key}`), labelSourceId: sourceId(`region-${key}-label`),
      source: "stored", storedRect: rect("source", sourcePx(0), sourcePx(0), sourcePx(1200), sourcePx(800)),
    },
    shard: { owner: shardOwner(key), hash: `hash-${key}` as ShardHash, revision: null, state: "ready", elementCount: count(scene.elements.length), blockCount: count(scene.elements.length ? 1 : 0), ownBlockHull: null, ownInkHull: null, scene },
  };
}

/** A two-Area world whose Tangent shard holds the two resource Blocks. */
function world(): World {
  return {
    schema: "area-map-world.v1", worldId: "world" as WorldId, treeRevision: "tree" as TreeDigest, worldRevision: "rev" as WorldDigest, locatedArea: TANGENT,
    rootShard: { owner: shardOwner("@root"), hash: null, revision: null, state: "deferred", elementCount: count(0), blockCount: count(0), ownBlockHull: null, ownInkHull: null },
    areas: [areaNode(OTTO, "@root", createEmptyScene()), areaNode(TANGENT, "otto", tangentScene())],
  };
}

/** One worktree entity as the server serves it. */
function entity(id: string, label: string): ResourceEntity {
  return {
    locator: { owner: shardOwner(TANGENT), id: id as ResourceId }, label,
    target: { kind: "worktree", path: `/tmp/${id}` },
    local: { state: "not-checked", value: null, checkedAt: null }, link: null,
    representation: { state: "current", value: "never-placed" }, warnings: [],
  };
}

/** One removed entity whose Last-known target the person may add back. */
function goneEntity(reason: string): ResourceEntity {
  return { locator: { owner: shardOwner(TANGENT), id: "gone-old" as ResourceId }, reason, lastKnown: { label: "Removed checkout", target: { kind: "worktree", path: "/tmp/removed" } }, representation: { state: "current", value: "on-map" }, warnings: [] };
}

/** One direct row over an entity. */
function row(value: ResourceEntity): ResourcePanelRow {
  return { viewedFrom: TANGENT, relation: { kind: "direct" }, alsoFrom: [], launchMatch: { state: "current", value: false }, entity: value };
}

/** A current projection over the named rows. */
function projection(rows: readonly ResourcePanelRow[]): ResourcePanelProjection {
  return { state: "current", viewedFrom: TANGENT, rows: [...rows], legacyReview: [], suggestions: [], catalogs: [{ owner: shardOwner(TANGENT), revision: "cat-child" }, { owner: shardOwner(OTTO), revision: "cat-parent" }] };
}

/** One recorded request. */
type Call = { readonly path: string; readonly body: { readonly operationId?: string; readonly expectedScenes?: { owner: string; hash: string }[]; readonly expectedCatalogs?: { owner: string }[]; readonly mutation?: { readonly kind?: string; readonly token?: string } } | null };

/** A recording harness over a real controller with the two placed Blocks. */
type Harness = {
  readonly effects: ResourceEffects;
  readonly controller: AreaMapController;
  readonly calls: Call[];
  readonly said: string[];
  readonly hidden: SceneElement[];
  readonly routes: Map<string, (body: unknown) => unknown>;
  readonly state: () => ResourcesState;
  readonly dispatch: (state: ResourcesState) => void;
  readonly applies: () => Call[];
};

/** Builds the harness with writes enabled. */
function harness(): Harness {
  const controller = createAreaMapWorldController({ world: world() });
  const calls: Call[] = [];
  const said: string[] = [];
  const hidden: SceneElement[] = [];
  const routes = new Map<string, (body: unknown) => unknown>();
  let state = INITIAL_RESOURCES_STATE;
  let minted = 0;
  /** Records one request and answers it from the route table, or with null when no route matches it. */
  async function api(path: string, init?: ResourceRequestInit): Promise<unknown> {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ path, body });
    const route = [...routes.keys()].find((prefix) => path.startsWith(prefix));
    const answer = route ? routes.get(route) : undefined;
    return answer ? answer(body) : null;
  }

  /** Reduces one action into the harness store. */
  function dispatch(action: ResourcesAction): void {
    state = resourcesReducer(state, action);
  }

  /** The store's current state. */
  function getState(): ResourcesState {
    return state;
  }

  /** Replaces the store's state, so a test can start from one it built itself. */
  function setState(next: ResourcesState): void {
    state = next;
  }

  /** Records one spoken sentence. */
  function announce(text: string): void {
    said.push(text);
  }

  /** Mints the next operation id, counted so a test can name the one it expects. */
  function mintOperationId(): OperationId {
    minted += 1;
    return operationId(`op-${minted}`);
  }

  /** Resource writes are enabled in every fixture. */
  function writesEnabled(): boolean {
    return true;
  }

  /** The cadence never runs in a mutation fixture, so it starts nothing and stops nothing. */
  function every(): () => void {
    return () => undefined;
  }

  /** Every request the panel sent to the mutation route. */
  function applies(): Call[] {
    return calls.filter((call) => call.path.endsWith("/apply"));
  }

  /** Records the composed Block the panel asked the Map to hide. */
  function hideBlock(block: SceneElement): void {
    hidden.push(block);
  }

  const deps: ResourceEffectDeps = { api, dispatch, getState, controller, announce, mintOperationId, writesEnabled, scheduler: { every }, hideBlock };
  return { effects: createResourceEffects(deps), controller, calls, said, hidden, routes, state: getState, dispatch: setState, applies };
}

/** The Tangent source with one Block's resource reference replaced, as a source update the server would answer with. */
function sourceUpdate(test: Harness, blockId: string, ref: string, hash: string): unknown {
  const scene = structuredClone(test.controller.world().areas.find((node) => node.key === TANGENT)?.shard.scene);
  const block = scene?.elements.find((element) => element.id === blockId);
  if (!scene || !block) throw new Error("Missing fixture source block");
  block.customData = { ...(block.customData ?? {}), tangent: { kind: "resource", ref } };
  return { owner: shardOwner(TANGENT), hash, serializedSource: JSON.stringify(scene), treeRevision: `tree-${hash}`, worldRevision: `world-${hash}` };
}

/** Opens the panel on Tangent over one current read of the named rows. */
async function opened(test: Harness, rows: readonly ResourcePanelRow[]): Promise<void> {
  test.dispatch(resourcesReducer(test.state(), { type: "open", area: TANGENT }));
  test.routes.set("/api/areas/map-resources?", () => projection(rows));
  await loadResources(test.effects, TANGENT, { refreshObservations: false });
}

test("the Map state of a row reads the live source bytes ahead of the catalog's cadence fact", () => {
  const test = harness();
  const main = row(entity("worktree-main", "Main checkout"));
  assert.equal(sourceResourceBlock(test.controller.world(), main)?.id, "block-main");
  assert.equal(representationForRow(test.controller.world(), main), "on-map", "a placed Block is on the Map before the catalog says so");
  assert.equal(representationForRow(test.controller.world(), row(entity("never-placed", "Never placed"))), "never-placed");
  assert.equal(sourceResourceBlock(test.controller.world(), null), null);
});

test("a scene mutation waits for the saved Map, fences the exact source, and installs the source update", async () => {
  const test = harness();
  await opened(test, [row(entity("worktree-main", "Main checkout"))]);
  const hash = test.controller.world().areas.find((node) => node.key === TANGENT)?.shard.hash;
  test.routes.set("/api/areas/map-resources/apply", () => ({ effect: "associate-generic-link", projection: projection([]), sourceUpdates: [sourceUpdate(test, "block-main", "associated-review", "scene-associated")], resource: null, undo: { state: "available", token: "undo-associated" } }));
  const result = await applySceneResourceMutation(test.effects, { kind: "associate-generic-link", owner: shardOwner(TANGENT), sourceElementId: sourceId("block-main"), labelForNewRecord: null }, { success: "Link added to Area resources." });
  assert.ok(result);
  const sent = test.applies()[0]?.body;
  assert.deepEqual(sent?.expectedScenes, [{ owner: shardOwner(TANGENT), hash }]);
  assert.deepEqual(sent?.expectedCatalogs?.map((catalog) => catalog.owner), [shardOwner(TANGENT)], "a scene mutation never fences a catalog it does not write");
  const installed = test.controller.world().areas.find((node) => node.key === TANGENT)?.shard.scene?.elements.find((element) => element.id === "block-main");
  assert.equal(tangentOf(installed)?.ref, "associated-review", "the server's source update is installed as authority");
  assert.deepEqual([test.state().undo?.sourceCoupled, test.state().undo?.owner], [true, TANGENT]);
  assert.equal(test.said.at(-1), "Link added to Area resources.");
  assert.deepEqual([test.state().busy, test.state().sceneBusy], [null, null]);
});

test("a lost scene answer is retained in the recovery dialog and Retry resends the same envelope", async () => {
  const test = harness();
  await opened(test, [row(entity("worktree-main", "Main checkout"))]);
  let lose = true;
  test.routes.set("/api/areas/map-resources/apply", () => {
    if (lose) { lose = false; throw new Error("Injected lost success response"); }
    return { effect: "associate-generic-link", projection: projection([]), sourceUpdates: [sourceUpdate(test, "block-main", "associated-review", "scene-associated")], resource: null, undo: { state: "unavailable" } };
  });
  const mutation = { kind: "associate-generic-link" as const, owner: shardOwner(TANGENT), sourceElementId: sourceId("block-main"), labelForNewRecord: null };
  assert.equal(await applySceneResourceMutation(test.effects, mutation), null);
  const retained = test.state().sceneRecovery;
  assert.equal(retained?.phase, "error");
  assert.equal(test.said.at(-1), "Map resource was not saved. Injected lost success response");
  await retrySceneResourceMutation(test.effects);
  assert.equal(test.applies().length, 2);
  assert.deepEqual(test.applies()[1]?.body, test.applies()[0]?.body, "Retry resends the byte-for-byte-equivalent transaction envelope");
  assert.equal(test.state().sceneRecovery, null);
});

test("Add back confirms a gone row that is still on the Map and sends its tombstone", async () => {
  const test = harness();
  const gone = row(goneEntity("removed"));
  await opened(test, [gone]);
  assert.equal(requestAddBack(test.effects, row(entity("worktree-main", "Main checkout"))), false, "a current row was never removed");
  assert.equal(requestAddBack(test.effects, gone), true);
  const confirmation = test.state().sceneRecovery;
  assert.equal(confirmation?.phase, "confirm-add-back");
  assert.equal(confirmation?.phase === "confirm-add-back" ? confirmation.target : "", "/tmp/removed");
  test.routes.set("/api/areas/map-resources/apply", () => ({ effect: "add-back-gone", projection: projection([]), sourceUpdates: [sourceUpdate(test, "block-gone", "gone-restored", "scene-add-back")], resource: null, undo: { state: "available", token: "undo-add-back" } }));
  await confirmAddBack(test.effects);
  const sent = test.applies()[0]?.body?.mutation;
  assert.deepEqual(sent, { kind: "add-back-gone", oldResource: { owner: shardOwner(TANGENT), id: "gone-old" }, source: { kind: "tombstone" } });
  assert.equal(test.applies()[0]?.body?.operationId, confirmation?.operationId, "the confirmation's operation id is the one the transaction runs under");
  assert.equal(test.said.at(-1), "Removed checkout added back to Area resources.");
});

test("a missing record confirms its Last-known target with the server before it is added back", async () => {
  const test = harness();
  const gone = row(goneEntity("missing-record"));
  await opened(test, [gone]);
  requestAddBack(test.effects, gone);
  test.routes.set("/api/areas/map-resources/inspect-target", () => ({ kind: "local", normalized: { kind: "worktree", path: "/tmp/removed" }, state: "available" }));
  test.routes.set("/api/areas/map-resources/apply", () => ({ effect: "add-back-gone", projection: projection([]), sourceUpdates: [sourceUpdate(test, "block-gone", "gone-restored", "scene-add-back")], resource: null, undo: { state: "unavailable" } }));
  await confirmAddBack(test.effects);
  const sent = test.applies()[0]?.body?.mutation as { source?: { kind?: string } } | undefined;
  assert.equal(sent?.source?.kind, "confirmed-last-known");
  assert.equal(await confirmAddBack(test.effects, null), null, "there is nothing to confirm without a retained row");
});

test("a Last-known target the server refuses keeps the Add-back dialog open for Retry", async () => {
  const test = harness();
  const gone = row(goneEntity("missing-record"));
  await opened(test, [gone]);
  requestAddBack(test.effects, gone);
  test.routes.set("/api/areas/map-resources/inspect-target", () => { throw new Error("Injected target failure"); });
  assert.equal(await confirmAddBack(test.effects), null);
  assert.equal(test.state().sceneRecovery?.phase, "error-add-back");
  assert.equal(test.said.at(-1), "Map resource was not saved. Injected target failure");
  test.routes.set("/api/areas/map-resources/inspect-target", () => ({ kind: "local", normalized: { kind: "worktree", path: "/tmp/removed" }, state: "available" }));
  test.routes.set("/api/areas/map-resources/apply", () => ({ effect: "add-back-gone", projection: projection([]), sourceUpdates: [sourceUpdate(test, "block-gone", "gone-restored", "scene-add-back")], resource: null, undo: { state: "unavailable" } }));
  await retrySceneResourceMutation(test.effects);
  assert.equal(test.applies().length, 1);
  assert.equal(test.state().sceneRecovery, null);
});

test("Undo runs through the catalog alone, or through the saved-source boundary with only its token", async () => {
  const test = harness();
  await opened(test, [row(entity("worktree-main", "Main checkout"))]);
  assert.equal(await undoResourceChange(test.effects), null, "there is nothing to undo without a retained token");
  test.routes.set("/api/areas/map-resources/apply", () => ({ effect: "undo", projection: projection([]), sourceUpdates: [], resource: null, undo: { state: "unavailable" } }));
  test.dispatch(resourcesReducer(test.state(), { type: "set-undo", undo: { token: "undo-catalog", owner: TANGENT, sourceCoupled: false, operationId: operationId("op-undo") } }));
  await undoResourceChange(test.effects);
  assert.deepEqual(test.applies()[0]?.body?.mutation, { kind: "undo", token: "undo-catalog" });
  test.routes.set("/api/areas/map-resources/apply", () => ({ effect: "undo", projection: projection([]), sourceUpdates: [sourceUpdate(test, "block-gone", "gone-restored", "scene-undo")], resource: null, undo: { state: "unavailable" } }));
  test.dispatch(resourcesReducer(test.state(), { type: "set-undo", undo: { token: "undo-add-back", owner: TANGENT, sourceCoupled: true, operationId: operationId("op-scene-undo") } }));
  await undoResourceChange(test.effects);
  const sent = test.applies()[1]?.body;
  assert.deepEqual(sent?.mutation, { kind: "undo", token: "undo-add-back" });
  assert.equal(sent?.expectedScenes, undefined, "a semantic Undo uses the retained server token, not a rebuilt scene envelope");
  assert.equal(sent?.expectedCatalogs, undefined);
});

test("Hide takes the row's live Block off the Map through the Map's own command and keeps the resource", async () => {
  const test = harness();
  await opened(test, [row(entity("worktree-main", "Main checkout"))]);
  assert.equal(hideResourceOnMap(test.effects, row(entity("worktree-main", "Main checkout"))), true);
  assert.equal(tangentOf(test.hidden[0] ?? null)?.ref, "worktree-main", "the composed Block of that resource is the one hidden");
  assert.equal(test.said.at(-1), "Hid Main checkout Block. The Area resource remains available.");
  assert.equal(hideResourceOnMap(test.effects, row(entity("never-placed", "Never placed"))), false);
  assert.equal(test.said.at(-1), "That resource is not currently visible on the Map.");
});

test("a generic Link is associated only from a Link Block with a source, over current facts", async () => {
  const test = harness();
  assert.equal(associateGenericLink(test.effects, null), false);
  assert.equal(test.said.at(-1), "Map resource changes are not enabled in this workspace.");
  await opened(test, [row(entity("worktree-main", "Main checkout"))]);
  assert.equal(associateGenericLink(test.effects, null), false, "there is nothing to associate without a Link Block");
  test.routes.set("/api/areas/map-resources/apply", () => ({ effect: "associate-generic-link", projection: projection([]), sourceUpdates: [sourceUpdate(test, "block-main", "associated-review", "scene-associated")], resource: null, undo: { state: "unavailable" } }));
  const facts = {
    source: { owner: shardOwner(TANGENT), sourceId: sourceId("block-main") },
    reference: { kind: "link" as const, ref: "https://example.com/review/17" },
    kindId: "link", states: [], display: { kindLabel: "Link", label: "Review 17", targetClue: "", stateText: [], externalTreatment: null, actionLabel: null },
    accessibleName: "Link: example.com.", searchText: "review 17", primaryAction: null, readAction: null, sourceState: "current" as const,
  };
  assert.equal(associateGenericLink(test.effects, facts), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(test.applies()[0]?.body?.mutation?.kind, "associate-generic-link");
});
