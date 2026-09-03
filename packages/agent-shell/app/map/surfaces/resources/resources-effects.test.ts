import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createAreaMapWorldController, createEmptyScene, placeBlockInSourceScene } from "../../kernel/kernel-boundary.ts";
import type { AreaMapController, RegionKey, ResourceEntity, ResourceLocator, ResourcePanelProjection, ResourcePanelRow, ShardHash, TreeDigest, World, WorldDigest, WorldId } from "../../kernel/kernel-types.ts";
import { rect } from "../../units/frames.ts";
import { areaKey, operationId, shardOwner, sourceId } from "../../units/ids.ts";
import type { AreaKey, OperationId, ResourceId } from "../../units/ids.ts";
import { count, milliseconds, sourcePx } from "../../units/units.ts";
import type { Count } from "../../units/units.ts";
import { LAYOUT } from "../../layout/layout-tokens.ts";
import {
  cancelResourceRequests, createResourceEffects, discoverResources, inspectResourceDraft, installResourceCadence,
  installResourceProjection, isInstallableProjection, loadResources, refreshOpenPanel, refreshResourceFacts,
  requestResource, resolutionsOf, resolveSceneResources, resourceCadenceInterval, resourceSourceShard, sceneResourceLocators,
} from "./resources-effects.ts";
import type { ResourceEffectDeps, ResourceEffects, ResourceRequestInit } from "./resources-effects.ts";
import { newResourceDraft } from "./resources-draft.ts";
import { INITIAL_RESOURCES_STATE, resourcesReducer } from "./resources-store.ts";
import type { ResourcesState } from "./resources-state.ts";
import type { ResourcesAction } from "./resources-store-actions.ts";

const TANGENT = areaKey("otto/tangent");
const OTTO = areaKey("otto");

/** One Area node whose shard holds one resource Block when asked. */
function areaNode(key: AreaKey, parent: string, withBlock: boolean): World["areas"][number] {
  const empty = createEmptyScene();
  const scene = withBlock ? placeBlockInSourceScene(empty, { kind: "resource", ref: "worktree-main", title: "Main checkout" }, sourceId("block-main")).scene : empty;
  return {
    key, parent: shardOwner(parent), children: [], depth: count(key.split("/").length - 1),
    region: {
      key: `${parent}>${key}` as RegionKey, owner: shardOwner(parent), child: key,
      sourceId: sourceId(`region-${key}`), labelSourceId: sourceId(`region-${key}-label`),
      source: "stored", storedRect: rect("source", sourcePx(0), sourcePx(0), sourcePx(1200), sourcePx(800)),
    },
    shard: { owner: shardOwner(key), hash: `hash-${key}` as ShardHash, revision: null, state: "ready", elementCount: count(scene.elements.length), blockCount: count(withBlock ? 1 : 0), ownBlockHull: null, ownInkHull: null, scene },
  };
}

/** A two-Area world: Tangent holds one resource Block, Otto is empty. */
function world(): World {
  return {
    schema: "area-map-world.v1", worldId: "world" as WorldId, treeRevision: "tree" as TreeDigest, worldRevision: "rev" as WorldDigest, locatedArea: TANGENT,
    rootShard: { owner: shardOwner("@root"), hash: null, revision: null, state: "deferred", elementCount: count(0), blockCount: count(0), ownBlockHull: null, ownInkHull: null },
    areas: [areaNode(OTTO, "@root", false), areaNode(TANGENT, "otto", true)],
  };
}

/** One worktree entity as the server serves it. */
function entity(id: string, label: string, owner: AreaKey = TANGENT): ResourceEntity {
  return {
    locator: { owner: shardOwner(owner), id: id as ResourceId }, label,
    target: { kind: "worktree", path: `/tmp/${id}` },
    local: { state: "not-checked", value: null, checkedAt: null }, link: null,
    representation: { state: "current", value: "never-placed" }, warnings: [],
  };
}

/** One direct row over an entity. */
function row(id: string, label: string): ResourcePanelRow {
  return { viewedFrom: TANGENT, relation: { kind: "direct" }, alsoFrom: [], launchMatch: { state: "current", value: false }, entity: entity(id, label) };
}

/** A current projection over the named rows. */
function projection(rows: readonly ResourcePanelRow[]): ResourcePanelProjection {
  return { state: "current", viewedFrom: TANGENT, rows: [...rows], legacyReview: [], suggestions: [], catalogs: [{ owner: shardOwner(TANGENT), revision: "cat-child" }] };
}

/** One recorded request. */
type Call = { readonly path: string; readonly body: unknown };

/** A recording harness over a real controller: a routed fake server, the store, and what was said. */
type Harness = {
  readonly effects: ResourceEffects;
  readonly controller: AreaMapController;
  readonly calls: Call[];
  readonly said: string[];
  readonly routes: Map<string, (body: unknown) => unknown>;
  readonly state: () => ResourcesState;
  readonly dispatch: (state: ResourcesState) => void;
  readonly ticks: (() => void)[];
};

/** Builds the harness. Every route answers `null` until a test installs one. */
function harness(): Harness {
  const controller = createAreaMapWorldController({ world: world() });
  const calls: Call[] = [];
  const said: string[] = [];
  const routes = new Map<string, (body: unknown) => unknown>();
  const ticks: (() => void)[] = [];
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

  /** Records the cadence callback instead of starting a timer, and returns the stopper that drops it. */
  function every(callback: () => void): () => void {
    ticks.push(callback);
    return () => { ticks.length = 0; };
  }

  /** The Map hide command, which no read effect uses. */
  function hideBlock(): void {
    return undefined;
  }

  const deps: ResourceEffectDeps = { api, dispatch, getState, controller, announce, mintOperationId, writesEnabled, scheduler: { every }, hideBlock };
  return { effects: createResourceEffects(deps), controller, calls, said, routes, state: getState, dispatch: setState, ticks };
}

test("a request with no api client is refused, a read is a GET, and a write is a JSON POST", async () => {
  const offline = createResourceEffects({ ...harness().effects, api: null });
  await assert.rejects(requestResource(offline, "/api/areas/map-resources"));
  const test = harness();
  test.routes.set("/api", () => ({ ok: true }));
  await requestResource(test.effects, "/api/areas/map-resources?area=otto");
  await requestResource(test.effects, "/api/areas/map-resources/refresh", { resources: [] });
  assert.deepEqual(test.calls.map((call) => call.body), [null, { resources: [] }]);
});

test("only a projection the panel may install is installed, and its rows reach the controller", () => {
  const test = harness();
  assert.equal(isInstallableProjection({ state: "current", rows: [] }), true);
  assert.equal(isInstallableProjection({ state: "loading" }), false);
  assert.equal(isInstallableProjection(null), false);
  assert.equal(installResourceProjection(test.effects, { state: "loading" }, TANGENT), false);
  assert.equal(installResourceProjection(test.effects, projection([row("worktree-main", "Main checkout")]), TANGENT), true);
  assert.equal(test.state().projection?.rows.length, 1);
});

test("the newest inventory read wins and a slow older answer never overwrites it", async () => {
  const test = harness();
  let release: ((value: ResourcePanelProjection) => void) | null = null;
  test.routes.set("/api/areas/map-resources?", () => new Promise((resolve) => { release = resolve; }));
  const held = loadResources(test.effects, TANGENT);
  await Promise.resolve();
  const holdRelease = release;
  test.routes.set("/api/areas/map-resources?", () => projection([row("worktree-main", "Newest projection")]));
  await loadResources(test.effects, TANGENT);
  assert.equal(test.state().projection?.rows[0]?.entity.label, "Newest projection");
  holdRelease?.(projection([row("worktree-main", "Stale projection")]));
  assert.equal(await held, null, "the older read reports nothing rather than installing itself");
  assert.equal(test.state().projection?.rows[0]?.entity.label, "Newest projection");
  assert.equal(test.state().transport.state, "current");
});

test("a failed read keeps the rows it had as last known and refreshes observations only when asked", async () => {
  const test = harness();
  test.routes.set("/api/areas/map-resources?", () => projection([row("worktree-main", "Main checkout")]));
  test.routes.set("/api/areas/map-resources/refresh", () => ({ resolutions: [] }));
  await loadResources(test.effects, TANGENT, { refreshObservations: false });
  assert.equal(test.calls.some((call) => call.path.endsWith("/refresh")), false);
  await loadResources(test.effects, TANGENT);
  await Promise.resolve();
  assert.equal(test.calls.some((call) => call.path.endsWith("/refresh")), true);
  test.routes.set("/api/areas/map-resources?", () => { throw new Error("Injected panel read failure"); });
  await loadResources(test.effects, TANGENT);
  assert.deepEqual([test.state().transport.state, test.state().transport.error], ["last-known", "Injected panel read failure"]);
  assert.equal(test.state().projection?.rows.length, 1);
  assert.equal(await loadResources(test.effects, null), null, "a read with no Area does nothing");
});

test("a refresh skips rows already checking, and a failed one keeps the facts it had", async () => {
  const test = harness();
  const locator: ResourceLocator = { owner: shardOwner(TANGENT), id: "worktree-main" as ResourceId };
  test.routes.set("/api/areas/map-resources?", () => projection([row("worktree-main", "Main checkout")]));
  await loadResources(test.effects, TANGENT, { refreshObservations: false });
  test.routes.set("/api/areas/map-resources/refresh", () => ({ resolutions: [{ state: "current", value: entity("worktree-main", "Refreshed checkout") }] }));
  await refreshResourceFacts(test.effects, [locator]);
  assert.deepEqual(test.said.at(-1), "Resource status refreshed.");
  assert.equal(test.state().refreshing.size, 0);
  test.dispatch(resourcesReducer(test.state(), { type: "refresh-started", keys: [`${TANGENT}${String.fromCharCode(0)}worktree-main` as never], checking: [] }));
  const before = test.calls.length;
  assert.equal(await refreshResourceFacts(test.effects, [locator]), null, "an in-flight observation is never checked twice");
  assert.equal(test.calls.length, before);
});

test("a refresh that fails is quiet when the cadence asked and speaks when a person did", async () => {
  const test = harness();
  const locator: ResourceLocator = { owner: shardOwner(TANGENT), id: "worktree-main" as ResourceId };
  test.routes.set("/api/areas/map-resources/refresh", () => { throw new Error("Injected refresh failure"); });
  await refreshResourceFacts(test.effects, [locator], { quiet: true });
  assert.deepEqual(test.said, []);
  await refreshResourceFacts(test.effects, [locator]);
  assert.equal(test.said.at(-1), "Could not refresh resource status. Injected refresh failure");
});

test("the scene resolve reads every loaded resource Block once, de-duplicated, and skips deleted ones", () => {
  const elements = harness().controller.snapshot().composition.scene.elements;
  const locators = sceneResourceLocators(elements);
  assert.deepEqual(locators, [{ owner: shardOwner(TANGENT), id: "worktree-main" }]);
  assert.deepEqual(sceneResourceLocators([...elements, ...elements]), locators, "one Block resolves once");
  assert.deepEqual(sceneResourceLocators(elements.map((element) => ({ ...element, isDeleted: true }))), []);
});

test("a scene resolve runs once per cadence tick and per Block set, and clears when nothing is loaded", async () => {
  const test = harness();
  test.routes.set("/api/areas/map-resources/resolve", () => ({ resolutions: [{ state: "current", value: entity("worktree-main", "Main checkout") }] }));
  test.routes.set("/api/areas/map-resources/refresh", () => ({ resolutions: [] }));
  const elements = test.controller.snapshot().composition.scene.elements;
  resolveSceneResources(test.effects, elements, count(0));
  resolveSceneResources(test.effects, elements, count(0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  /** How many scene resolves the panel has sent. */
  function resolves(): Count {
    return count(test.calls.filter((call) => call.path.endsWith("/resolve")).length);
  }
  assert.equal(resolves(), 1, "the same Blocks on the same tick resolve once");
  assert.equal(test.calls.filter((call) => call.path.endsWith("/refresh")).length, 1, "the first resolve of a set also refreshes its observations");
  resolveSceneResources(test.effects, elements, count(1));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(resolves(), 2);
  assert.equal(test.calls.filter((call) => call.path.endsWith("/refresh")).length, 1, "a cadence tick re-resolves cached facts and never polls providers again");
  resolveSceneResources(test.effects, [], count(2));
  assert.equal(resolves(), 2, "no loaded Block needs no request");
  assert.equal(test.state().resolutions.size, 0);
  cancelResourceRequests(test.effects);
});

test("the cadence keeps the configured interval above its floor and falls back to the default", () => {
  assert.equal(resourceCadenceInterval(null), LAYOUT.resourceCadence);
  assert.equal(resourceCadenceInterval(milliseconds(0)), LAYOUT.resourceCadence);
  assert.equal(resourceCadenceInterval(milliseconds(100)), 100);
  assert.equal(resourceCadenceInterval(milliseconds(1)), LAYOUT.resourceCadenceFloor);
});

test("the cadence ticks the store, and the open panel re-reads without polling providers", async () => {
  const test = harness();
  const stop = installResourceCadence(test.effects, milliseconds(100));
  test.ticks[0]?.();
  assert.equal(test.state().cadence, 1);
  stop();
  assert.equal(await refreshOpenPanel(test.effects), null, "a closed panel never re-reads");
  test.routes.set("/api/areas/map-resources?", () => projection([row("worktree-main", "Cadence checkout")]));
  test.dispatch(resourcesReducer(test.state(), { type: "open", area: TANGENT }));
  const answered = await refreshOpenPanel(test.effects);
  assert.equal(answered?.rows[0]?.entity.label, "Cadence checkout");
  assert.equal(test.calls.some((call) => call.path.endsWith("/refresh")), false);
});

test("discovery keeps the confirmed inventory authoritative and names its problems when it fails", async () => {
  const test = harness();
  test.dispatch(resourcesReducer(test.state(), { type: "open", area: TANGENT }));
  const found = { state: "partial", area: TANGENT, sources: [], problems: [{ code: "repository-inspection-failed", message: "Could not inspect the recorded repository." }] };
  test.routes.set("/api/areas/map-resources/discover", () => found);
  await discoverResources(test.effects);
  assert.equal(test.state().discovery?.state, "partial");
  assert.equal(test.said.at(-1), "Worktree discovery finished with some unavailable sources.");
  assert.equal(test.state().busy, null);
  test.routes.set("/api/areas/map-resources/discover", () => { throw new Error("Injected discovery failure"); });
  await discoverResources(test.effects);
  assert.deepEqual(test.state().discovery?.problems.map((problem) => problem.message), ["Injected discovery failure"]);
  assert.equal(test.said.at(-1), "Could not discover worktrees. Injected discovery failure");
});

test("the draft's target is inspected once, and a missing or refused target is written onto the draft", async () => {
  const test = harness();
  test.dispatch(resourcesReducer(test.state(), { type: "open", area: TANGENT }));
  assert.equal(await inspectResourceDraft(test.effects), null, "there is nothing to inspect without a draft");
  const draft = newResourceDraft({}, TANGENT, operationId("op-draft"), null);
  test.dispatch(resourcesReducer(test.state(), { type: "open-editor", draft: { ...draft, target: "/tmp/new" } }));
  test.routes.set("/api/areas/map-resources/inspect-target", () => ({ kind: "local", normalized: { kind: "worktree", path: "/tmp/new" }, state: "available" }));
  assert.deepEqual(await inspectResourceDraft(test.effects), { target: { kind: "worktree", path: "/tmp/new" }, missingConfirmation: null });
  test.routes.set("/api/areas/map-resources/inspect-target", () => ({ kind: "local", normalized: { kind: "worktree", path: "/tmp/new" }, state: "missing", targetFingerprint: "fixture-target" }));
  assert.equal(await inspectResourceDraft(test.effects), null);
  assert.equal(test.state().editor?.error, "The path is missing. Confirm that you want to record this future target.");
  test.routes.set("/api/areas/map-resources/inspect-target", () => { throw new Error("Injected target failure"); });
  assert.equal(await inspectResourceDraft(test.effects), null);
  assert.equal(test.said.at(-1), "Resource target was not accepted. Injected target failure");
  test.dispatch(resourcesReducer(test.state(), { type: "open-editor", draft: { ...draft, stale: true } }));
  assert.equal(await inspectResourceDraft(test.effects), null);
  assert.equal(test.said.at(-1), "Resources changed. Reload before you save.");
});

test("resolutions are read under either name the server uses, and only a saved Area shard can be fenced", () => {
  assert.deepEqual(resolutionsOf([{ state: "current", value: null }]).length, 1);
  assert.deepEqual(resolutionsOf({ results: [{ state: "gone", value: null }] }).length, 1);
  assert.deepEqual(resolutionsOf(null), []);
  const test = harness();
  assert.equal(resourceSourceShard(test.effects, TANGENT)?.hash, "hash-otto/tangent");
  assert.equal(resourceSourceShard(test.effects, null), null);
  assert.equal(resourceSourceShard(test.effects, areaKey("otto/missing")), null);
});
