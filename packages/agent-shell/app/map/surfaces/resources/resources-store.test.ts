import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { ResourceEntity, ResourceLocatorKey, ResourcePanelProjection, ResourcePanelRow, ResourceResolution } from "../../kernel/kernel-types.ts";
import { areaKey, operationId, shardOwner } from "../../units/ids.ts";
import type { AreaKey, ResourceId } from "../../units/ids.ts";
import { newResourceDraft } from "./resources-draft.ts";
import { INITIAL_RESOURCES_STATE, resourcesReducer } from "./resources-store.ts";
import type { ResourcesAction } from "./resources-store-actions.ts";
import type { ResourcesState } from "./resources-state.ts";

const TANGENT = areaKey("otto/tangent");
const OTTO = areaKey("otto");
const OPERATION = operationId("op-1");

/** The separator the kernel joins a locator key and a legacy candidate key with. */
const NUL = String.fromCharCode(0);

/** One current worktree entity in the Tangent Area, named as the panel reads it. */
function entity(id: string, label: string, owner: AreaKey = TANGENT): ResourceEntity {
  return {
    locator: { owner: shardOwner(owner), id: id as ResourceId },
    label,
    target: { kind: "worktree", path: `/tmp/${id}` },
    local: { state: "not-checked", value: null, checkedAt: null },
    link: null,
    representation: { state: "current", value: "never-placed" },
    warnings: [],
  };
}

/** One direct row over an entity. */
function row(id: string, label: string, owner: AreaKey = TANGENT): ResourcePanelRow {
  return { viewedFrom: TANGENT, relation: { kind: "direct" }, alsoFrom: [], launchMatch: { state: "current", value: false }, entity: entity(id, label, owner) };
}

/** A current projection over the named rows, with one catalog revision per Area. */
function projection(rows: readonly ResourcePanelRow[], revision = "cat-1"): ResourcePanelProjection {
  return {
    state: "current", viewedFrom: TANGENT, rows: [...rows], legacyReview: [], suggestions: [],
    catalogs: [{ owner: shardOwner(TANGENT), revision }, { owner: shardOwner(OTTO), revision: "cat-parent" }],
  };
}

/** Runs a list of actions over the initial state, left to right. */
function reduce(...actions: readonly ResourcesAction[]): ResourcesState {
  return actions.reduce(resourcesReducer, INITIAL_RESOURCES_STATE);
}

/** The panel open on Tangent with one loaded row. */
function loaded(rows: readonly ResourcePanelRow[] = [row("worktree-main", "Main checkout")]): ResourcesState {
  return reduce({ type: "open", area: TANGENT }, { type: "load-started" }, { type: "install-projection", projection: projection(rows), area: TANGENT });
}

/** The locator key of one row, as the store files its resolution under. */
function key(id: string, owner: AreaKey = TANGENT): ResourceLocatorKey {
  return [owner, id].join(NUL) as ResourceLocatorKey;
}

test("open shows the panel, and moving to another Area drops that Area's rows, discovery and draft", () => {
  const opened = loaded();
  assert.deepEqual([opened.open, opened.area, opened.transport.state], [true, TANGENT, "current"]);
  const withDraft = resourcesReducer(opened, { type: "open-editor", draft: newResourceDraft({}, TANGENT, OPERATION, opened.projection) });
  const moved = resourcesReducer(withDraft, { type: "open", area: OTTO });
  assert.deepEqual([moved.area, moved.projection, moved.editor, moved.discovery], [OTTO, null, null, null]);
  const reopened = resourcesReducer(withDraft, { type: "open", area: TANGENT });
  assert.equal(reopened.editor, withDraft.editor, "reopening the same Area keeps its retained draft");
});

test("close hides the panel and leaves details behind, and change-area keeps the draft", () => {
  const closed = resourcesReducer(resourcesReducer(loaded(), { type: "set-details", locator: entity("worktree-main", "Main checkout").locator }), { type: "close" });
  assert.deepEqual([closed.open, closed.details], [false, null]);
  const withDraft = resourcesReducer(loaded(), { type: "open-editor", draft: newResourceDraft({}, TANGENT, OPERATION, null) });
  const changed = resourcesReducer(withDraft, { type: "change-area", area: OTTO });
  assert.deepEqual([changed.area, changed.projection, changed.details], [OTTO, null, null]);
  assert.equal(changed.editor, withDraft.editor, "the route to an owning Area carries the draft with it");
});

test("set-filter, set-narrow, cadence-tick and request-focus each write one field", () => {
  const state = reduce({ type: "set-filter", value: "check" }, { type: "set-narrow", narrow: true }, { type: "cadence-tick" }, { type: "cadence-tick" },
    { type: "request-focus", focus: { control: "show", key: "otto/tangent/worktree-main" } });
  assert.deepEqual([state.filter, state.narrow, state.cadence], ["check", true, 2]);
  assert.deepEqual(state.pendingFocus, { control: "show", key: "otto/tangent/worktree-main" });
  assert.equal(resourcesReducer(state, { type: "request-focus", focus: null }).pendingFocus, null);
});

test("load-started loads the first read and refreshes every later one, and load-failed keeps last known rows", () => {
  const first = resourcesReducer(INITIAL_RESOURCES_STATE, { type: "load-started" });
  assert.equal(first.transport.state, "loading");
  const again = resourcesReducer(loaded(), { type: "load-started" });
  assert.equal(again.transport.state, "refreshing");
  const failedAfterRows = resourcesReducer(loaded(), { type: "load-failed", message: "Injected panel read failure" });
  assert.deepEqual([failedAfterRows.transport.state, failedAfterRows.transport.error], ["last-known", "Injected panel read failure"]);
  assert.equal(failedAfterRows.projection?.rows.length, 1, "a failed re-read never empties the inventory");
  assert.equal(resourcesReducer(first, { type: "load-failed", message: "gone" }).transport.state, "unavailable");
});

test("install-projection keeps the rows it had when a read is unavailable and files every row resolution", () => {
  const state = loaded();
  assert.equal(state.resolutions.get(key("worktree-main"))?.state, "current");
  const unavailable: ResourcePanelProjection = { state: "unavailable", rows: [], legacyReview: [], suggestions: [], error: { message: "Source unavailable" } };
  const after = resourcesReducer(state, { type: "install-projection", projection: unavailable, area: TANGENT });
  assert.deepEqual([after.transport.state, after.transport.error], ["last-known", "Source unavailable"]);
  assert.equal(after.projection?.rows.length, 1);
  const cold = resourcesReducer(INITIAL_RESOURCES_STATE, { type: "install-projection", projection: unavailable, area: TANGENT });
  assert.equal(cold.transport.state, "unavailable");
});

test("reconcile-editor turns a draft stale when the catalog moved, and a reload rebases it", () => {
  const opened = loaded();
  const withDraft = resourcesReducer(opened, { type: "open-editor", draft: newResourceDraft({ mode: "edit", row: opened.projection?.rows[0] }, TANGENT, OPERATION, opened.projection) });
  const moved = projection(opened.projection?.rows ?? [], "cat-external");
  const stale = resourcesReducer(withDraft, { type: "reconcile-editor", projection: moved, area: TANGENT, rebaseDraft: false });
  assert.equal(stale.editor?.stale, true);
  assert.equal(stale.mutationRecovery?.code, "catalog-revision-changed");
  const rebased = resourcesReducer(stale, { type: "reconcile-editor", projection: moved, area: TANGENT, rebaseDraft: true });
  assert.deepEqual([rebased.editor?.stale, rebased.editor?.error, rebased.mutationRecovery], [false, "", null]);
  assert.deepEqual(rebased.editor?.expectedCatalogs, [{ owner: shardOwner(TANGENT), revision: "cat-external" }]);
});

test("set-suggestions replaces the Suggestions of the loaded projection and does nothing without one", () => {
  const suggestion = { owner: shardOwner(TANGENT), proposedLabel: "Review checkout" };
  const state = resourcesReducer(loaded(), { type: "set-suggestions", suggestions: [suggestion] });
  assert.deepEqual(state.projection?.suggestions, [suggestion]);
  assert.equal(resourcesReducer(INITIAL_RESOURCES_STATE, { type: "set-suggestions", suggestions: [suggestion] }), INITIAL_RESOURCES_STATE);
});

test("install-resolutions drops the keys the previous resolve owned and files the new ones", () => {
  const resolution: ResourceResolution = { state: "current", value: entity("review-42", "Map entities review") };
  const state = resourcesReducer(loaded(), { type: "install-resolutions", resolutions: [resolution], dropKeys: [key("worktree-main")] });
  assert.equal(state.resolutions.has(key("worktree-main")), false);
  assert.equal(state.resolutions.get(key("review-42"))?.value?.label, "Map entities review");
});

test("refresh-started marks rows checking and refresh-finished clears exactly those marks", () => {
  const checking: ResourceResolution = { state: "current", value: entity("worktree-main", "Main checkout") };
  const started = resourcesReducer(loaded(), { type: "refresh-started", keys: [key("worktree-main")], checking: [checking] });
  assert.equal(started.refreshing.has(key("worktree-main")), true);
  const finished = resourcesReducer(started, { type: "refresh-finished", keys: [key("worktree-main")], resolutions: [{ state: "current", value: entity("worktree-main", "Cadence checkout") }] });
  assert.equal(finished.refreshing.size, 0);
  assert.equal(finished.resolutions.get(key("worktree-main"))?.value?.label, "Cadence checkout");
});

test("every editor action writes its own field and a target or kind change drops the stale inspection", () => {
  const opened = loaded();
  const withDraft = resourcesReducer(opened, { type: "open-editor", draft: newResourceDraft({}, TANGENT, OPERATION, opened.projection) });
  assert.deepEqual([withDraft.editor?.mode, withDraft.details], ["add", null]);
  const inspected = resourcesReducer(withDraft, { type: "editor-inspected", inspection: { kind: "local", normalized: { kind: "worktree", path: "/tmp/a" }, state: "missing" }, message: "The path is missing." });
  assert.equal(inspected.editor?.error, "The path is missing.");
  assert.equal(resourcesReducer(inspected, { type: "editor-confirm-missing", confirmed: true }).editor?.confirmMissing, true);
  assert.equal(resourcesReducer(inspected, { type: "editor-target", value: "/tmp/b" }).editor?.inspection, null);
  assert.equal(resourcesReducer(inspected, { type: "editor-kind", kind: "repository" }).editor?.inspection, null);
  assert.equal(resourcesReducer(withDraft, { type: "editor-label", value: "Recorded repository" }).editor?.label, "Recorded repository");
  assert.equal(resourcesReducer(withDraft, { type: "editor-hidden", hidden: true }).editor?.hidden, true);
  assert.equal(resourcesReducer(withDraft, { type: "discard-editor" }).editor, null);
});

test("editor-failed keeps the draft's operation id unless the refusal named one, and carries an inspection", () => {
  const opened = loaded();
  const withDraft = resourcesReducer(opened, { type: "open-editor", draft: newResourceDraft({}, TANGENT, OPERATION, opened.projection) });
  const failed = resourcesReducer(withDraft, { type: "editor-failed", message: "Injected catalog conflict", operationId: null, inspection: null });
  assert.deepEqual([failed.editor?.error, failed.editor?.operationId], ["Injected catalog conflict", OPERATION]);
  const confirmed = resourcesReducer(withDraft, { type: "editor-failed", message: "missing", operationId: operationId("op-2"), inspection: { kind: "local", normalized: { kind: "worktree", path: "/tmp/a" }, state: "missing" } });
  assert.deepEqual([confirmed.editor?.operationId, confirmed.editor?.confirmMissing], [operationId("op-2"), false]);
  assert.equal(resourcesReducer(INITIAL_RESOURCES_STATE, { type: "editor-failed", message: "x", operationId: null, inspection: null }), INITIAL_RESOURCES_STATE);
});

test("busy, undo, mutation recovery, discovery, scene busy and scene recovery each hold one value", () => {
  const undo = { token: "undo-1", owner: TANGENT, sourceCoupled: false, operationId: OPERATION };
  const state = reduce({ type: "set-busy", busy: "remove" }, { type: "set-undo", undo }, { type: "set-discovery", discovery: { state: "checking", sources: [], problems: [] } },
    { type: "set-scene-busy", busy: { label: "Adding Link to Area…" } });
  assert.deepEqual([state.busy, state.undo, state.sceneBusy?.label], ["remove", undo, "Adding Link to Area…"]);
  assert.equal(state.discovery?.state, "checking");
  const recovery = { code: "catalog-revision-changed", recovery: {}, mutation: null, operationId: OPERATION, success: "Map resources updated.", request: null, message: "Resources changed." };
  assert.equal(resourcesReducer(state, { type: "set-mutation-recovery", recovery }).mutationRecovery, recovery);
  const scene = { phase: "confirm-add-back" as const, operationId: OPERATION, row: row("gone-old", "Removed checkout"), label: "Removed checkout", target: "/tmp/removed" };
  assert.equal(resourcesReducer(state, { type: "set-scene-recovery", recovery: scene }).sceneRecovery, scene);
  assert.equal(resourcesReducer(state, { type: "set-busy", busy: null }).busy, null);
});

test("legacy selection toggles, clears, and is filtered to the candidates a fresh projection still holds", () => {
  const candidate = { state: "candidate", owner: shardOwner(TANGENT), field: "Worktree", evidenceHash: "legacy-main" };
  const withReview: ResourcePanelProjection = { ...projection([]), legacyReview: [candidate] };
  const listed = reduce({ type: "open", area: TANGENT }, { type: "install-projection", projection: withReview, area: TANGENT });
  const candidateKey = [TANGENT, "Worktree", "legacy-main"].join(NUL);
  const selected = resourcesReducer(listed, { type: "toggle-legacy", key: candidateKey, selected: true });
  assert.deepEqual([...selected.legacySelected], [candidateKey]);
  assert.equal(resourcesReducer(selected, { type: "toggle-legacy", key: candidateKey, selected: false }).legacySelected.size, 0);
  assert.equal(resourcesReducer(selected, { type: "clear-legacy-selection" }).legacySelected.size, 0);
  assert.equal(resourcesReducer(selected, { type: "legacy-review-hidden", hidden: true }).legacyReviewHidden, true);
  const reread = resourcesReducer(selected, { type: "install-projection", projection: projection([]), area: TANGENT });
  assert.equal(reread.legacySelected.size, 0, "a candidate the server no longer offers cannot stay selected");
});

test("the action recovery dialog keeps its result and its retried action", () => {
  const facts = { source: { owner: shardOwner(TANGENT), sourceId: "block-1" }, reference: { kind: "resource" as const, entityKind: "worktree", ref: "worktree-main" },
    kindId: "worktree", states: [], display: { kindLabel: "Worktree", label: "Main checkout", targetClue: "", stateText: [], externalTreatment: null, actionLabel: null },
    accessibleName: "Worktree: Main checkout.", searchText: "main checkout", primaryAction: null, readAction: null, sourceState: "current" as const };
  const action = { kind: "copy-path" as const, value: "/tmp/main" };
  const recovery = { result: { state: "blocked" as const }, entity: facts, action, message: "Could not copy Main checkout path." };
  const open = resourcesReducer(loaded(), { type: "set-recovery", recovery });
  assert.equal(open.recovery?.message, "Could not copy Main checkout path.");
  const retried = resourcesReducer(open, { type: "recovery-result", result: { state: "done" } });
  assert.equal(retried.recovery?.result.state, "done");
  const changed = resourcesReducer(open, { type: "recovery-action", action, message: "Copied Main checkout path." });
  assert.equal(changed.recovery?.message, "Copied Main checkout path.");
  assert.equal(resourcesReducer(INITIAL_RESOURCES_STATE, { type: "recovery-result", result: { state: "done" } }), INITIAL_RESOURCES_STATE);
  assert.equal(resourcesReducer(open, { type: "set-recovery", recovery: null }).recovery, null);
});

test("the reducer never mutates the state or the collections it was given", () => {
  const before = loaded();
  const resolutions = new Map(before.resolutions);
  const after = resourcesReducer(before, { type: "install-resolutions", resolutions: [], dropKeys: [key("worktree-main")] });
  assert.notEqual(after.resolutions, before.resolutions);
  assert.deepEqual([...before.resolutions.keys()], [...resolutions.keys()]);
  assert.equal(before.projection?.rows.length, 1);
});
