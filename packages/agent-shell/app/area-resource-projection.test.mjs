import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  areaResourceTargetFingerprint,
  emptyAreaResourceCatalog,
  serializeAreaResourceCatalog,
} from "./area-resource-catalog.mjs";
import {
  areaResourceEvidenceHash,
  createAreaResourceProjection,
  readAreaResourceNoteEvidence,
  readAreaResourcePanelProjection,
  readAreaResourceRepresentations,
  resolveAreaResourceLocators,
} from "./area-resource-projection.mjs";

const NOW = "2026-09-02T00:00:00.000Z";
const DIRECT_ONE = "11111111-1111-4111-8111-111111111111";
const DIRECT_TWO = "22222222-2222-4222-8222-222222222222";
const DIRECT_LINK = "33333333-3333-4333-8333-333333333333";
const DIRECT_GONE = "44444444-4444-4444-8444-444444444444";
const DIRECT_HIDDEN_GONE = "55555555-5555-4555-8555-555555555555";
const INHERITED_DUPLICATE = "66666666-6666-4666-8666-666666666666";
const INHERITED_REPOSITORY = "77777777-7777-4777-8777-777777777777";
const INHERITED_GONE = "88888888-8888-4888-8888-888888888888";
const MISSING_RECORD = "99999999-9999-4999-8999-999999999999";

/** Builds one valid persisted resource record fixture. */
function record(id, target, options = {}) {
  return {
    id,
    label: options.label ?? null,
    membership: options.membership ?? { state: "active" },
    createdAt: options.createdAt ?? NOW,
    updatedAt: options.updatedAt ?? NOW,
    target,
    origin: options.origin ?? null,
  };
}

/** Builds one current catalog-read fixture. */
function catalogRead(owner, resources = [], options = {}) {
  return {
    state: "current",
    owner,
    revision: options.revision ?? `${owner}-revision`,
    catalog: { schema: "area-map-resources.v1", resources, suggestionDecisions: options.suggestionDecisions ?? [] },
  };
}

/** Builds one raw resource root fixture. */
function resourceElement(id, ref, hidden = false, fields = {}) {
  return { id, type: "rectangle", isDeleted: hidden, customData: { tangent: { kind: "resource", ref } }, ...fields };
}

/** Builds one raw source-scene fixture. */
function source(...elements) { return { ok: true, scene: { elements } }; }

/** Returns one immutable not-checked local observation. */
function notChecked() { return { state: "not-checked", value: null, checkedAt: null }; }

test("reads exact legacy and conservative Knowledge evidence without classifying local paths", () => {
  const note = [
    "# Topic",
    "",
    "## Resources",
    "- Repository: `/Users/jules/project` (launch root)",
    "- Worktree: /Users/jules/project/../feature (tracks origin/main)",
    "- Branch: topic/map-entities",
    "",
    "## Knowledge",
    "- Review https://GitHub.com/OpenAI/Codex/pull/42",
    "- Checkout `~/review/../review/feature`",
    "- Parenthesized (https://example.test/clean).",
    "- Autolink <https://auto.test/x>.",
    "- Quoted \"https://quote.test/y\".",
    "- Balanced https://en.wikipedia.org/wiki/Function_(mathematics).",
    "- Ambiguous https://one.test and /tmp/two",
    "```",
    "https://ignored.test/in/a/fence",
    "```",
    "",
  ].join("\n");
  const value = readAreaResourceNoteEvidence("otto/tangent", note, { home: "/Users/jules" });

  assert.deepEqual(value.launch, {
    repository: "/Users/jules/project",
    worktree: "/Users/jules/feature",
    branch: "topic/map-entities",
  });
  const candidates = value.legacyReview.filter((item) => item.state === "candidate");
  assert.deepEqual(candidates.map((item) => [item.evidence.field, item.target, item.declaredBranch]), [
    ["Repository", { kind: "repository", path: "/Users/jules/project" }, "topic/map-entities"],
    ["Worktree", { kind: "worktree", path: "/Users/jules/feature" }, "topic/map-entities"],
  ]);
  assert.equal(candidates[0].evidenceHash, areaResourceEvidenceHash({
    field: "Repository",
    line: "- Repository: `/Users/jules/project` (launch root)",
    branchLine: "- Branch: topic/map-entities",
  }));
  assert.deepEqual(value.suggestions.map((item) => item.target), [
    { kind: "link", url: "https://github.com/OpenAI/Codex/pull/42" },
    { kind: "local-path", path: "/Users/jules/review/feature" },
    { kind: "link", url: "https://example.test/clean" },
    { kind: "link", url: "https://auto.test/x" },
    { kind: "link", url: "https://quote.test/y" },
    { kind: "link", url: "https://en.wikipedia.org/wiki/Function_(mathematics)" },
  ]);
  assert.equal(value.suggestions[0].sourceLine, "- Review https://GitHub.com/OpenAI/Codex/pull/42");
  assert.equal(value.suggestions[0].evidenceHash, areaResourceEvidenceHash(value.suggestions[0].sourceLine));
  assert.equal(value.suggestions[1].targetFingerprint, areaResourceTargetFingerprint(value.suggestions[1].target, { home: "/Users/jules" }));
});

test("catalog decisions hide only their exact reviewed evidence and remain available to mutation revalidation", () => {
  const note = "## Resources\n- Worktree: /tmp/topic\n\n## Knowledge\n- https://example.test/one\n- /tmp/two\n";
  const initial = readAreaResourceNoteEvidence("otto/tangent", note);
  const legacy = initial.legacyReview.find((item) => item.state === "candidate");
  const dismissed = initial.suggestions.find((item) => item.target.kind === "link");
  const resource = record(DIRECT_ONE, legacy.target);
  const decisions = [
    { decision: "imported", evidence: legacy.evidence, evidenceHash: legacy.evidenceHash, targetFingerprint: legacy.targetFingerprint, decidedAt: NOW, resourceId: resource.id },
    { decision: "dismissed", evidence: dismissed.evidence, evidenceHash: dismissed.evidenceHash, targetFingerprint: dismissed.targetFingerprint, decidedAt: NOW, resourceId: null },
  ];
  const reviewed = readAreaResourceNoteEvidence("otto/tangent", note, {
    catalog: { schema: "area-map-resources.v1", resources: [resource], suggestionDecisions: decisions },
  });

  assert.deepEqual(reviewed.legacyReview, []);
  assert.deepEqual(reviewed.suggestions.map((item) => item.target), [{ kind: "local-path", path: "/tmp/two" }]);
  assert.deepEqual(reviewed.decisions, decisions);
  decisions[0].evidenceHash = "mutated-outside";
  assert.notEqual(reviewed.decisions[0].evidenceHash, decisions[0].evidenceHash, "the evidence reader returns an immutable decision snapshot");

  const changed = readAreaResourceNoteEvidence("otto/tangent", note.replace("/tmp/topic", "/tmp/changed"), {
    catalog: { schema: "area-map-resources.v1", resources: [resource], suggestionDecisions: reviewed.decisions },
  });
  assert.equal(changed.legacyReview.filter((item) => item.state === "candidate").length, 1, "changed exact evidence is a new review candidate");
});

test("legacy declaration errors remain explicit instead of becoming an empty review", () => {
  const value = readAreaResourceNoteEvidence("otto/tangent", [
    "## Resources",
    "- Repository:",
    "- Worktree: relative/topic",
    "- Worktree: /tmp/duplicate",
    "- Branch: topic",
  ].join("\n"));
  assert.deepEqual(value.legacyReview.map((item) => [item.state, item.field]), [
    ["invalid", "Repository"],
    ["invalid", "Worktree"],
    ["invalid", "Branch"],
  ]);
  assert.equal(value.launch.worktree, "relative/topic", "launch keeps the existing parser's first-declaration behavior independently of invalid review");
});

test("raw source representations distinguish visible and retained hidden roots and reject ambiguity", () => {
  const label = { id: "label", type: "text", isDeleted: true };
  const value = readAreaResourceRepresentations("otto/tangent", {
    elements: [
      resourceElement("visible", DIRECT_ONE),
      resourceElement("hidden", DIRECT_TWO, true, { boundElements: [{ id: "label", type: "text" }] }),
      label,
    ],
  });
  assert.equal(value.state, "current");
  assert.deepEqual([...value.representations], [[DIRECT_ONE, "on-map"], [DIRECT_TWO, "hidden"]]);

  const duplicate = readAreaResourceRepresentations("otto/tangent", { elements: [resourceElement("a", DIRECT_ONE), resourceElement("b", DIRECT_ONE, true)] });
  assert.equal(duplicate.error.code, "resource-source-invalid");
  const split = readAreaResourceRepresentations("otto/tangent", {
    elements: [resourceElement("a", DIRECT_ONE, false, { boundElements: [{ id: "split-label", type: "text" }] }), { id: "split-label", type: "text", isDeleted: true }],
  });
  assert.equal(split.error.code, "resource-source-invalid");
});

test("joins multi-worktree catalogs, provenance, cache facts, launch binding, and visible direct ghosts", async () => {
  const direct = catalogRead("team/topic", [
    record(DIRECT_ONE, { kind: "worktree", path: "/repo/main" }, { origin: { kind: "legacy-area-binding", field: "Worktree", evidenceHash: "old", declaredBranch: "declared/direct" } }),
    record(DIRECT_TWO, { kind: "worktree", path: "/repo/second" }, { label: "Second checkout" }),
    record(DIRECT_LINK, { kind: "link", url: "https://github.com/o/r/pull/7" }),
    record(DIRECT_GONE, { kind: "repository", path: "/repo/old" }, { label: "Old repository", membership: { state: "removed", removedAt: NOW } }),
    record(DIRECT_HIDDEN_GONE, { kind: "worktree", path: "/repo/hidden-old" }, { membership: { state: "removed", removedAt: NOW } }),
  ]);
  const inherited = catalogRead("team", [
    record(INHERITED_DUPLICATE, { kind: "worktree", path: "/repo/main" }, { label: "Ancestor duplicate" }),
    record(INHERITED_REPOSITORY, { kind: "repository", path: "/repo" }, { label: "Monorepo" }),
    record(INHERITED_GONE, { kind: "repository", path: "/repo/ancestor-old" }, { membership: { state: "removed", removedAt: NOW } }),
  ]);
  const catalogs = new Map([[direct.owner, direct], [inherited.owner, inherited]]);
  const notes = new Map([
    ["team/topic", "## Resources\n- Worktree: /repo/second\n\n## Knowledge\n- Docs https://docs.example.test/topic\n"],
    ["team", "## Resources\n- Repository: /repo\n"],
  ]);
  const sources = new Map([
    ["team/topic", source(
      resourceElement("direct-one", DIRECT_ONE),
      resourceElement("direct-two", DIRECT_TWO, true),
      resourceElement("removed", DIRECT_GONE),
      resourceElement("removed-hidden", DIRECT_HIDDEN_GONE, true),
      resourceElement("unknown", MISSING_RECORD),
    )],
    ["team", source(resourceElement("repository", INHERITED_REPOSITORY), resourceElement("ancestor-gone", INHERITED_GONE))],
  ]);
  const projected = [];
  const observations = {
    /** Returns cache-only target facets and records every projected locator. */
    project(resource) {
      projected.push(resource.locator);
      if (resource.locator.id === DIRECT_ONE) return { local: { state: "current", value: { state: "available", checkout: { kind: "branch", head: "abc", branchRef: "refs/heads/feature/current" }, repositoryPath: "/repo" }, checkedAt: NOW }, link: null };
      if (resource.locator.id === DIRECT_LINK) return { local: null, link: { kind: "github-pr", owner: "o", repository: "r", number: 7, lifecycle: notChecked() } };
      return resource.target.kind === "link" ? { local: null, link: { kind: "generic" } } : { local: notChecked(), link: null };
    },
    /** Fails if a panel GET starts observation I/O. */
    refresh() { throw new Error("GET must not refresh"); },
  };
  const sourceOwners = [];
  const result = await readAreaResourcePanelProjection({
    area: "team/topic",
    /** Reads one exact catalog fixture by owner. */
    readCatalog: async (owner) => catalogs.get(owner),
    /** Reads one exact Area-note fixture by owner. */
    readNote: async (owner) => notes.get(owner),
    /** Reads one exact source-scene fixture by owner. */
    readSource: async (owner) => { sourceOwners.push(owner); return sources.get(owner); },
    observations,
  });

  assert.equal(result.state, "current");
  assert.deepEqual(result.counts, { state: "current", confirmedAssociations: 5, suggestions: 1, legacyReview: 2 });
  assert.deepEqual(result.catalogs, [{ owner: "team/topic", revision: "team/topic-revision" }, { owner: "team", revision: "team-revision" }]);
  const current = result.rows.filter((row) => row.entity.target);
  assert.equal(current.length, 4, "the direct duplicate suppresses only its inherited display row");
  const first = current.find((row) => row.entity.locator.id === DIRECT_ONE);
  assert.equal(first.entity.label, "feature/current");
  assert.equal(first.entity.representation.value, "on-map");
  assert.deepEqual(first.alsoFrom, ["team"]);
  assert.deepEqual(first.relation, { kind: "direct" });
  const second = current.find((row) => row.entity.locator.id === DIRECT_TWO);
  assert.equal(second.entity.representation.value, "hidden");
  assert.deepEqual(second.launchMatch, { state: "current", value: true });
  const link = current.find((row) => row.entity.locator.id === DIRECT_LINK);
  assert.equal(link.entity.label, "o/r#7");
  assert.equal(link.entity.representation.value, "never-placed");
  const repository = current.find((row) => row.entity.locator.id === INHERITED_REPOSITORY);
  assert.deepEqual(repository.relation, { kind: "inherited", sourceArea: "team" });
  assert.deepEqual(repository.alsoFrom, []);
  const gone = result.rows.filter((row) => row.entity.reason);
  assert.deepEqual(gone.map((row) => [row.entity.locator.id, row.entity.reason]), [[DIRECT_GONE, "removed"], [MISSING_RECORD, "missing-record"]]);
  assert.equal(gone[0].entity.lastKnown.target.path, "/repo/old");
  assert.equal(gone[1].entity.lastKnown, null);
  assert.ok(gone.every((row) => row.viewedFrom === row.entity.locator.owner && row.entity.representation === "on-map"));
  assert.deepEqual(sourceOwners.sort(), ["team", "team/topic"]);
  assert.deepEqual(projected.map((locator) => locator.id).sort(), [DIRECT_LINK, DIRECT_ONE, DIRECT_TWO, INHERITED_REPOSITORY].sort());
});

test("direct catalog failure blocks false empty state before note, scene, or observation reads", async () => {
  let derivedReads = 0;
  const result = await readAreaResourcePanelProjection({
    area: "team/topic",
    /** Returns one blocking direct-catalog failure. */
    readCatalog: async (owner) => owner === "team/topic"
      ? { state: "unavailable", owner, error: { owner, code: "catalog-unsupported", message: "newer", retryable: false } }
      : catalogRead(owner),
    /** Records forbidden note work after a blocking catalog failure. */
    readNote: async () => { derivedReads += 1; return ""; },
    /** Records forbidden source work after a blocking catalog failure. */
    readSource: async () => { derivedReads += 1; return source(); },
    observations: {
      /** Records forbidden cache projection after a blocking catalog failure. */
      project() { derivedReads += 1; return { local: notChecked(), link: null }; },
    },
  });
  assert.deepEqual(result, { state: "unavailable", error: { owner: "team/topic", code: "catalog-unsupported", message: "newer", retryable: false } });
  assert.equal(derivedReads, 0);
});

test("ancestor, note, and scene failures preserve usable rows as a lower-bound partial projection", async () => {
  const direct = catalogRead("team/topic", [record(DIRECT_ONE, { kind: "worktree", path: "/tmp/topic" })]);
  let cacheReads = 0;
  const result = await readAreaResourcePanelProjection({
    area: "team/topic",
    /** Returns one current direct and one invalid ancestor catalog. */
    readCatalog: async (owner) => owner === direct.owner ? direct : { state: "unavailable", owner, error: { owner, code: "catalog-invalid", message: "invalid", retryable: false } },
    /** Makes the direct note unavailable while retaining an ancestor note. */
    readNote: async (owner) => { if (owner === "team/topic") throw new Error("private path"); return ""; },
    /** Returns a typed invalid raw source. */
    readSource: async () => ({ ok: false }),
    observations: {
      /** Returns an independent cached observation. */
      project() { cacheReads += 1; return { local: notChecked(), link: null }; },
    },
  });

  assert.equal(result.state, "partial");
  assert.deepEqual(result.counts, { state: "lower-bound", confirmedAssociationsAtLeast: 1, suggestionsAtLeast: 0, legacyReviewAtLeast: 0 });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].entity.target.path, "/tmp/topic");
  assert.equal(result.rows[0].entity.representation.state, "unavailable");
  assert.equal(result.rows[0].launchMatch.state, "unavailable");
  assert.deepEqual(result.problems.map((problem) => [problem.kind, problem.error.source ?? problem.error.owner, problem.error.code]), [
    ["catalog", "team", "catalog-invalid"],
    ["projection", "area-note", "resource-source-load-failed"],
    ["projection", "source-scene", "resource-source-invalid"],
  ]);
  assert.equal(cacheReads, 1, "cached target facts remain independent of scene availability");
});

test("an available ancestor note still supplies launch facts when its catalog is unavailable", async () => {
  const result = await readAreaResourcePanelProjection({
    area: "team/topic",
    /** Returns a current direct catalog and one unavailable ancestor catalog. */
    readCatalog: async (owner) => owner === "team/topic"
      ? catalogRead(owner, [record(DIRECT_ONE, { kind: "repository", path: "/repo" })])
      : { state: "unavailable", owner, error: { owner, code: "catalog-invalid", message: "invalid", retryable: false } },
    /** Returns an exact launch declaration only from the ancestor. */
    readNote: async (owner) => owner === "team" ? "## Resources\n- Repository: /repo\n" : "# Topic\n",
    /** Returns current empty source scenes. */
    readSource: async () => source(),
  });
  assert.equal(result.state, "partial");
  assert.deepEqual(result.rows[0].launchMatch, { state: "current", value: true });
});

test("a nearer launch declaration stays current when a farther note cannot be read", async () => {
  const result = await readAreaResourcePanelProjection({
    area: "team/topic",
    /** Returns current direct and ancestor catalogs. */
    readCatalog: async (owner) => catalogRead(owner, owner === "team/topic" ? [record(DIRECT_ONE, { kind: "worktree", path: "/repo/topic" })] : []),
    /** Returns the precedence-winning direct note and fails the farther note. */
    readNote: async (owner) => {
      if (owner === "team/topic") return "## Resources\n- Worktree: /repo/topic\n";
      throw Object.assign(new Error("unreadable"), { code: "resource-source-invalid" });
    },
    /** Returns current empty source scenes. */
    readSource: async () => source(),
  });
  assert.equal(result.state, "partial");
  assert.deepEqual(result.rows[0].launchMatch, { state: "current", value: true });
  assert.equal(result.problems.find((problem) => problem.error.owner === "team").error.code, "resource-source-invalid");
});

test("invalid UTF-8 note bytes produce an invalid source fact rather than empty evidence", async () => {
  const result = await readAreaResourcePanelProjection({
    area: "otto",
    /** Returns one active direct catalog. */
    readCatalog: async (owner) => catalogRead(owner, [record(DIRECT_ONE, { kind: "repository", path: "/repo" })]),
    /** Returns byte-invalid exact note evidence. */
    readNote: async () => Buffer.from([0xc3, 0x28]),
    /** Returns one current empty source scene. */
    readSource: async () => source(),
  });
  assert.equal(result.state, "partial");
  assert.equal(result.problems[0].error.code, "resource-source-invalid");
  assert.equal(result.rows[0].launchMatch.state, "unavailable");
});

test("resolves ordered current, tombstone, missing-record, missing-owner, and unsupported identities", async () => {
  const owner = "team/topic";
  const active = record(DIRECT_ONE, { kind: "worktree", path: "/tmp/topic" });
  const removed = record(DIRECT_GONE, { kind: "repository", path: "/tmp/old" }, { label: "Old", membership: { state: "removed", removedAt: NOW } });
  const good = catalogRead(owner, [active, removed]);
  const locators = [
    { owner, id: DIRECT_ONE },
    { owner, id: DIRECT_GONE },
    { locator: { owner, id: MISSING_RECORD }, representation: "hidden", lastKnown: { label: "Remembered", target: { kind: "link", url: "https://example.test/old" } } },
    { locator: { owner: "team/moved", id: DIRECT_TWO }, representation: "hidden", lastKnown: { label: "Moved", target: { kind: "worktree", path: "/tmp/moved" } } },
    { owner: "team/newer", id: DIRECT_LINK },
  ];
  const sourceReads = [];
  const result = await resolveAreaResourceLocators({
    locators,
    /** Reports one stale composed owner as missing. */
    ownerExists: async (candidate) => candidate !== "team/moved",
    /** Returns current authority or throws a typed newer-schema error. */
    readCatalog: async (candidate) => {
      if (candidate === owner) return good;
      throw Object.assign(new Error("private schema detail"), { code: "catalog-unsupported", retryable: false });
    },
    /** Reads a source only for a current catalog owner. */
    readSource: async (candidate) => { sourceReads.push(candidate); return source(resourceElement("active", DIRECT_ONE, true), resourceElement("gone", DIRECT_GONE)); },
    observations: {
      /** Returns a cache-only current entity facet. */
      project() { return { local: notChecked(), link: null }; },
    },
  });

  assert.deepEqual(result.resolutions.map((item) => item.state), ["current", "gone", "gone", "gone", "unavailable"]);
  assert.equal(result.resolutions[0].value.representation.value, "hidden");
  assert.equal(result.resolutions[1].value.reason, "removed");
  assert.equal(result.resolutions[1].value.lastKnown.target.path, "/tmp/old");
  assert.equal(result.resolutions[2].value.reason, "missing-record");
  assert.deepEqual(result.resolutions[2].value.lastKnown, { label: "Remembered", target: { kind: "link", url: "https://example.test/old" } });
  assert.equal(result.resolutions[3].value.reason, "missing-owner");
  assert.equal(result.resolutions[3].value.representation, "hidden");
  assert.equal(result.resolutions[4].error.code, "catalog-unsupported");
  assert.deepEqual(result.catalogs, [{ owner, revision: "team/topic-revision" }]);
  assert.deepEqual(sourceReads, [owner], "unsupported and missing owners start no scene read");
});

test("factory uses one transaction snapshot, exact ephemeral files, and cache-only observation projection", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-resource-projection-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const owner = "otto";
  const directory = path.join(root, owner);
  await mkdir(directory, { recursive: true });
  const active = record(DIRECT_ONE, { kind: "worktree", path: "/tmp/otto" });
  const decision = { decision: "dismissed", evidence: { kind: "knowledge-line" }, evidenceHash: "old-line", targetFingerprint: areaResourceTargetFingerprint({ kind: "link", url: "https://ignored.test" }), decidedAt: NOW, resourceId: null };
  await writeFile(path.join(directory, "map-resources.json"), serializeAreaResourceCatalog({ schema: "area-map-resources.v1", resources: [active], suggestionDecisions: [decision] }));
  await writeFile(path.join(directory, "otto.md"), "## Resources\n- Worktree: /tmp/otto\n\n## Knowledge\n- https://example.test/current\n");
  let snapshots = 0;
  let sourceReads = 0;
  let cacheReads = 0;
  const transactions = {
    /** Runs one injected read barrier and records its use. */
    async withRead(operation) { snapshots += 1; return operation(); },
    /** Reads only the exact owner source scene. */
    async read(candidate) { sourceReads += 1; assert.equal(candidate, owner); return source(resourceElement("active", DIRECT_ONE)); },
  };
  const observations = {
    /** Projects only a cached local fact. */
    project() { cacheReads += 1; return { local: notChecked(), link: null }; },
    /** Fails if a read operation starts an observation. */
    refresh() { throw new Error("read operation must not refresh"); },
  };
  const projection = createAreaResourceProjection({ root, transactions, observations });

  const panel = await projection.read({ area: owner });
  const evidence = await projection.evidence(owner);
  const resolved = await projection.resolve({ resources: [{ owner, id: DIRECT_ONE }] });
  assert.equal(panel.state, "current");
  assert.equal(panel.rows[0].entity.representation.value, "on-map");
  assert.equal(evidence.state, "current");
  assert.deepEqual(evidence.decisions, [{ ...decision, owner }]);
  assert.equal(evidence.suggestions.length, 1);
  assert.equal(resolved.resolutions[0].state, "current");
  assert.equal(snapshots, 3);
  assert.equal(sourceReads, 2, "panel and resolver each read the source once; evidence does not");
  assert.equal(cacheReads, 2);
});

test("factory evidence revalidates an exact multi-owner legacy batch and rejects unrelated owners", async () => {
  const catalogs = new Map([
    ["team/topic", catalogRead("team/topic")],
    ["team", catalogRead("team")],
  ]);
  const notes = new Map([
    ["team/topic", "## Resources\n- Worktree: /tmp/topic\n"],
    ["team", "## Resources\n- Repository: /tmp/team\n"],
  ]);
  let snapshots = 0;
  const projection = createAreaResourceProjection({
    root: "/unused",
    transactions: {
      /** Runs the complete owner batch in one read snapshot. */
      async withRead(operation) { snapshots += 1; return operation(); },
    },
    /** Reads one exact current catalog by owner. */
    readCatalog: async (owner) => catalogs.get(owner),
    /** Reads one exact current Area note by owner. */
    readNote: async (owner) => notes.get(owner),
    /** Returns an unused empty source fixture. */
    readSource: async () => source(),
  });

  const evidence = await projection.evidence("team/topic", { owners: ["team/topic", "team"] });
  assert.equal(evidence.state, "current");
  assert.deepEqual(evidence.legacyReview.filter((item) => item.state === "candidate").map((item) => [item.owner, item.evidence.field]), [
    ["team/topic", "Worktree"],
    ["team", "Repository"],
  ]);
  assert.deepEqual(evidence.catalogs, [{ owner: "team/topic", revision: "team/topic-revision" }, { owner: "team", revision: "team-revision" }]);
  assert.equal(snapshots, 1);
  await assert.rejects(projection.evidence("team/topic", { owners: ["team/sibling"] }), { code: "invalid-resource-target", status: 422 });
  assert.equal(snapshots, 1, "invalid owner relations fail before the transaction reader");
});

test("resolver validates the bounded locator envelope before starting readers", async () => {
  let reads = 0;
  const dependencies = {
    /** Records any forbidden catalog read. */
    readCatalog: async () => { reads += 1; return catalogRead("otto"); },
    /** Records any forbidden source read. */
    readSource: async () => { reads += 1; return source(); },
  };
  await assert.rejects(resolveAreaResourceLocators({ ...dependencies, locators: Array.from({ length: 501 }, () => ({ owner: "otto", id: DIRECT_ONE })) }), { code: "invalid-resource-request", status: 400 });
  await assert.rejects(resolveAreaResourceLocators({ ...dependencies, locators: [{ owner: "../outside", id: DIRECT_ONE }] }), { code: "invalid-resource-request", status: 422 });
  assert.equal(reads, 0);
});

test("empty catalogs still turn visible unknown source refs into direct missing-record ghosts", async () => {
  const result = await readAreaResourcePanelProjection({
    area: "otto",
    /** Returns one valid empty direct catalog. */
    readCatalog: async (owner) => catalogRead(owner),
    /** Returns one exact note without evidence. */
    readNote: async () => "# Otto\n",
    /** Returns one visible source ref with no catalog record. */
    readSource: async () => source(resourceElement("unknown", MISSING_RECORD)),
  });
  assert.equal(result.state, "current");
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0].entity, {
    locator: { owner: "otto", id: MISSING_RECORD },
    reason: "missing-record",
    lastKnown: null,
    representation: "on-map",
    warnings: [],
  });
  assert.deepEqual(result.counts, { state: "current", confirmedAssociations: 0, suggestions: 0, legacyReview: 0 });
});
