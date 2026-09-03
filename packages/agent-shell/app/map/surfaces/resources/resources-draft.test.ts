import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { ResourceEntity, ResourcePanelProjection, ResourcePanelRow, ResourceSuggestion } from "../../kernel/kernel-types.ts";
import { areaKey, operationId, shardOwner } from "../../units/ids.ts";
import type { AreaKey, ResourceId } from "../../units/ids.ts";
import {
  draftCatalogExpectations, draftInspectRequest, draftMutation, draftNeedsMissingConfirmation, draftOwner,
  newResourceDraft, sameCatalogRevisions, targetInputFrom,
} from "./resources-draft.ts";
import type { InspectedTarget } from "./resources-wire.ts";

const TANGENT = areaKey("otto/tangent");
const OTTO = areaKey("otto");
const OPERATION = operationId("op-1");

/** A current projection with one catalog revision for each of the two fixture Areas. */
const PROJECTION: ResourcePanelProjection = {
  state: "current", viewedFrom: TANGENT, rows: [], legacyReview: [], suggestions: [],
  catalogs: [{ owner: shardOwner(TANGENT), revision: "cat-child" }, { owner: shardOwner(OTTO), revision: "cat-parent" }],
};

/** One row over a worktree entity in the named Area. */
function row(id: string, label: string, owner: AreaKey = TANGENT): ResourcePanelRow {
  const entity: ResourceEntity = {
    locator: { owner: shardOwner(owner), id: id as ResourceId }, label,
    target: { kind: "worktree", path: `/tmp/${id}` },
    local: { state: "not-checked", value: null, checkedAt: null }, link: null,
    representation: { state: "current", value: "never-placed" }, warnings: [],
  };
  return { viewedFrom: TANGENT, relation: { kind: "direct" }, alsoFrom: [], launchMatch: { state: "current", value: false }, entity };
}

/** One Suggestion the note proposes in the named Area. */
function suggestion(owner: AreaKey): ResourceSuggestion {
  return { owner: shardOwner(owner), proposedLabel: "Shared staging", target: { kind: "worktree", path: "/tmp/staging" }, evidenceHash: "evidence-1" };
}

test("an add draft starts empty on the panel's Area and is fenced to that Area's catalog alone", () => {
  const draft = newResourceDraft({}, TANGENT, OPERATION, PROJECTION);
  assert.deepEqual([draft.mode, draft.owner, draft.kind, draft.label, draft.target], ["add", TANGENT, "worktree", "", ""]);
  assert.equal(draftOwner(draft), TANGENT);
  assert.deepEqual(draft.expectedCatalogs, [{ owner: shardOwner(TANGENT), revision: "cat-child" }]);
  assert.deepEqual([draft.stale, draft.hidden, draft.confirmMissing, draft.error], [false, false, false, ""]);
});

test("an edit draft opens on the row's target and label and is fenced to the row's own Area", () => {
  const draft = newResourceDraft({ mode: "edit", row: row("repo-shared", "Shared repository", OTTO) }, TANGENT, OPERATION, PROJECTION);
  assert.deepEqual([draft.kind, draft.label, draft.target, draft.owner], ["worktree", "Shared repository", "/tmp/repo-shared", null]);
  assert.equal(draftOwner(draft), OTTO);
  assert.deepEqual(draft.expectedCatalogs, [{ owner: shardOwner(OTTO), revision: "cat-parent" }]);
});

test("an explicit kind change empties a target of the wrong shape and keeps one of the right shape", () => {
  const worktreeRow = row("wrong-kind", "Checkout-shaped repository");
  const repository = newResourceDraft({ mode: "edit", kind: "repository", row: worktreeRow }, TANGENT, OPERATION, PROJECTION);
  assert.deepEqual([repository.kind, repository.target], ["repository", "/tmp/wrong-kind"], "a path is a path under either local kind");
  const link = newResourceDraft({ mode: "edit", kind: "link", row: worktreeRow }, TANGENT, OPERATION, PROJECTION);
  assert.deepEqual([link.kind, link.target], ["link", ""], "a recorded path is never offered as a URL");
});

test("a Suggestion draft carries its proposed label and target, and a local-path Suggestion becomes a worktree", () => {
  const draft = newResourceDraft({ mode: "suggestion", suggestion: suggestion(OTTO) }, TANGENT, OPERATION, PROJECTION);
  assert.deepEqual([draft.mode, draft.kind, draft.label, draft.target], ["suggestion", "worktree", "Shared staging", "/tmp/staging"]);
  assert.equal(draftOwner(draft), OTTO, "a Suggestion is written in the Area that owns it");
  const localPath = newResourceDraft({ mode: "suggestion", suggestion: { owner: shardOwner(TANGENT), target: { kind: "local-path", path: "/tmp/found" } } }, TANGENT, OPERATION, PROJECTION);
  assert.equal(localPath.kind, "worktree");
});

test("catalog fences compare owner, revision and order", () => {
  const fence = draftCatalogExpectations(newResourceDraft({}, TANGENT, OPERATION, PROJECTION), PROJECTION);
  assert.equal(sameCatalogRevisions(fence, [{ owner: shardOwner(TANGENT), revision: "cat-child" }]), true);
  assert.equal(sameCatalogRevisions(fence, [{ owner: shardOwner(TANGENT), revision: "cat-external" }]), false);
  assert.equal(sameCatalogRevisions(fence, []), false);
  assert.deepEqual(draftCatalogExpectations(newResourceDraft({}, null, OPERATION, PROJECTION), PROJECTION), [], "a draft with no Area is fenced to nothing");
});

test("the inspect request names a URL for a link and a path otherwise", () => {
  const link = newResourceDraft({ kind: "link" }, TANGENT, OPERATION, null);
  assert.deepEqual(draftInspectRequest({ ...link, target: "https://example.com" }), { kind: "link", url: "https://example.com" });
  const local = newResourceDraft({ kind: "repository" }, TANGENT, OPERATION, null);
  assert.deepEqual(draftInspectRequest({ ...local, target: "/tmp/repo" }), { kind: "repository", path: "/tmp/repo" });
});

test("a missing path needs one confirmation and then records its fingerprint", () => {
  const draft = newResourceDraft({}, TANGENT, OPERATION, null);
  const missing: InspectedTarget = { kind: "local", normalized: { kind: "worktree", path: "/tmp/future" }, state: "missing", targetFingerprint: "fixture-target" };
  assert.equal(draftNeedsMissingConfirmation(draft, missing), true);
  assert.equal(draftNeedsMissingConfirmation({ ...draft, confirmMissing: true }, missing), false);
  const available: InspectedTarget = { kind: "local", normalized: { kind: "worktree", path: "/tmp/here" }, state: "available" };
  assert.equal(draftNeedsMissingConfirmation(draft, available), false);
  assert.deepEqual(targetInputFrom(missing), { target: { kind: "worktree", path: "/tmp/future" }, missingConfirmation: { targetFingerprint: "fixture-target" } });
  assert.deepEqual(targetInputFrom(available), { target: { kind: "worktree", path: "/tmp/here" }, missingConfirmation: null });
  assert.deepEqual(targetInputFrom({ kind: "link", normalized: { kind: "link", url: "https://example.com" }, state: "available" }), { target: { kind: "link", url: "https://example.com" } });
});

test("a draft becomes the mutation its mode names, and none when its row or its Area is gone", () => {
  const input = { target: { kind: "worktree" as const, path: "/tmp/new" } };
  const add = draftMutation({ ...newResourceDraft({}, TANGENT, OPERATION, null), label: "  New checkout  " }, input, TANGENT);
  assert.deepEqual(add, { kind: "add", owner: shardOwner(TANGENT), input, label: "New checkout" });
  assert.equal(draftMutation(newResourceDraft({}, null, OPERATION, null), input, null), null);
  const edit = draftMutation(newResourceDraft({ mode: "edit", row: row("worktree-main", "Main checkout") }, TANGENT, OPERATION, null), input, TANGENT);
  assert.equal(edit?.kind, "edit");
  assert.equal(draftMutation(newResourceDraft({ mode: "edit" }, TANGENT, OPERATION, null), input, TANGENT), null, "an edit that lost its row saves nothing");
  const accepted = draftMutation(newResourceDraft({ mode: "suggestion", suggestion: suggestion(OTTO) }, TANGENT, OPERATION, null), input, TANGENT);
  assert.equal(accepted?.kind, "add-suggestion");
  assert.deepEqual(accepted?.kind === "add-suggestion" ? accepted.selection.suggestion.evidenceHash : null, "evidence-1", "the exact evidence the server checks travels back");
  const empty = draftMutation({ ...newResourceDraft({}, TANGENT, OPERATION, null), label: "   " }, input, TANGENT);
  assert.equal(empty?.kind === "add" ? empty.label : "unset", null, "an empty label records no label at all");
});
