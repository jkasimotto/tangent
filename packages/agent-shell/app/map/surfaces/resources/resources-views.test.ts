import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createAreaMapWorldController, createEmptyScene } from "../../kernel/kernel-boundary.ts";
import type { RegionKey, ResourceEntity, ResourcePanelProjection, ResourcePanelRow, ShardHash, TreeDigest, World, WorldDigest, WorldId } from "../../kernel/kernel-types.ts";
import { rect } from "../../units/frames.ts";
import { areaKey, operationId, shardOwner, sourceId } from "../../units/ids.ts";
import type { AreaKey, OperationId, ResourceId } from "../../units/ids.ts";
import { count, sourcePx } from "../../units/units.ts";
import { createResourceEffects } from "./resources-effects.ts";
import type { ResourceEffectDeps, ResourceEffects } from "./resources-effects.ts";
import { INITIAL_RESOURCES_STATE, resourcesReducer } from "./resources-store.ts";
import type { ResourcesState } from "./resources-state.ts";
import type { ResourcesAction } from "./resources-store-actions.ts";
import {
  inventoryMessage, matchingResourceRows, panelControlFlags, panelFrameClass, resourceBreadcrumb,
  resourceControlValue, resourceFocusSelector, rowForLocator,
} from "./resources-views.ts";
import type { ResourcePanelPorts } from "./resources-views.ts";

const TANGENT = areaKey("otto/tangent");

/** One worktree entity as the server serves it. */
function entity(id: string, label: string): ResourceEntity {
  return {
    locator: { owner: shardOwner(TANGENT), id: id as ResourceId }, label,
    target: { kind: "worktree", path: `/tmp/${id}` },
    local: { state: "not-checked", value: null, checkedAt: null }, link: null,
    representation: { state: "current", value: "never-placed" }, warnings: [],
  };
}

/** One direct row over an entity. */
function row(id: string, label: string): ResourcePanelRow {
  return { viewedFrom: TANGENT, relation: { kind: "direct" }, alsoFrom: [], launchMatch: { state: "current", value: false }, entity: entity(id, label) };
}

/** A projection over the named rows. */
function projection(rows: readonly ResourcePanelRow[], state: ResourcePanelProjection["state"] = "current"): ResourcePanelProjection {
  return { state, viewedFrom: TANGENT, rows: [...rows], legacyReview: [], suggestions: [], catalogs: [{ owner: shardOwner(TANGENT), revision: "cat" }] };
}

/** One ready Area node with an empty shard. */
function areaNode(key: AreaKey, parent: string): World["areas"][number] {
  return {
    key, parent: shardOwner(parent), children: [], depth: count(key.split("/").length - 1),
    region: {
      key: `${parent}>${key}` as RegionKey, owner: shardOwner(parent), child: key,
      sourceId: sourceId(`region-${key}`), labelSourceId: sourceId(`region-${key}-label`),
      source: "stored", storedRect: rect("source", sourcePx(0), sourcePx(0), sourcePx(1), sourcePx(1)),
    },
    shard: { owner: shardOwner(key), hash: `hash-${key}` as ShardHash, revision: null, state: "ready", elementCount: count(0), blockCount: count(0), ownBlockHull: null, ownInkHull: null, scene: createEmptyScene() },
  };
}

/** A two-Area world with empty shards, enough for ports that never read a Block. */
function world(): World {
  return {
    schema: "area-map-world.v1", worldId: "world" as WorldId, treeRevision: "tree" as TreeDigest, worldRevision: "rev" as WorldDigest, locatedArea: TANGENT,
    rootShard: { owner: shardOwner("@root"), hash: null, revision: null, state: "deferred", elementCount: count(0), blockCount: count(0), ownBlockHull: null, ownInkHull: null },
    areas: [areaNode(areaKey("otto"), "@root"), areaNode(TANGENT, "otto")],
  };
}

/** The effects context with stubs: the views only read `writesEnabled` and the state through it. */
function effectsFor(read: () => ResourcesState, writes = true): ResourceEffects {
  /** No view test sends a request. */
  async function api(): Promise<unknown> {
    return null;
  }

  /** No view test reduces an action. */
  function dispatch(_action: ResourcesAction): void {
    return undefined;
  }

  /** No view test speaks. */
  function announce(): void {
    return undefined;
  }

  /** One fixed operation id is enough; no view test mints a second. */
  function mintOperationId(): OperationId {
    return operationId("op-view");
  }

  /** The rollout flag under test. */
  function writesEnabled(): boolean {
    return writes;
  }

  /** The cadence never runs in a view fixture. */
  function every(): () => void {
    return () => undefined;
  }

  /** The Map hide command, which no view test calls. */
  function hideBlock(): void {
    return undefined;
  }

  const controller = createAreaMapWorldController({ world: world() });
  const deps: ResourceEffectDeps = { api, dispatch, getState: read, controller, announce, mintOperationId, writesEnabled, scheduler: { every }, hideBlock };
  return createResourceEffects(deps);
}

/** The ports of a panel over one state, with a placement port that only records its call. */
function portsFor(read: () => ResourcesState, placed: ResourcePanelRow[] = [], writes = true): ResourcePanelPorts {
  /** Records the row handed to the placement surface. */
  function placeOnMap(target: ResourcePanelRow): void {
    placed.push(target);
  }

  /** The display name of an Area is its key in this fixture. */
  function areaName(area: AreaKey | string): string {
    return String(area);
  }

  /** Closing does nothing in a view fixture. */
  function close(): void {
    return undefined;
  }

  return { effects: effectsFor(read, writes), kinds: null, world: world(), areaName, placeOnMap, placementActive: false, close };
}

/** The state after the named actions, starting from a panel opened on Tangent. */
function stateAfter(actions: readonly ResourcesAction[]): ResourcesState {
  return actions.reduce(resourcesReducer, resourcesReducer(INITIAL_RESOURCES_STATE, { type: "open", area: TANGENT }));
}

test("the breadcrumb is one Area per ancestor, outermost first", () => {
  assert.deepEqual(resourceBreadcrumb(areaKey("otto/tangent/map")), [areaKey("otto"), areaKey("otto/tangent"), areaKey("otto/tangent/map")]);
  assert.deepEqual(resourceBreadcrumb(null), []);
});

test("a Show or Place control carries the locator encoded once, whichever form the focus request holds", () => {
  const locator = { owner: shardOwner(TANGENT), id: "worktree-main" as ResourceId };
  assert.equal(resourceControlValue(locator), encodeURIComponent("otto/tangent/worktree-main"));
  const expected = `[data-resource-show="${encodeURIComponent("otto/tangent/worktree-main")}"]`;
  assert.equal(resourceFocusSelector({ control: "show", key: "otto/tangent/worktree-main" }), expected);
  assert.equal(resourceFocusSelector({ control: "show", key: encodeURIComponent("otto/tangent/worktree-main") }), expected, "an already encoded key is not encoded twice");
  assert.equal(resourceFocusSelector(null), undefined);
});

test("the empty sentence is only claimed over an exact read", () => {
  const current = stateAfter([{ type: "install-projection", projection: projection([]), area: TANGENT }]);
  assert.equal(inventoryMessage(current, []), "No confirmed Map resources in this Area yet.");
  const partial = stateAfter([{ type: "install-projection", projection: projection([], "partial"), area: TANGENT }]);
  assert.equal(inventoryMessage(partial, []), "", "a partial lower bound never claims exact emptiness");
  const loading = stateAfter([{ type: "load-started" }]);
  assert.equal(inventoryMessage(loading, []), "", "a read in flight claims nothing");
});

test("a filter that hides every row says so, and says nothing when the Area has no rows at all", () => {
  const filtered = stateAfter([{ type: "install-projection", projection: projection([row("a", "Main checkout")]), area: TANGENT }, { type: "set-filter", value: "nothing" }]);
  assert.equal(inventoryMessage(filtered, []), "No resources match this filter.");
  const emptyWithFilter = stateAfter([{ type: "install-projection", projection: projection([]), area: TANGENT }, { type: "set-filter", value: "nothing" }]);
  assert.equal(inventoryMessage(emptyWithFilter, []), "");
});

test("the filter keeps the rows whose facts match it", () => {
  let state = stateAfter([{ type: "install-projection", projection: projection([row("a", "Main checkout"), row("b", "Review checkout")]), area: TANGENT }]);
  const ports = portsFor(() => state);
  assert.equal(matchingResourceRows(state, ports).length, count(2));
  state = resourcesReducer(state, { type: "set-filter", value: "review" });
  assert.deepEqual(matchingResourceRows(state, ports).map((match) => match.entity.label), ["Review checkout"]);
});

test("writes need current facts, current transport and the rollout flag", () => {
  const state = stateAfter([{ type: "install-projection", projection: projection([row("a", "Main checkout")]), area: TANGENT }]);
  assert.deepEqual(panelControlFlags(state, effectsFor(() => state)), { writable: true, controls: true });
  assert.deepEqual(panelControlFlags(state, effectsFor(() => state, false)), { writable: false, controls: false });
  const busy = resourcesReducer(state, { type: "set-busy", busy: "remove" });
  assert.equal(panelControlFlags(busy, effectsFor(() => busy)).writable, false);
});

test("a locator names the row it belongs to, and an unsafe one names none", () => {
  const state = stateAfter([{ type: "install-projection", projection: projection([row("a", "Main checkout")]), area: TANGENT }]);
  assert.equal(rowForLocator(state.projection, { owner: shardOwner(TANGENT), id: "a" as ResourceId })?.entity.label, "Main checkout");
  assert.equal(rowForLocator(state.projection, { owner: shardOwner(TANGENT), id: "../escape" as ResourceId }), null);
  assert.equal(rowForLocator(null, undefined), null);
});

test("the frame says which shape the panel has and whether a placement runs over it", () => {
  assert.equal(panelFrameClass(false, false), "tangent-map-resources-backdrop is-panel");
  assert.equal(panelFrameClass(true, false), "tangent-map-resources-backdrop is-modal");
  assert.equal(panelFrameClass(true, true), "tangent-map-resources-backdrop is-modal placement-active");
});
