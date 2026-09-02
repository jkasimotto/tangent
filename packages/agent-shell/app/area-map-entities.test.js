import test from "node:test";
import assert from "node:assert/strict";
import {
  mapEntityLocator,
  resolveMapEntity,
  resourceLocatorKey,
  runMapEntityAction,
  selectedMapEntityElement,
} from "./public/area-map-entities.js";

const owner = "otto/tangent";
const id = "0198e8c5-2be6-7d6a-a142-f0903a13a23b";
const source = { owner, sourceId: "resource-block" };
const tangent = { kind: "resource", ref: id };

/** Builds one catalog-backed resource resolution. */
function current(value = {}) {
  return {
    state: "current",
    value: {
      locator: { owner, id }, label: "Map entities", representation: { state: "current", value: "on-map" }, origin: null, warnings: [],
      target: { kind: "worktree", path: "/Users/julianotto/Projects/otto-tangent-map-entities" },
      local: { state: "current", value: { state: "available", checkout: { kind: "branch", head: "abc", branchRef: "refs/heads/map-entities-first-class" }, repositoryPath: "/Users/julianotto/Projects/tangent" }, checkedAt: "2026-09-02T00:00:00Z" },
      link: null,
      ...value,
    },
  };
}

test("a resource locator is the source owner plus the safe opaque association ID", () => {
  assert.deepEqual(mapEntityLocator(source, tangent), { owner, id });
  assert.equal(resourceLocatorKey({ owner, id }), `${owner}\u0000${id}`);
  assert.notEqual(resourceLocatorKey({ owner: "otto/other", id }), resourceLocatorKey({ owner, id }));
  assert.equal(mapEntityLocator(source, { kind: "resource", ref: "../design.md" }), null);
});

test("semantic actions require exactly one total selected Map element", () => {
  const block = { id: "block", type: "rectangle", isDeleted: false, customData: { tangent: { kind: "resource", ref: id } } };
  const ink = { id: "ink", type: "freedraw", isDeleted: false };
  const label = { id: "label", type: "text", isDeleted: false, containerId: "block" };
  assert.equal(selectedMapEntityElement([block, ink, label], { block: true }), block);
  assert.equal(selectedMapEntityElement([block, ink, label], new Set(["block", "ink"])), null);
  assert.equal(selectedMapEntityElement([block, ink, label], ["block", "label"]), null);
  assert.equal(selectedMapEntityElement([block, ink, label], ["ink"]), null);
  assert.equal(selectedMapEntityElement([{ ...block, isDeleted: true }], ["block"]), null);
});

test("a current Worktree resolves exact display, accessible, search, and copy facts without mutation", () => {
  const resolution = current();
  const before = structuredClone(resolution);
  const resolved = resolveMapEntity({ source, tangent, resource: resolution });
  assert.deepEqual(resolved.source, source);
  assert.deepEqual(resolved.reference, { kind: "resource", resource: { owner, id } });
  assert.deepEqual(resolved.display, {
    kindLabel: "Worktree", label: "Map entities", targetClue: "map-entities-first-class", stateText: [], externalTreatment: null, actionLabel: "Copy path",
  });
  assert.deepEqual(resolved.primaryAction, { kind: "copy-path", resource: { owner, id }, path: "/Users/julianotto/Projects/otto-tangent-map-entities" });
  assert.equal(resolved.readAction, null, "local `o` has no semantic action");
  assert.match(resolved.accessibleName, /Worktree: Map entities\. Current\. Area otto\/tangent\. Target \/Users\/julianotto\/Projects\/otto-tangent-map-entities/);
  assert.match(resolved.searchText, /map-entities-first-class/);
  assert.match(resolved.searchText, /otto-tangent-map-entities/);
  assert.deepEqual(resolution, before, "resolution is a pure projection");
});

test("the same local ID in another source owner never borrows catalog authority", () => {
  const otherSource = { owner: "otto/other", sourceId: "other-block" };
  const resolved = resolveMapEntity({ source: otherSource, tangent, resource: current() });
  assert.equal(resolved.sourceState, "unresolved");
  assert.equal(resolved.primaryAction, null);
  assert.deepEqual(resolved.reference.resource, { owner: "otto/other", id });
  assert.match(resolved.accessibleName, /unresolved.*Area otto\/other.*Target unavailable/i);
});

test("gone resources keep only validated last-known actions and unresolved resources stay inert", () => {
  const local = resolveMapEntity({ source, tangent, resource: {
    state: "gone", value: { locator: { owner, id }, reason: "removed", representation: "on-map", warnings: [], lastKnown: { label: "Old checkout", target: { kind: "repository", path: "/work/exact repo" } } },
  } });
  assert.equal(local.sourceState, "gone");
  assert.equal(local.display.actionLabel, "Copy last known path");
  assert.deepEqual(local.primaryAction, { kind: "copy-path", resource: { owner, id }, path: "/work/exact repo" });
  assert.match(local.accessibleName, /gone.*\/work\/exact repo/i);

  const link = resolveMapEntity({ source, tangent, resource: {
    state: "gone", value: { locator: { owner, id }, reason: "removed", representation: "on-map", warnings: [], lastKnown: { label: "Old review", target: { kind: "link", url: "https://github.com/openai/example/pull/42?view=exact#discussion" } } },
  } });
  assert.equal(link.display.actionLabel, "Open last known link");
  assert.equal(link.primaryAction.url, "https://github.com/openai/example/pull/42?view=exact#discussion");

  const goneWithoutTarget = resolveMapEntity({ source, tangent, resource: {
    state: "gone", value: { locator: { owner, id }, reason: "missing-record", representation: "on-map", warnings: [], lastKnown: null },
  } });
  assert.equal(goneWithoutTarget.display.actionLabel, "Hide Block");
  assert.equal(goneWithoutTarget.primaryAction, null);

  const unresolved = resolveMapEntity({ source, tangent, resource: { state: "unavailable", locator: { owner, id }, error: { code: "catalog-invalid" } } });
  assert.equal(unresolved.sourceState, "unresolved");
  assert.equal(unresolved.primaryAction, null);
  assert.doesNotMatch(unresolved.searchText, /design\.md/, "an opaque ID is not projected as a vault file");
});

test("provider lifecycle words retain explicit success and muted treatment", () => {
  /** Builds one current provider Link resource. */
  const review = (stateLabel, treatment, state = "current") => resolveMapEntity({ source, tangent, resource: current({
    label: "Review 42",
    target: { kind: "link", url: "https://github.com/openai/example/pull/42" },
    local: null,
    link: { kind: "github-pr", owner: "openai", repository: "example", number: 42, lifecycle: state === "last-known"
      ? { state, value: { stateLabel, treatment, providerUpdatedAt: "2026-09-01T00:00:00Z" }, checkedAt: "2026-09-01T00:00:00Z", error: { code: "provider-unavailable" } }
      : { state, value: { stateLabel, treatment, providerUpdatedAt: "2026-09-02T00:00:00Z" }, checkedAt: "2026-09-02T00:00:00Z" } },
  }) });
  const merged = review("Merged", "success");
  assert.equal(merged.display.kindLabel, "GitHub PR");
  assert.deepEqual(merged.display.stateText, ["Merged"]);
  assert.equal(merged.display.externalTreatment, "success");
  assert.equal(merged.display.actionLabel, "Open PR");
  assert.equal(merged.primaryAction.url, "https://github.com/openai/example/pull/42");

  const closed = review("Closed", "muted", "last-known");
  assert.deepEqual(closed.display.stateText, ["Closed", "Last known"]);
  assert.equal(closed.display.externalTreatment, "muted");
});

test("generic Links retain composed source ownership and their exact URL action", () => {
  const url = "https://example.com/exact?case=Mixed#Here";
  const resolved = resolveMapEntity({ source, tangent: { kind: "link", ref: url } });
  assert.equal(resolved.source.owner, owner);
  assert.deepEqual(resolved.reference, { kind: "link", url });
  assert.deepEqual(resolved.primaryAction, { kind: "open-url", resource: null, url, targetLabel: "example.com" });
  assert.equal(resolved.readAction, resolved.primaryAction);
});

test("copy actions write exact bytes and return typed recovery without changing their action", async () => {
  const action = { kind: "copy-path", resource: { owner, id }, path: "/tmp/a path/ß" };
  const before = structuredClone(action);
  const writes = [];
  assert.deepEqual(await runMapEntityAction(action, { clipboard: {
    /** Captures exact clipboard bytes. */
    async writeText(value) { writes.push(value); },
  } }), { kind: "done" });
  assert.deepEqual(writes, ["/tmp/a path/ß"]);
  assert.deepEqual(action, before);
  assert.deepEqual(await runMapEntityAction(action, { clipboard: {
    /** Simulates a browser clipboard denial. */
    async writeText() { throw new Error("denied"); },
  } }), {
    kind: "clipboard-blocked", copy: { kind: "path", value: "/tmp/a path/ß" },
  });
  assert.deepEqual(await runMapEntityAction({ kind: "copy-url", resource: null, url: "https://example.com/a?x=1#y", targetLabel: "example.com" }, { clipboard: null }), {
    kind: "clipboard-blocked", copy: { kind: "url", value: "https://example.com/a?x=1#y" },
  });
});

test("open actions synchronously claim a blank tab, sever opener, then replace its location", async () => {
  const calls = [];
  const handle = {
    opener: { unsafe: true },
    location: {
      /** Records exact navigation and the already-cleared opener. */
      replace(value) { calls.push(["replace", value, handle.opener]); },
    },
    /** Records unexpected cleanup of a successful tab. */
    close() { calls.push(["close"]); },
  };
  let activation = true;
  const pending = runMapEntityAction({ kind: "open-url", resource: null, url: "https://example.com/exact", targetLabel: "example.com" }, {
    /** Captures the synchronous window claim. */
    openWindow(...args) { calls.push(["open", ...args, activation]); return handle; },
  });
  activation = false;
  assert.deepEqual(await pending, { kind: "done" });
  assert.deepEqual(calls, [
    ["open", "", "_blank", true],
    ["replace", "https://example.com/exact", null],
  ]);
});

test("blocked and failed navigation return the same typed recovery and close a claimed blank tab", async () => {
  const action = { kind: "open-url", resource: null, url: "https://example.com/exact", targetLabel: "example.com" };
  assert.deepEqual(await runMapEntityAction(action, {
    /** Simulates a popup blocker returning no handle. */
    openWindow: () => null,
  }), {
    kind: "popup-blocked", url: action.url, targetLabel: "example.com",
  });
  let closed = 0;
  const result = await runMapEntityAction(action, {
    /** Returns a claimed tab whose navigation fails. */
    openWindow: () => ({
      opener: {},
      location: {
        /** Simulates a browser navigation exception. */
        replace() { throw new Error("navigation failed"); },
      },
      /** Records cleanup of the unusable blank tab. */
      close() { closed += 1; },
    }),
  });
  assert.deepEqual(result, { kind: "popup-blocked", url: action.url, targetLabel: "example.com" });
  assert.equal(closed, 1);
  assert.deepEqual(await runMapEntityAction({ kind: "open-document", file: "otto/a.md", subpath: null, mode: "open" }), { kind: "unavailable" });
});
