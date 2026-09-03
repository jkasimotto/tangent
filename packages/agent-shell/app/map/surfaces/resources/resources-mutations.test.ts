import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createAreaMapWorldController, createEmptyScene } from "../../kernel/kernel-boundary.ts";
import type { LegacyReviewRow, RegionKey, ResourceEntity, ResourcePanelProjection, ResourcePanelRow, ResourceSuggestion, ShardHash, TreeDigest, World, WorldDigest, WorldId } from "../../kernel/kernel-types.ts";
import { rect } from "../../units/frames.ts";
import { areaKey, operationId, shardOwner, sourceId } from "../../units/ids.ts";
import type { AreaKey, OperationId, ResourceId } from "../../units/ids.ts";
import { count, sourcePx } from "../../units/units.ts";
import { createResourceEffects, loadResources } from "./resources-effects.ts";
import type { ResourceEffectDeps, ResourceEffects, ResourceRequestInit } from "./resources-effects.ts";
import {
  applyResourceMutation, chooseLegacyBranch, dismissSuggestion, editResource, importSelectedLegacy, openRecoveryResource,
  recoveryOwner, removeResource, retryResourceMutationRecovery, saveResourceDraft,
} from "./resources-mutations.ts";
import { INITIAL_RESOURCES_STATE, resourcesReducer } from "./resources-store.ts";
import type { ResourcesState } from "./resources-state.ts";
import type { ResourcesAction } from "./resources-store-actions.ts";
import { legacyCandidateKey } from "./resource-rows.ts";

const TANGENT = areaKey("otto/tangent");
const OTTO = areaKey("otto");

/** One ready Area node with an empty shard. */
function areaNode(key: AreaKey, parent: string): World["areas"][number] {
  return {
    key, parent: shardOwner(parent), children: [], depth: count(key.split("/").length - 1),
    region: {
      key: `${parent}>${key}` as RegionKey, owner: shardOwner(parent), child: key,
      sourceId: sourceId(`region-${key}`), labelSourceId: sourceId(`region-${key}-label`),
      source: "stored", storedRect: rect("source", sourcePx(0), sourcePx(0), sourcePx(1200), sourcePx(800)),
    },
    shard: { owner: shardOwner(key), hash: `hash-${key}` as ShardHash, revision: null, state: "ready", elementCount: count(0), blockCount: count(0), ownBlockHull: null, ownInkHull: null, scene: createEmptyScene() },
  };
}

/** A two-Area world with empty shards. */
function world(): World {
  return {
    schema: "area-map-world.v1", worldId: "world" as WorldId, treeRevision: "tree" as TreeDigest, worldRevision: "rev" as WorldDigest, locatedArea: TANGENT,
    rootShard: { owner: shardOwner("@root"), hash: null, revision: null, state: "deferred", elementCount: count(0), blockCount: count(0), ownBlockHull: null, ownInkHull: null },
    areas: [areaNode(OTTO, "@root"), areaNode(TANGENT, "otto")],
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
function row(id: string, label: string, owner: AreaKey = TANGENT): ResourcePanelRow {
  return { viewedFrom: TANGENT, relation: { kind: "direct" }, alsoFrom: [], launchMatch: { state: "current", value: false }, entity: entity(id, label, owner) };
}

/** A current projection over the named rows and legacy candidates, with both Areas' catalogs. */
function projection(rows: readonly ResourcePanelRow[], legacyReview: readonly LegacyReviewRow[] = [], revision = "cat-child"): ResourcePanelProjection {
  return {
    state: "current", viewedFrom: TANGENT, rows: [...rows], legacyReview: [...legacyReview], suggestions: [],
    catalogs: [{ owner: shardOwner(TANGENT), revision }, { owner: shardOwner(OTTO), revision: "cat-parent" }],
  };
}

/** One recorded request. */
type Call = { readonly path: string; readonly body: { readonly operationId?: string; readonly expectedCatalogs?: unknown; readonly mutation?: { readonly kind?: string } } | null };

/** A recording harness with a routed fake server and the real store. */
type Harness = {
  readonly effects: ResourceEffects;
  readonly calls: Call[];
  readonly said: string[];
  readonly routes: Map<string, (body: unknown) => unknown>;
  readonly state: () => ResourcesState;
  readonly dispatch: (state: ResourcesState) => void;
  readonly applies: () => Call[];
};

/** Builds the harness with writes enabled and one mint counter. */
function harness(): Harness {
  const controller = createAreaMapWorldController({ world: world() });
  const calls: Call[] = [];
  const said: string[] = [];
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

  /** The Map hide command, which no catalog mutation uses. */
  function hideBlock(): void {
    return undefined;
  }

  const deps: ResourceEffectDeps = { api, dispatch, getState, controller, announce, mintOperationId, writesEnabled, scheduler: { every }, hideBlock };
  return { effects: createResourceEffects(deps), calls, said, routes, state: getState, dispatch: setState, applies };
}

/** Opens the panel on Tangent over one current read of the named rows and candidates. */
async function opened(test: Harness, rows: readonly ResourcePanelRow[] = [row("worktree-main", "Main checkout")], legacyReview: readonly LegacyReviewRow[] = []): Promise<void> {
  test.dispatch(resourcesReducer(test.state(), { type: "open", area: TANGENT }));
  test.routes.set("/api/areas/map-resources?", () => projection(rows, legacyReview));
  await loadResources(test.effects, TANGENT, { refreshObservations: false });
}

/** The answer an accepted mutation gives, with an undo token when asked. */
function accepted(undoToken: string | null, resource: ResourceEntity | null = null): unknown {
  return { effect: "applied", projection: projection([row("worktree-main", "Main checkout")]), sourceUpdates: [], resource, warnings: [], undo: undoToken ? { state: "available", token: undoToken } : { state: "unavailable" } };
}

test("a mutation is refused until the catalog is current, and then sends only the owner's catalog fence", async () => {
  const test = harness();
  assert.equal(await applyResourceMutation(test.effects, { kind: "remove", resource: { owner: shardOwner(TANGENT), id: "worktree-main" as ResourceId } }), null);
  assert.equal(test.said.at(-1), "Map resources are read-only until the current catalog loads.");
  await opened(test);
  test.routes.set("/api/areas/map-resources/apply", () => accepted(null));
  await applyResourceMutation(test.effects, { kind: "remove", resource: { owner: shardOwner(TANGENT), id: "worktree-main" as ResourceId } });
  assert.deepEqual(test.applies()[0]?.body?.expectedCatalogs, [{ owner: shardOwner(TANGENT), revision: "cat-child" }], "a direct mutation never sends the inherited ancestor catalog guard");
  assert.equal(test.state().busy, null);
});

test("an accepted mutation installs its projection, its undo and a refresh of the resource it named", async () => {
  const test = harness();
  await opened(test);
  test.routes.set("/api/areas/map-resources/apply", () => accepted("undo-1", entity("worktree-main", "Main checkout")));
  test.routes.set("/api/areas/map-resources/refresh", () => ({ resolutions: [] }));
  await applyResourceMutation(test.effects, { kind: "add", owner: shardOwner(TANGENT), input: { target: { kind: "worktree", path: "/tmp/new" } }, label: null }, { success: "Resource added to Area." });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual([test.state().undo?.token, test.state().undo?.owner, test.state().undo?.sourceCoupled], ["undo-1", TANGENT, false]);
  assert.equal(test.said.at(-1), "Resource added to Area.");
  assert.equal(test.calls.some((call) => call.path.endsWith("/refresh")), true);
  assert.equal(test.state().mutationRecovery, null);
});

test("an undo carries only its retained token and no catalog fence", async () => {
  const test = harness();
  await opened(test);
  test.routes.set("/api/areas/map-resources/apply", () => accepted(null));
  await applyResourceMutation(test.effects, { kind: "undo", token: "undo-1" }, { operationId: operationId("op-undo") });
  assert.equal(test.applies()[0]?.body?.expectedCatalogs, undefined);
  assert.equal(test.applies()[0]?.body?.operationId, "op-undo");
});

test("a refused mutation retains its envelope, and Retry resends the same bytes with the same operation id", async () => {
  const test = harness();
  await opened(test);
  const failure = Object.assign(new Error("Injected catalog conflict"), {
    payload: { code: "catalog-revision-changed", error: "Injected catalog conflict", recovery: { code: "catalog-revision-changed", projection: projection([row("worktree-main", "Main checkout")], [], "cat-external") } },
  });
  test.routes.set("/api/areas/map-resources/apply", () => { throw failure; });
  await applyResourceMutation(test.effects, { kind: "remove", resource: { owner: shardOwner(TANGENT), id: "worktree-main" as ResourceId } });
  const retained = test.state().mutationRecovery;
  assert.deepEqual([retained?.code, retained?.message], ["catalog-revision-changed", "Injected catalog conflict"]);
  assert.equal(test.said.at(-1), "Map resources were not saved. Injected catalog conflict");
  assert.equal(test.state().projection?.catalogs?.[0]?.revision, "cat-external", "the projection the refusal carried is installed at once");
  test.routes.set("/api/areas/map-resources/apply", () => accepted(null));
  await retryResourceMutationRecovery(test.effects);
  assert.equal(test.applies().length, 2);
  assert.deepEqual(test.applies()[1]?.body, test.applies()[0]?.body, "Retry resends the byte-for-byte-equivalent envelope");
});

test("Retry does nothing without a retained envelope, and the recovery names the Area that owns the write", async () => {
  const test = harness();
  assert.equal(await retryResourceMutationRecovery(test.effects), null);
  assert.equal(recoveryOwner(null), null);
  const mutation = { kind: "remove" as const, resource: { owner: shardOwner(OTTO), id: "repo-shared" as ResourceId } };
  assert.equal(recoveryOwner({ code: "x", recovery: {}, mutation, operationId: operationId("op-1"), success: "", request: null, message: "" }), shardOwner(OTTO));
  assert.equal(recoveryOwner({ code: "x", recovery: { owner: shardOwner(TANGENT) }, mutation, operationId: operationId("op-1"), success: "", request: null, message: "" }), shardOwner(TANGENT));
});

test("a refused add opens the duplicate resource it named", async () => {
  const test = harness();
  await opened(test);
  assert.equal(openRecoveryResource(test.effects), false);
  const locator = { owner: shardOwner(TANGENT), id: "worktree-main" as ResourceId };
  test.dispatch(resourcesReducer(test.state(), { type: "set-mutation-recovery", recovery: { code: "duplicate-target", recovery: { existing: locator }, mutation: null, operationId: operationId("op-1"), success: "", request: null, message: "" } }));
  assert.equal(openRecoveryResource(test.effects), true);
  assert.deepEqual([test.state().details, test.state().mutationRecovery], [locator, null]);
});

test("one explicit legacy Branch choice is applied as a new reviewed intent", async () => {
  const test = harness();
  await opened(test);
  const candidate = { owner: shardOwner(TANGENT), target: undefined, evidence: null, evidenceHash: "legacy-main", targetFingerprint: "fingerprint-1" };
  const other = { ...candidate, owner: shardOwner(OTTO), targetFingerprint: "fingerprint-2" };
  assert.equal(chooseLegacyBranch(test.effects, { owner: shardOwner(TANGENT), targetFingerprint: "fingerprint-1" }), false, "there is nothing to choose without a retained import");
  const mutation = { kind: "import-legacy" as const, selections: [{ candidate, attachDeclaredBranch: false }, { candidate: other, attachDeclaredBranch: false }] };
  test.dispatch(resourcesReducer(test.state(), { type: "set-mutation-recovery", recovery: { code: "legacy-branch-conflict", recovery: {}, mutation, operationId: operationId("op-1"), success: "Imported.", request: null, message: "" } }));
  test.routes.set("/api/areas/map-resources/apply", () => accepted(null));
  assert.equal(chooseLegacyBranch(test.effects, { owner: shardOwner(TANGENT), targetFingerprint: "fingerprint-1" }), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const sent = test.applies()[0]?.body?.mutation as { selections?: { attachDeclaredBranch: boolean }[] } | undefined;
  assert.deepEqual(sent?.selections?.map((selection) => selection.attachDeclaredBranch), [true, false]);
});

test("every selected legacy row is imported as one atomic multi-owner mutation and the selection clears", async () => {
  const test = harness();
  const candidate: LegacyReviewRow = { state: "candidate", owner: shardOwner(TANGENT), field: "Worktree", evidenceHash: "legacy-main", declaredBranch: "legacy/main" };
  await opened(test, [], [candidate]);
  assert.equal(await importSelectedLegacy(test.effects), null, "nothing selected imports nothing");
  test.dispatch(resourcesReducer(test.state(), { type: "toggle-legacy", key: legacyCandidateKey(candidate), selected: true }));
  test.routes.set("/api/areas/map-resources/apply", () => accepted(null));
  await importSelectedLegacy(test.effects);
  const sent = test.applies()[0]?.body?.mutation as { kind?: string; selections?: { attachDeclaredBranch: boolean }[] } | undefined;
  assert.deepEqual([sent?.kind, sent?.selections?.length, sent?.selections?.[0]?.attachDeclaredBranch], ["import-legacy", 1, true]);
  assert.equal(test.said.at(-1), "1 legacy resource imported.");
  assert.deepEqual([test.state().legacySelected.size, test.state().legacyReviewHidden], [0, false]);
});

test("an editor opens only over current facts and saves with its own operation id and catalog fence", async () => {
  const test = harness();
  assert.equal(editResource(test.effects), false);
  assert.equal(test.said.at(-1), "Map resources are read-only until the current catalog loads.");
  await opened(test);
  assert.equal(editResource(test.effects, { mode: "edit", row: test.state().projection?.rows[0] }), true);
  const draftOperation = test.state().editor?.operationId;
  test.dispatch(resourcesReducer(test.state(), { type: "editor-target", value: "/tmp/edited" }));
  test.routes.set("/api/areas/map-resources/inspect-target", () => ({ kind: "local", normalized: { kind: "worktree", path: "/tmp/edited" }, state: "available" }));
  test.routes.set("/api/areas/map-resources/apply", () => accepted(null));
  await saveResourceDraft(test.effects);
  assert.equal(test.applies()[0]?.body?.operationId, draftOperation);
  assert.deepEqual(test.applies()[0]?.body?.expectedCatalogs, [{ owner: shardOwner(TANGENT), revision: "cat-child" }]);
  assert.equal(test.state().editor, null, "a saved draft closes");
  assert.equal(test.said.at(-1), "Resource updated.");
});

test("a save whose target the server refuses keeps the draft open with its words", async () => {
  const test = harness();
  await opened(test);
  editResource(test.effects, {});
  test.dispatch(resourcesReducer(test.state(), { type: "editor-target", value: "/tmp/new" }));
  test.routes.set("/api/areas/map-resources/inspect-target", () => { throw new Error("Injected target failure"); });
  assert.equal(await saveResourceDraft(test.effects), null);
  assert.equal(test.state().editor?.error, "Injected target failure");
});

test("Remove and Dismiss are named commands that refuse a stale catalog and speak their own words", async () => {
  const test = harness();
  const suggestion: ResourceSuggestion = { owner: shardOwner(TANGENT), proposedLabel: "Review checkout", evidenceHash: "evidence-1" };
  assert.equal(await removeResource(test.effects, row("worktree-main", "Main checkout")), null);
  assert.equal(await dismissSuggestion(test.effects, suggestion), null);
  assert.equal(test.said.at(-1), "Map resources are read-only until the current catalog loads.");
  await opened(test);
  test.routes.set("/api/areas/map-resources/apply", () => accepted(null));
  await removeResource(test.effects, row("worktree-main", "Main checkout"));
  assert.equal(test.said.at(-1), "Resource removed from Area.");
  await dismissSuggestion(test.effects, suggestion);
  const sent = test.applies()[1]?.body?.mutation as { kind?: string } | undefined;
  assert.equal(sent?.kind, "dismiss-suggestion");
  assert.equal(test.said.at(-1), "Suggestion dismissed.");
});
