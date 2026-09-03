import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { LegacyReviewRow, ResourceEntity, ResourceLocatorKey, ResourcePanelProjection, ResourcePanelRow, ResourceResolution } from "../../kernel/kernel-types.ts";
import { areaKey, shardOwner } from "../../units/ids.ts";
import type { AreaKey, ResourceId } from "../../units/ids.ts";
import {
  checkingResourceResolution, groupPanelResourceRows, legacyCandidateKey, panelIsConfidentlyEmpty, providerLifecycleLabel, resolutionForRow,
  resourceDetailsFacts, resourceGroupForRow, resourceRowFacts, resourceRowKey, resourceRowLabel, resourceWarningTexts, rowCanAddBack,
  rowIsDirect, rowIsLaunchDefault, rowIsWrongKind, rowMatchesFilter, rowProvenance, rowRefreshLabel, rowTargetText,
  savedRepresentationForRow, sortPanelResourceRows, suggestionIsDirect, suggestionLabel, suggestionTargetText,
} from "./resource-rows.ts";

const TANGENT = areaKey("otto/tangent");
const OTTO = areaKey("otto");

/** One worktree entity with a checked-out branch, as the server serves it. */
function worktree(id: string, label: string, owner: AreaKey = TANGENT): ResourceEntity {
  return {
    locator: { owner: shardOwner(owner), id: id as ResourceId }, label,
    target: { kind: "worktree", path: `/tmp/${id}` },
    local: { state: "current", value: { state: "available", checkout: { kind: "branch", head: "abc", branchRef: "refs/heads/map-rebuild" }, repositoryPath: "/tmp/repo" }, checkedAt: "2026-09-02T01:00:00.000Z" },
    link: null, representation: { state: "current", value: "never-placed" }, warnings: [],
  };
}

/** One merged GitHub pull request entity. */
function review(): ResourceEntity {
  return {
    locator: { owner: shardOwner(TANGENT), id: "review-42" as ResourceId }, label: "Map entities review",
    target: { kind: "link", url: "https://github.com/otto/tangent/pull/42" }, local: null,
    link: { kind: "github-pr", lifecycle: { state: "current", value: { stateLabel: "Merged", treatment: "success", providerUpdatedAt: "2026-09-02T00:00:00.000Z" } } },
    representation: { state: "current", value: "on-map" }, warnings: [],
  };
}

/** One row over an entity, direct unless an ancestor is named. */
function panelRow(entity: ResourceEntity, from: AreaKey | null = null, launch = false): ResourcePanelRow {
  return {
    viewedFrom: TANGENT,
    relation: from ? { kind: "inherited", sourceArea: shardOwner(from) } : { kind: "direct" },
    alsoFrom: [], launchMatch: { state: "current", value: launch }, entity,
  };
}

/** The locator key the kernel files one Tangent resource under. */
function locatorKey(id: string): ResourceLocatorKey {
  return `otto/tangent${String.fromCharCode(0)}${id}` as ResourceLocatorKey;
}

test("a row answers with its entity, its locator key and its label, falling back to the last known one", () => {
  const row = panelRow(worktree("worktree-main", "Main checkout"));
  assert.equal(resourceRowKey(row), locatorKey("worktree-main"));
  assert.equal(resourceRowLabel(row), "Main checkout");
  const gone = panelRow({ locator: { owner: shardOwner(TANGENT), id: "gone-old" as ResourceId }, reason: "removed", lastKnown: { label: "Removed checkout", target: { kind: "worktree", path: "/tmp/removed" } }, warnings: [] });
  assert.equal(resourceRowLabel(gone), "Removed checkout");
  assert.equal(rowTargetText(gone.entity), "/tmp/removed");
  assert.equal(resourceRowKey(null), null);
});

test("the resolution shown for a row is the cached one, else the row's own current or gone authority", () => {
  const row = panelRow(worktree("worktree-main", "Main checkout"));
  assert.equal(resolutionForRow(new Map(), row)?.state, "current");
  const cached: ResourceResolution = { state: "current", value: worktree("worktree-main", "Cadence checkout") };
  const resolutions = new Map<ResourceLocatorKey, ResourceResolution>([[locatorKey("worktree-main"), cached]]);
  assert.equal(resolutionForRow(resolutions, row)?.value?.label, "Cadence checkout");
});

test("Checking is projected onto a resolution without discarding its last usable fact", () => {
  const local = checkingResourceResolution({ state: "current", value: worktree("worktree-main", "Main checkout") });
  assert.equal(local.value?.local?.state, "checking");
  assert.equal(local.value?.local?.value?.state, "available", "the last known checkout stays readable while it is checked");
  const link = checkingResourceResolution({ state: "current", value: review() });
  assert.equal(link.value?.link?.lifecycle?.state, "checking");
  assert.equal(providerLifecycleLabel(link), "Merged");
  const gone: ResourceResolution = { state: "gone", value: null };
  assert.equal(checkingResourceResolution(gone), gone);
});

test("rows group by direct kind, removed and inherited, and sort launch first then placed then by label", () => {
  const inherited = panelRow(worktree("repo-shared", "Shared repository", OTTO), OTTO);
  const removed = panelRow({ locator: { owner: shardOwner(TANGENT), id: "gone-old" as ResourceId }, reason: "removed", lastKnown: { label: "Removed checkout" }, warnings: [] });
  const rows = [inherited, removed, panelRow(review()), panelRow(worktree("worktree-main", "Main checkout"))];
  assert.deepEqual(rows.map(resourceGroupForRow), ["inherited", "removed", "links", "local"]);
  assert.deepEqual(groupPanelResourceRows(rows).map((group) => group.key), ["local", "links", "removed", "inherited"]);
  assert.equal(rowIsDirect(inherited), false);
  const placed = panelRow({ ...worktree("placed", "Zebra checkout"), representation: { state: "current", value: "on-map" } });
  const launch = panelRow(worktree("launch", "Zulu checkout"), null, true);
  const sorted = sortPanelResourceRows([panelRow(worktree("alpha", "Alpha checkout")), placed, launch]);
  assert.deepEqual(sorted.map(resourceRowLabel), ["Zulu checkout", "Zebra checkout", "Alpha checkout"]);
  assert.equal(rowIsLaunchDefault(launch), true);
});

test("the saved Map state of a row never reads an unavailable source read as Never placed", () => {
  assert.equal(savedRepresentationForRow(panelRow(worktree("a", "A"))), "never-placed");
  assert.equal(savedRepresentationForRow(panelRow({ ...worktree("a", "A"), representation: { state: "unavailable", error: { message: "no" } } })), "unavailable");
  assert.equal(savedRepresentationForRow(null), "unavailable");
});

test("provenance, the refresh label, Add back and Change to Repository each read one row fact", () => {
  assert.equal(rowProvenance(panelRow(worktree("a", "A"))), "Direct");
  assert.equal(rowProvenance(panelRow(worktree("repo-shared", "Shared repository", OTTO), OTTO)), "From otto");
  assert.equal(rowRefreshLabel(review()), "Refresh status");
  assert.equal(rowRefreshLabel(worktree("a", "A")), "Refresh path");
  assert.equal(rowRefreshLabel({ ...worktree("a", "A"), local: { state: "not-checked", value: null, checkedAt: null } }), "Check path");
  const gone = panelRow({ locator: { owner: shardOwner(TANGENT), id: "gone-old" as ResourceId }, reason: "removed", lastKnown: { label: "Removed checkout", target: { kind: "worktree", path: "/tmp/removed" } }, warnings: [] });
  assert.equal(rowCanAddBack(gone), true);
  assert.equal(rowCanAddBack(panelRow(worktree("a", "A"))), false, "a current row was never removed");
  const wrong = panelRow({ ...worktree("wrong-kind", "Checkout-shaped repository"), local: { state: "current", value: { state: "not-a-worktree", checkout: null, repositoryPath: null }, checkedAt: "now" } });
  assert.equal(rowIsWrongKind(wrong), true);
  assert.equal(rowIsWrongKind(panelRow(worktree("a", "A"))), false);
});

test("a row resolves to the same facts as its Map Block and filters on their words", () => {
  const row = panelRow(worktree("worktree-main", "Main checkout"));
  const facts = resourceRowFacts(row, resolutionForRow(new Map(), row), null);
  assert.equal(facts?.display.label, "Main checkout");
  assert.equal(rowMatchesFilter(facts, ""), true);
  assert.equal(rowMatchesFilter(facts, "main"), true);
  assert.equal(rowMatchesFilter(facts, "zzz"), false);
  assert.equal(rowMatchesFilter(null, "main"), false, "a row with no facts matches no filter");
});

test("details facts read the observed entity, name the branch without its ref prefix, and print every warning", () => {
  const row = panelRow({ ...worktree("worktree-main", "Main checkout"), origin: { kind: "legacy-area-binding", field: "Worktree", declaredBranch: "legacy/main" } });
  const facts = resourceDetailsFacts(row, resolutionForRow(new Map(), row));
  assert.deepEqual([facts.branch, facts.repositoryPath, facts.checkedAt], ["map-rebuild", "/tmp/repo", "2026-09-02T01:00:00.000Z"]);
  assert.equal(facts.legacyOrigin, "Worktree · Branch legacy/main");
  const warned = { ...worktree("a", "A"), warnings: [{ kind: "path-alias", other: { id: "other" as ResourceId, owner: shardOwner(OTTO) } }, { kind: "unknown-warning" }] };
  assert.deepEqual(resourceWarningTexts(warned), ["Path may alias resource other in otto."]);
});

test("a legacy candidate has a stable key and a Suggestion knows the Area that may write it", () => {
  const candidate: LegacyReviewRow = { state: "candidate", owner: shardOwner(TANGENT), field: "Worktree", evidenceHash: "legacy-main", proposedLabel: "Legacy checkout" };
  assert.equal(legacyCandidateKey(candidate), legacyCandidateKey({ ...candidate }));
  assert.notEqual(legacyCandidateKey(candidate), legacyCandidateKey({ ...candidate, field: "Repository" }));
  const suggestion = { owner: shardOwner(OTTO), proposedLabel: "Shared staging", target: { kind: "worktree" as const, path: "/tmp/staging" } };
  assert.equal(suggestionIsDirect(suggestion, TANGENT), false);
  assert.equal(suggestionIsDirect(suggestion, OTTO), true);
  assert.equal(suggestionIsDirect(suggestion, null), false);
  assert.equal(suggestionTargetText(suggestion), "/tmp/staging");
  assert.equal(suggestionLabel(suggestion), "Shared staging");
  assert.equal(suggestionLabel({ owner: shardOwner(OTTO), target: { kind: "worktree", path: "/tmp/staging" } }), "/tmp/staging");
});

test("the panel claims emptiness only over a current read with no row, Suggestion or legacy review", () => {
  const empty: ResourcePanelProjection = { state: "current", rows: [], legacyReview: [], suggestions: [] };
  assert.equal(panelIsConfidentlyEmpty(empty), true);
  assert.equal(panelIsConfidentlyEmpty({ ...empty, state: "partial" }), false, "a lower bound never claims exact emptiness");
  assert.equal(panelIsConfidentlyEmpty({ ...empty, legacyReview: [{ state: "problem", owner: shardOwner(TANGENT), field: "Worktree" }] }), false);
  assert.equal(panelIsConfidentlyEmpty({ ...empty, suggestions: [{ owner: shardOwner(TANGENT) }] }), false);
  assert.equal(panelIsConfidentlyEmpty(null), false);
});
