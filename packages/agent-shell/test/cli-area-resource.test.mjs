import assert from "node:assert/strict";
import test from "node:test";

import { areaCommandSpec, runAreaCli } from "../dist/cli/index.js";

const AREA = "otto/tangent";
const DIRECT_ID = "11111111-1111-4111-8111-111111111111";
const INHERITED_ID = "22222222-2222-4222-8222-222222222222";

/** Returns one current projection with direct, inherited, review, and suggestion evidence. */
function projection(overrides = {}) {
  return {
    state: "current",
    catalogs: [
      { owner: AREA, revision: "child-catalog-revision" },
      { owner: "otto", revision: "root-catalog-revision" },
    ],
    rows: [
      {
        viewedFrom: AREA,
        relation: { kind: "direct" },
        alsoFrom: [],
        entity: {
          locator: { owner: AREA, id: DIRECT_ID },
          label: "Feature checkout",
          target: { kind: "worktree", path: "/tmp/feature-checkout" },
          representation: { state: "current", value: "never-placed" },
          local: { state: "current", value: { state: "available" }, checkedAt: "2026-09-02T00:00:00.000Z" },
          link: null,
        },
      },
      {
        viewedFrom: AREA,
        relation: { kind: "inherited", sourceArea: "otto" },
        alsoFrom: [],
        entity: {
          locator: { owner: "otto", id: INHERITED_ID },
          label: "Main repository",
          target: { kind: "repository", path: "/tmp/main-repository" },
          representation: { state: "current", value: "on-map" },
          local: { state: "not-checked", value: null, checkedAt: null },
          link: null,
        },
      },
    ],
    legacyReview: [
      {
        state: "candidate",
        owner: "otto",
        target: { kind: "repository", path: "/tmp/legacy-repository" },
        evidence: { kind: "legacy-area-binding", field: "Repository" },
        evidenceHash: "legacy-evidence-root",
        targetFingerprint: "legacy-target-root",
        proposedLabel: "Legacy repository",
        provenanceLabel: "Repository in otto",
        declaredBranch: "main",
      },
    ],
    suggestions: [
      {
        owner: AREA,
        target: { kind: "worktree", path: "/tmp/suggested-worktree" },
        evidence: { kind: "git-worktree", repositoryTargetFingerprint: "repo-fp", pathFingerprint: "path-fp" },
        evidenceHash: "suggestion-evidence-child",
        targetFingerprint: "suggestion-target-child",
        proposedLabel: "Suggested checkout",
        provenanceLabel: "Git worktree",
      },
    ],
    counts: { state: "current", confirmedAssociations: 2, suggestions: 1, legacyReview: 1 },
    ...overrides,
  };
}

/** Returns one eager map-world source with exact hash and generic Link roots. */
function mapWorld(elements = [{
  id: "generic-link-1",
  isDeleted: false,
  containerId: null,
  customData: { tangent: { kind: "link", ref: "https://example.test/review/1" } },
}]) {
  return {
    schema: "area-map-world.v1",
    worldId: "world-resource-cli",
    treeRevision: "tree-resource-cli",
    worldRevision: "world-revision-resource-cli",
    locatedArea: AREA,
    areas: [{
      key: AREA,
      shard: { owner: AREA, state: "ready", hash: "source-scene-hash", scene: { elements } },
    }],
  };
}

/** Runs a resource command against an isolated fetch/log fixture. */
async function runFixture(argv, handler = () => Response.json({ error: "unexpected request" }, { status: 404 }), resourceProjection = projection()) {
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  const previousTmux = process.env.TMUX;
  const requests = [];
  const printed = [];
  delete process.env.TMUX;
  console.log = (...parts) => printed.push(parts.join(" "));
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const body = init.body ? JSON.parse(String(init.body)) : null;
    requests.push({
      path: url.pathname,
      search: url.search,
      method: String(init.method ?? "GET"),
      body,
      operationId: new Headers(init.headers).get("x-tangent-operation-id"),
    });
    if (url.pathname === "/api/tree") {
      return Response.json({ areas: [{ path: "otto", children: [{ path: AREA, children: [] }] }] });
    }
    if (url.pathname === "/api/areas/map-resources" && !init.method) return Response.json(resourceProjection);
    return handler({ url, init, body, requests });
  };
  try {
    await runAreaCli(argv);
    return { requests, printed, text: printed.join("\n") };
  } finally {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
    if (previousTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = previousTmux;
  }
}

/** Finds the nested resource command specification. */
function resourceSpec() {
  return areaCommandSpec.subcommands.find((entry) => entry.name === "resource");
}

test("Area help publishes the complete Brain-facing Map resource lifecycle", () => {
  const resource = resourceSpec();
  assert.ok(resource);
  assert.deepEqual(resource.subcommands.map((entry) => entry.name), [
    "list", "show", "add", "associate", "import", "discover", "dismiss", "place", "hide", "restore", "add-back", "edit", "remove", "check", "refresh", "undo",
  ]);
  assert.deepEqual(resource.subcommands.find((entry) => entry.name === "add").options.map((entry) => entry.name), [
    "kind", "path", "url", "label", "suggestion", "allow-missing", "operation-id", "server", "json",
  ]);
  assert.deepEqual(resource.subcommands.find((entry) => entry.name === "import").options.map((entry) => entry.name), [
    "candidate", "all", "branch-to", "operation-id", "server", "json",
  ]);
  assert.deepEqual(resource.subcommands.find((entry) => entry.name === "associate").options.map((entry) => entry.name), [
    "label", "operation-id", "server", "json",
  ]);
  assert.deepEqual(resource.subcommands.find((entry) => entry.name === "add-back").options.map((entry) => entry.name), [
    "confirm-last-known", "operation-id", "server", "json",
  ]);
});

test("nested resource help comes from the same command spec without contacting Agent Shell", async () => {
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  const printed = [];
  globalThis.fetch = async () => { throw new Error("help must not fetch"); };
  console.log = (...parts) => printed.push(parts.join(" "));
  try {
    await runAreaCli(["resource", "add", "--help"]);
  } finally {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
  }
  const output = printed.join("\n");
  assert.match(output, /^tangent area resource add$/m);
  assert.match(output, /--operation-id <value>/);
  assert.match(output, /--allow-missing/);
});

test("resource list and show expose exact targets, provenance, and structured output without discovery", async () => {
  const listed = await runFixture(["resource", "list", AREA]);
  assert.match(listed.text, /Map resources · otto\/tangent \[current\]/);
  assert.match(listed.text, /\/tmp\/feature-checkout/);
  assert.match(listed.text, /Main repository  \[from otto; on-map; not-checked\]/);
  assert.match(listed.text, /legacy:legacy-targe/);
  assert.match(listed.text, /suggestion:suggestion-t/);
  assert.deepEqual(listed.requests.map((request) => request.path), ["/api/tree", "/api/areas/map-resources"]);

  const shown = await runFixture(["resource", "show", AREA, "22222222", "--json"]);
  const value = JSON.parse(shown.text);
  assert.deepEqual(value.entity.locator, { owner: "otto", id: INHERITED_ID });
  assert.deepEqual(value.entity.target, { kind: "repository", path: "/tmp/main-repository" });
  assert.deepEqual(value.relation, { kind: "inherited", sourceArea: "otto" });
});

test("resource add inspects, confirms a missing path, fences the catalog, and reuses one explicit operation ID", async () => {
  const calls = [];
  /** Returns normalized inspection data and replay-aware mutation receipts. */
  const handler = ({ url, body, init }) => {
    calls.push({ path: url.pathname, body, operationId: new Headers(init.headers).get("x-tangent-operation-id") });
    if (url.pathname === "/api/areas/map-resources/inspect-target") {
      return Response.json({ kind: "local", normalized: { kind: "worktree", path: "/tmp/new-checkout" }, targetFingerprint: "new-target-fingerprint", state: "missing" });
    }
    if (url.pathname === "/api/areas/map-resources/apply") {
      return Response.json({ operationId: body.operationId, catalogRevisions: [{ owner: AREA, revision: "next" }], projection: projection(), warnings: [], sourceUpdates: [], undo: { state: "available", token: "undo-add" }, idempotent: calls.filter((call) => call.path.endsWith("/apply")).length > 1 });
    }
    return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
  };
  const argv = ["resource", "add", AREA, "--kind", "worktree", "--path", "/tmp/new-checkout/", "--label", "New checkout", "--allow-missing", "--operation-id", "brain-add-1", "--json"];
  const first = await runFixture(argv, handler);
  const second = await runFixture(argv, handler);
  const writes = calls.filter((call) => call.path.endsWith("/apply"));
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].body, {
    schema: "area-map-resource-mutation.v1",
    operationId: "brain-add-1",
    viewedFrom: AREA,
    mutation: {
      kind: "add",
      owner: AREA,
      input: {
        target: { kind: "worktree", path: "/tmp/new-checkout" },
        missingConfirmation: { targetFingerprint: "new-target-fingerprint" },
      },
      label: "New checkout",
    },
    expectedCatalogs: [{ owner: AREA, revision: "child-catalog-revision" }],
  });
  assert.deepEqual(writes[1].body, writes[0].body);
  assert.equal(writes[0].operationId, "brain-add-1");
  assert.equal(writes[1].operationId, "brain-add-1");
  assert.equal(JSON.parse(first.text).operationId, "brain-add-1");
  assert.equal(JSON.parse(second.text).idempotent, true);
});

test("resource add refuses an inspected missing path until the Brain confirms that exact target", async () => {
  let applied = false;
  await assert.rejects(
    runFixture(["resource", "add", AREA, "--kind", "worktree", "--path", "/tmp/missing"], ({ url }) => {
      if (url.pathname.endsWith("/inspect-target")) return Response.json({ kind: "local", normalized: { kind: "worktree", path: "/tmp/missing" }, targetFingerprint: "missing-fp", state: "missing" });
      if (url.pathname.endsWith("/apply")) applied = true;
      return Response.json({ error: "unexpected" }, { status: 500 });
    }),
    /repeat with --allow-missing to record it as Missing/,
  );
  assert.equal(applied, false);
});

test("resource add can confirm one exact Suggestion evidence tuple without placing it", async () => {
  let apply;
  await runFixture(["resource", "add", AREA, "--suggestion", "suggestion-target", "--operation-id", "brain-suggestion-1", "--json"], ({ url, body }) => {
    if (url.pathname.endsWith("/inspect-target")) return Response.json({ kind: "local", normalized: { kind: "worktree", path: "/tmp/suggested-worktree" }, targetFingerprint: "suggestion-target-child", state: "available" });
    if (url.pathname.endsWith("/apply")) { apply = body; return Response.json({ operationId: body.operationId, warnings: [], sourceUpdates: [], undo: { state: "available", token: "undo-suggestion" } }); }
    return Response.json({ error: "unexpected" }, { status: 404 });
  });
  assert.deepEqual(apply.mutation, {
    kind: "add-suggestion",
    selection: {
      suggestion: {
        owner: AREA,
        target: { kind: "worktree", path: "/tmp/suggested-worktree" },
        evidence: { kind: "git-worktree", repositoryTargetFingerprint: "repo-fp", pathFingerprint: "path-fp" },
        evidenceHash: "suggestion-evidence-child",
        targetFingerprint: "suggestion-target-child",
      },
      input: { target: { kind: "worktree", path: "/tmp/suggested-worktree" }, missingConfirmation: null },
    },
    labelForNewRecord: null,
  });
});

test("resource associate resolves one generic Link source and replays one exact scene-fenced request", async () => {
  const applies = [];
  /** Returns the current source world and replay-aware scene-coupled receipts. */
  const handler = ({ url, body, init }) => {
    if (url.pathname === "/api/areas/map-world") return Response.json(mapWorld());
    if (url.pathname.endsWith("/apply")) {
      applies.push({ body, operationId: new Headers(init.headers).get("x-tangent-operation-id") });
      return Response.json({
        operationId: body.operationId,
        effect: "associate-generic-link",
        resource: { locator: { owner: AREA, id: DIRECT_ID } },
        sourceUpdates: [{ owner: AREA, serializedSource: "source", hash: "next-source", treeRevision: "tree", worldRevision: "world" }],
        warnings: [],
        undo: { state: "available", token: "undo-associate" },
        idempotent: applies.length > 1,
      });
    }
    return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
  };
  const argv = ["resource", "associate", AREA, "generic-link", "--label", "Review link", "--operation-id", "brain-associate-1", "--json"];
  const first = await runFixture(argv, handler);
  const replay = await runFixture(argv, handler);
  assert.equal(applies.length, 2);
  assert.deepEqual(applies[0].body, {
    schema: "area-map-resource-mutation.v1",
    operationId: "brain-associate-1",
    viewedFrom: AREA,
    mutation: {
      kind: "associate-generic-link",
      owner: AREA,
      sourceElementId: "generic-link-1",
      labelForNewRecord: "Review link",
    },
    expectedCatalogs: [{ owner: AREA, revision: "child-catalog-revision" }],
    expectedScenes: [{ owner: AREA, hash: "source-scene-hash" }],
  });
  assert.deepEqual(applies[1].body, applies[0].body);
  assert.deepEqual(applies.map((item) => item.operationId), ["brain-associate-1", "brain-associate-1"]);
  assert.equal(JSON.parse(first.text).sourceUpdates[0].worldRevision, "world");
  assert.equal(JSON.parse(replay.text).idempotent, true);
});

test("resource associate refuses ambiguous source prefixes and unsafe retry identities before apply", async () => {
  const world = mapWorld([
    { id: "generic-link-one", isDeleted: false, containerId: null, customData: { tangent: { kind: "link", ref: "https://one.test" } } },
    { id: "generic-link-two", isDeleted: false, containerId: null, customData: { tangent: { kind: "link", ref: "https://two.test" } } },
  ]);
  let applies = 0;
  /** Supplies the ambiguous world and records any forbidden apply. */
  const handler = ({ url }) => {
    if (url.pathname === "/api/areas/map-world") return Response.json(world);
    if (url.pathname.endsWith("/apply")) applies += 1;
    return Response.json({ error: "apply must not run" }, { status: 500 });
  };
  await assert.rejects(
    runFixture(["resource", "associate", AREA, "generic-link", "--operation-id", "brain-associate-ambiguous"], handler),
    /matches 2 generic Link Blocks; use the full source element ID: generic-link-one, generic-link-two/,
  );
  await assert.rejects(
    runFixture(["resource", "associate", AREA, "generic-link-one", "--operation-id", "unsafe operation id"], handler),
    /--operation-id must be 1-128 safe/,
  );
  assert.equal(applies, 0);
});

test("resource import and dismiss send evidence identities with only their affected catalog revisions", async () => {
  const applies = [];
  /** Records each catalog mutation body and returns a valid receipt. */
  const handler = ({ url, body }) => {
    if (url.pathname.endsWith("/apply")) {
      applies.push(body);
      return Response.json({ operationId: body.operationId, warnings: [], sourceUpdates: [], undo: { state: "available", token: `undo-${applies.length}` } });
    }
    return Response.json({ error: "unexpected" }, { status: 404 });
  };
  await runFixture(["resource", "import", AREA, "legacy-target", "--operation-id", "brain-import-1", "--json"], handler);
  await runFixture(["resource", "dismiss", AREA, "suggestion-evidence", "--operation-id", "brain-dismiss-1", "--json"], handler);

  assert.deepEqual(applies[0], {
    schema: "area-map-resource-mutation.v1",
    operationId: "brain-import-1",
    viewedFrom: AREA,
    mutation: {
      kind: "import-legacy",
      selections: [{
        candidate: {
          owner: "otto",
          target: { kind: "repository", path: "/tmp/legacy-repository" },
          evidence: { kind: "legacy-area-binding", field: "Repository" },
          evidenceHash: "legacy-evidence-root",
          targetFingerprint: "legacy-target-root",
        },
        attachDeclaredBranch: true,
      }],
    },
    expectedCatalogs: [{ owner: "otto", revision: "root-catalog-revision" }],
  });
  assert.deepEqual(applies[1].mutation, {
    kind: "dismiss-suggestion",
    suggestion: {
      owner: AREA,
      target: { kind: "worktree", path: "/tmp/suggested-worktree" },
      evidence: { kind: "git-worktree", repositoryTargetFingerprint: "repo-fp", pathFingerprint: "path-fp" },
      evidenceHash: "suggestion-evidence-child",
      targetFingerprint: "suggestion-target-child",
    },
  });
  assert.deepEqual(applies[1].expectedCatalogs, [{ owner: AREA, revision: "child-catalog-revision" }]);
});

test("place, hide, and restore use the exact reusable representation contract", async () => {
  const representations = [];
  /** Records one representation request and returns its operation receipt. */
  const handler = ({ url, body, init }) => {
    if (url.pathname.endsWith("/representation")) {
      representations.push({ body, operationId: new Headers(init.headers).get("x-tangent-operation-id") });
      return Response.json({ operationId: body.operationId, resource: { locator: body.resource }, warnings: [], undo: { state: "unavailable" } });
    }
    return Response.json({ error: "unexpected" }, { status: 404 });
  };
  await runFixture(["resource", "place", AREA, "22222222", "--operation-id", "brain-place-1", "--json"], handler);
  await runFixture(["resource", "hide", AREA, "11111111", "--operation-id", "brain-hide-1", "--json"], handler);
  await runFixture(["resource", "restore", AREA, DIRECT_ID, "--operation-id", "brain-restore-1", "--json"], handler);

  assert.deepEqual(representations.map((item) => item.body), [
    { schema: "area-map-resource-representation.v1", operationId: "brain-place-1", kind: "place", viewedFrom: AREA, resource: { owner: "otto", id: INHERITED_ID } },
    { schema: "area-map-resource-representation.v1", operationId: "brain-hide-1", kind: "hide", viewedFrom: AREA, resource: { owner: AREA, id: DIRECT_ID } },
    { schema: "area-map-resource-representation.v1", operationId: "brain-restore-1", kind: "restore", viewedFrom: AREA, resource: { owner: AREA, id: DIRECT_ID } },
  ]);
  assert.deepEqual(representations.map((item) => item.operationId), ["brain-place-1", "brain-hide-1", "brain-restore-1"]);
});

test("resource add-back sends a tombstone authority and exact catalog and source fences", async () => {
  const goneProjection = projection({
    rows: [{
      viewedFrom: AREA,
      relation: { kind: "direct" },
      alsoFrom: [],
      entity: {
        locator: { owner: AREA, id: DIRECT_ID },
        reason: "removed",
        lastKnown: { label: "Former checkout", target: { kind: "worktree", path: "/tmp/former-checkout" } },
        representation: "on-map",
      },
    }],
  });
  let applied;
  let operationHeader;
  /** Supplies the exact source world and records one tombstone Add-back request. */
  const handler = ({ url, body, init }) => {
    if (url.pathname === "/api/areas/map-world") return Response.json(mapWorld([]));
    if (url.pathname.endsWith("/apply")) {
      applied = body;
      operationHeader = new Headers(init.headers).get("x-tangent-operation-id");
      return Response.json({
        operationId: body.operationId,
        effect: "add-back-gone",
        resource: { locator: { owner: AREA, id: INHERITED_ID } },
        sourceUpdates: [{ owner: AREA, serializedSource: "next", hash: "next-hash", treeRevision: "tree", worldRevision: "world" }],
        warnings: [],
        undo: { state: "available", token: "undo-add-back" },
      });
    }
    return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
  };
  const output = await runFixture(["resource", "add-back", AREA, "11111111", "--operation-id", "brain-add-back-1", "--json"], handler, goneProjection);
  assert.deepEqual(applied, {
    schema: "area-map-resource-mutation.v1",
    operationId: "brain-add-back-1",
    viewedFrom: AREA,
    mutation: {
      kind: "add-back-gone",
      oldResource: { owner: AREA, id: DIRECT_ID },
      source: { kind: "tombstone" },
    },
    expectedCatalogs: [{ owner: AREA, revision: "child-catalog-revision" }],
    expectedScenes: [{ owner: AREA, hash: "source-scene-hash" }],
  });
  assert.equal(operationHeader, "brain-add-back-1");
  assert.equal(JSON.parse(output.text).effect, "add-back-gone");
});

test("missing-record Add-back requires explicit Last-known confirmation and reinspection", async () => {
  const goneProjection = projection({
    rows: [{
      viewedFrom: AREA,
      relation: { kind: "direct" },
      alsoFrom: [],
      entity: {
        locator: { owner: AREA, id: DIRECT_ID },
        reason: "missing-record",
        lastKnown: { label: "Remembered checkout", target: { kind: "worktree", path: "/tmp/remembered" } },
        representation: "on-map",
      },
    }],
  });
  let inspected = 0;
  let applied;
  /** Reinspects the cached path, then records one confirmed Last-known request. */
  const handler = ({ url, body }) => {
    if (url.pathname.endsWith("/inspect-target")) {
      inspected += 1;
      return Response.json({ kind: "local", normalized: { kind: "worktree", path: "/tmp/remembered" }, targetFingerprint: "remembered-fingerprint", state: "missing" });
    }
    if (url.pathname === "/api/areas/map-world") return Response.json(mapWorld([]));
    if (url.pathname.endsWith("/apply")) {
      applied = body;
      return Response.json({ operationId: body.operationId, effect: "add-back-gone", sourceUpdates: [], warnings: [], undo: { state: "available", token: "undo" } });
    }
    return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
  };
  await assert.rejects(
    runFixture(["resource", "add-back", AREA, DIRECT_ID, "--operation-id", "brain-add-back-unconfirmed"], handler, goneProjection),
    /Review its exact Last-known label and target, then repeat with --confirm-last-known/,
  );
  assert.equal(inspected, 0);
  assert.equal(applied, undefined);

  await runFixture(["resource", "add-back", AREA, DIRECT_ID, "--confirm-last-known", "--operation-id", "brain-add-back-confirmed", "--json"], handler, goneProjection);
  assert.equal(inspected, 1);
  assert.deepEqual(applied.mutation, {
    kind: "add-back-gone",
    oldResource: { owner: AREA, id: DIRECT_ID },
    source: {
      kind: "confirmed-last-known",
      input: {
        target: { kind: "worktree", path: "/tmp/remembered" },
        missingConfirmation: { targetFingerprint: "remembered-fingerprint" },
      },
      label: "Remembered checkout",
    },
  });
  assert.deepEqual(applied.expectedCatalogs, [{ owner: AREA, revision: "child-catalog-revision" }]);
  assert.deepEqual(applied.expectedScenes, [{ owner: AREA, hash: "source-scene-hash" }]);
});

test("discover, refresh, check, and undo keep their safe read and mutation envelopes", async () => {
  const posts = [];
  /** Returns one route-appropriate terminal response for each safe operation. */
  const handler = ({ url, body, init }) => {
    posts.push({ path: url.pathname, body, operationId: new Headers(init.headers).get("x-tangent-operation-id") });
    if (url.pathname.endsWith("/discover")) return Response.json({ suggestions: projection().suggestions, problems: [] });
    if (url.pathname.endsWith("/refresh")) return Response.json({ results: body.resources.map((locator) => ({ locator, observation: { state: "current" } })) });
    if (url.pathname.endsWith("/apply")) return Response.json({ operationId: body.operationId, warnings: [], sourceUpdates: [], undo: { state: "unavailable" } });
    return Response.json({ error: "unexpected" }, { status: 404 });
  };
  await runFixture(["resource", "discover", AREA, "--json"], handler);
  await runFixture(["resource", "refresh", AREA, "11111111", "--json"], handler);
  await runFixture(["resource", "check", AREA, "--json"], handler);
  await runFixture(["resource", "undo", AREA, "undo-token-1", "--operation-id", "brain-undo-1", "--json"], handler);

  assert.deepEqual(posts[0].body, { area: AREA });
  assert.deepEqual(posts[1].body, { resources: [{ owner: AREA, id: DIRECT_ID }] });
  assert.deepEqual(posts[2].body, { resources: [{ owner: AREA, id: DIRECT_ID }, { owner: "otto", id: INHERITED_ID }] });
  assert.deepEqual(posts[3].body, {
    schema: "area-map-resource-mutation.v1",
    operationId: "brain-undo-1",
    viewedFrom: AREA,
    mutation: { kind: "undo", token: "undo-token-1" },
  });
  assert.equal(posts[3].operationId, "brain-undo-1");
});

test("edit and remove use a stable direct locator, while inherited and ambiguous selectors are refused before writes", async () => {
  const applies = [];
  /** Supplies current target inspection and records direct catalog writes. */
  const handler = ({ url, body }) => {
    if (url.pathname.endsWith("/inspect-target")) return Response.json({ kind: "local", normalized: { kind: "worktree", path: "/tmp/feature-checkout" }, targetFingerprint: "feature-fp", state: "available" });
    if (url.pathname.endsWith("/apply")) { applies.push(body); return Response.json({ operationId: body.operationId, warnings: [], sourceUpdates: [], undo: { state: "available", token: "undo" } }); }
    return Response.json({ error: "unexpected" }, { status: 404 });
  };
  await runFixture(["resource", "edit", AREA, "11111111", "--label", "Retitled", "--operation-id", "brain-edit-1", "--json"], handler);
  await runFixture(["resource", "remove", AREA, DIRECT_ID, "--operation-id", "brain-remove-1", "--json"], handler);
  assert.deepEqual(applies[0].mutation, {
    kind: "edit",
    resource: { owner: AREA, id: DIRECT_ID },
    input: { target: { kind: "worktree", path: "/tmp/feature-checkout" }, missingConfirmation: null },
    label: "Retitled",
  });
  assert.deepEqual(applies[1].mutation, { kind: "remove", resource: { owner: AREA, id: DIRECT_ID } });

  await assert.rejects(
    runFixture(["resource", "edit", AREA, "22222222", "--label", "No", "--operation-id", "brain-bad-edit"], handler),
    /cannot edit inherited resource.*change it in otto/,
  );
  assert.equal(applies.length, 2);

  const ambiguousProjection = projection({
    rows: [
      projection().rows[0],
      { ...projection().rows[0], entity: { ...projection().rows[0].entity, locator: { owner: AREA, id: "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } } },
    ],
  });
  await assert.rejects(runFixture(["resource", "remove", AREA, "11111111"], ({ url }) => {
    return Response.json({ error: "write must not run" }, { status: 500 });
  }, ambiguousProjection), /matches 2 Map resources; use more of the resource ID/);
});

test("typed server conflicts preserve status, code, operation ID, and safe recovery payload", async () => {
  let caught;
  try {
    await runFixture(["resource", "remove", AREA, DIRECT_ID, "--operation-id", "brain-conflict-1", "--json"], ({ url }) => {
      if (url.pathname.endsWith("/apply")) {
        return Response.json({
          error: "The catalog changed.",
          code: "catalog-revision-changed",
          operationId: "brain-conflict-1",
          projection: projection(),
        }, { status: 409 });
      }
      return Response.json({ error: "unexpected" }, { status: 404 });
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error);
  assert.equal(caught.message, "The catalog changed.");
  assert.equal(caught.status, 409);
  assert.equal(caught.code, "catalog-revision-changed");
  assert.equal(caught.operationId, "brain-conflict-1");
  assert.equal(caught.payload.projection.state, "current");
});

test("a lost mutation response names the exact body operation ID for a safe retry", async () => {
  await assert.rejects(
    runFixture(["resource", "remove", AREA, DIRECT_ID, "--operation-id", "brain-lost-1"], ({ url }) => {
      if (url.pathname.endsWith("/apply")) throw new TypeError("fetch failed");
      return Response.json({ error: "unexpected" }, { status: 404 });
    }),
    /operation may have completed.*Operation ID: brain-lost-1/,
  );
});
