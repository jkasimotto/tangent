import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createAreaMapWorldController, createEmptyScene } from "../../kernel/kernel-boundary.ts";
import type { MapEntityFacts, RegionKey, ShardHash, TreeDigest, World, WorldDigest, WorldId } from "../../kernel/kernel-types.ts";
import { rect } from "../../units/frames.ts";
import { areaKey, operationId, shardOwner, sourceId } from "../../units/ids.ts";
import type { AreaKey, OperationId, ResourceId } from "../../units/ids.ts";
import { count, sourcePx } from "../../units/units.ts";
import { copyBlockedLink, filterResources, retryResourceAction, runResourceAction, viewResourceArea } from "./resource-actions.ts";
import { createResourceEffects } from "./resources-effects.ts";
import type { ResourceEffectDeps, ResourceEffects } from "./resources-effects.ts";
import { INITIAL_RESOURCES_STATE, resourcesReducer } from "./resources-store.ts";
import type { ResourcesState } from "./resources-state.ts";
import type { ResourcesAction } from "./resources-store-actions.ts";

const TANGENT = areaKey("otto/tangent");
const EXACT_PATH = "/private/tmp/tangent-map-resource-fixture/main";

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

/** A two-Area world with empty shards. */
function world(): World {
  return {
    schema: "area-map-world.v1", worldId: "world" as WorldId, treeRevision: "tree" as TreeDigest, worldRevision: "rev" as WorldDigest, locatedArea: TANGENT,
    rootShard: { owner: shardOwner("@root"), hash: null, revision: null, state: "deferred", elementCount: count(0), blockCount: count(0), ownBlockHull: null, ownInkHull: null },
    areas: [areaNode(areaKey("otto"), "@root"), areaNode(TANGENT, "otto")],
  };
}

/** The Block facts of one worktree row, as `resolveMapEntity` would answer them. */
function facts(): MapEntityFacts {
  return {
    source: { owner: shardOwner(TANGENT), sourceId: sourceId("worktree-main") },
    reference: { kind: "resource", resource: { owner: shardOwner(TANGENT), id: "worktree-main" as ResourceId } },
    kindId: "worktree", states: [],
    display: { kindLabel: "Worktree", label: "Main checkout", targetClue: "main", stateText: [], externalTreatment: null, actionLabel: "Copy path" },
    accessibleName: "Worktree: Main checkout.", searchText: "main checkout",
    primaryAction: { kind: "copy-path", path: EXACT_PATH, resource: null }, readAction: null, sourceState: "current",
  };
}

/** A recording harness over the real store. */
type Harness = {
  readonly effects: ResourceEffects;
  readonly said: string[];
  readonly paths: string[];
  readonly state: () => ResourcesState;
};

/** Builds the harness over a panel opened on Tangent. */
function harness(): Harness {
  const said: string[] = [];
  const paths: string[] = [];
  let state = resourcesReducer(INITIAL_RESOURCES_STATE, { type: "open", area: TANGENT });

  /** No action in this fixture sends a request. */
  async function api(): Promise<unknown> {
    return null;
  }

  /** Reduces one action into the harness store. */
  function dispatch(action: ResourcesAction): void {
    state = resourcesReducer(state, action);
  }

  /** The store's current state. */
  function getState(): ResourcesState {
    return state;
  }

  /** Records one spoken sentence. */
  function announce(text: string): void {
    said.push(text);
  }

  /** One fixed operation id is enough here. */
  function mintOperationId(): OperationId {
    return operationId("op-action");
  }

  /** Resource writes are enabled in every fixture. */
  function writesEnabled(): boolean {
    return true;
  }

  /** The cadence never runs in an action fixture. */
  function every(): () => void {
    return () => undefined;
  }

  /** The Map hide command, which no action here calls. */
  function hideBlock(): void {
    return undefined;
  }

  const controller = createAreaMapWorldController({ world: world() });
  const deps: ResourceEffectDeps = { api, dispatch, getState, controller, announce, mintOperationId, writesEnabled, scheduler: { every }, hideBlock };
  const effects = createResourceEffects(deps);
  return { effects, said, paths, state: getState };
}

/** The clipboard the fixture injects: it records what it took, or refuses every write. */
function clipboardFor(test: Harness, works: boolean): { writeText: (value: string) => Promise<void> } {
  /** Takes the text, or refuses it the way a browser without permission does. */
  async function writeText(value: string): Promise<void> {
    if (!works) throw new Error("clipboard blocked");
    test.paths.push(value);
  }

  return { writeText };
}

test("a copy that goes through says so and opens no dialog", async () => {
  const fixture = harness();
  const result = await runResourceAction(fixture.effects, facts(), facts().primaryAction, { clipboard: clipboardFor(fixture, true) });
  assert.equal(result.kind, "done");
  assert.deepEqual(fixture.paths, [EXACT_PATH]);
  assert.deepEqual(fixture.said, ["Copied Main checkout path."]);
  assert.equal(fixture.state().recovery, null);
});

test("a refused copy opens the recovery dialog with the exact text and says why", async () => {
  const fixture = harness();
  const result = await runResourceAction(fixture.effects, facts(), facts().primaryAction, { clipboard: clipboardFor(fixture, false) });
  assert.equal(result.kind, "clipboard-blocked");
  const recovery = fixture.state().recovery;
  assert.equal(recovery?.message, "Could not copy Main checkout path.");
  assert.equal(recovery?.result.kind === "clipboard-blocked" ? recovery.result.copy.value : "", EXACT_PATH);
  assert.deepEqual(fixture.said, ["Could not copy Main checkout path."]);
});

test("a retry from inside the dialog closes it only once the copy went through", async () => {
  const fixture = harness();
  await runResourceAction(fixture.effects, facts(), facts().primaryAction, { clipboard: clipboardFor(fixture, false) });
  await retryResourceAction(fixture.effects, null, { clipboard: clipboardFor(fixture, false) });
  assert.notEqual(fixture.state().recovery, null, "a refused retry keeps the dialog and its text");
  await retryResourceAction(fixture.effects, null, { clipboard: clipboardFor(fixture, true) });
  assert.equal(fixture.state().recovery, null);
  assert.equal(fixture.said.at(-1), "Copied Main checkout path.");
});

test("a blocked open offers the link, and copying it reuses the same dialog", async () => {
  const fixture = harness();
  const open: MapEntityFacts["primaryAction"] = { kind: "open-url", url: "https://example.com/pr/1", targetLabel: "example.com", resource: null };
  const linkFacts: MapEntityFacts = { ...facts(), primaryAction: open };
  await runResourceAction(fixture.effects, linkFacts, open, {});
  assert.equal(fixture.state().recovery?.message, "Could not open example.com.");
  await copyBlockedLink(fixture.effects, { clipboard: clipboardFor(fixture, true) });
  assert.deepEqual(fixture.paths, ["https://example.com/pr/1"]);
  assert.equal(fixture.state().recovery, null, "the dialog closes once the link is on the clipboard");
});

test("moving the panel to another Area drops that Area's rows and keeps the panel open", () => {
  const fixture = harness();
  filterResources(fixture.effects, "checkout");
  viewResourceArea(fixture.effects, areaKey("otto"));
  assert.equal(fixture.state().area, areaKey("otto"));
  assert.equal(fixture.state().projection, null);
  assert.equal(fixture.state().open, true);
});
