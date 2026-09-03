import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { MapEntityFacts, ResourcePanelRow, VaultDocument } from "../../kernel/kernel-types.ts";
import { areaKey, resourceId, shardOwner, sourceId } from "../../units/ids.ts";
import { pickerDocuments, pickerEntries, pickerEntryGroup, pickerEntryId, resourceEntry } from "./picker-choices.ts";
import type { PickerEntry, ResourceChoiceFacts } from "./picker-choices.ts";

const OTTO = areaKey("otto");

const DOCUMENTS: VaultDocument[] = [
  { file: "otto/goal-ship.md", area: OTTO, kind: "goal", title: "Ship the map", status: "active", goal: true },
  { file: "otto/design.md", area: OTTO, kind: "document", title: "Map design" },
  { file: "neara/goal-clear.md", area: areaKey("neara"), kind: "goal", title: "Clear the queue", goal: true },
];

/** One current Resource row with resolved facts. */
function worktreeFacts(): ResourceChoiceFacts {
  const locator = { owner: shardOwner("otto"), id: resourceId("wt-a") };
  const row: ResourcePanelRow = { viewedFrom: OTTO, relation: { kind: "own" }, launchMatch: { state: "current", value: false }, entity: { locator, label: "Checkout A", target: { kind: "path", path: "/tmp/wt-a" }, representation: "never-placed" } };
  const facts: MapEntityFacts = {
    source: { owner: locator.owner, sourceId: sourceId(locator.id) },
    reference: { kind: "resource", resource: locator },
    kindId: "worktree", states: ["clean"],
    display: { kindLabel: "Worktree", label: "Checkout A", targetClue: "/tmp/wt-a", stateText: ["Clean"], externalTreatment: null, actionLabel: null },
    accessibleName: "Worktree: Checkout A. Clean", searchText: "worktree checkout a", primaryAction: null, readAction: null, sourceState: "current",
  };
  return { row, facts, representation: "never-placed" };
}

test("pickerDocuments merges search results over known documents, one per file, search winning", () => {
  const merged = pickerDocuments([{ file: "otto/design.md", kind: "document", title: "Newer title" }], DOCUMENTS);
  assert.equal(merged.length, DOCUMENTS.length);
  assert.equal(merged.find((item) => item.file === "otto/design.md")?.title, "Newer title");
});

test("resourceEntry carries the label, the state words with the Map state, and the full accessible name", () => {
  const entry = resourceEntry(worktreeFacts());
  assert.deepEqual([entry.kind, entry.ref, entry.owner, entry.title], ["resource", "wt-a", "otto", "Checkout A"]);
  assert.equal(entry.status, "Clean · Never placed");
  assert.equal(entry.accessibleName, "Worktree: Checkout A. Clean. Never placed.");
  assert.notEqual(entry.resourceRow, undefined);
});

test("contextual entries list the target's Resources before its Goals and Documents, filtered by the typed text", () => {
  const all = pickerEntries({ query: "", wide: false, targetArea: OTTO, documents: DOCUMENTS, resources: [worktreeFacts()] });
  assert.equal(all[0]?.kind, "resource");
  assert.ok(all.some((entry) => entry.kind === "goal" && entry.title === "Ship the map"));
  assert.ok(!all.some((entry) => entry.title === "Clear the queue"), "another Area's Goal is not contextual");
  const filtered = pickerEntries({ query: "design", wide: false, targetArea: OTTO, documents: DOCUMENTS, resources: [worktreeFacts()] });
  assert.deepEqual(filtered.map((entry) => entry.title), ["Map design"]);
});

test("wide entries search the whole vault", () => {
  const wide = pickerEntries({ query: "clear", wide: true, targetArea: OTTO, documents: DOCUMENTS, resources: [] });
  assert.deepEqual(wide.map((entry) => entry.title), ["Clear the queue"]);
});

test("a typed reference is offered first when nothing listed names it", () => {
  const entries = pickerEntries({ query: "https://example.com/spec", wide: false, targetArea: OTTO, documents: DOCUMENTS, resources: [] });
  assert.equal(entries[0]?.kind, "link");
  assert.equal(entries[0]?.ref, "https://example.com/spec");
  const known = pickerEntries({ query: "otto/goal-ship.md", wide: false, targetArea: OTTO, documents: DOCUMENTS, resources: [] });
  assert.equal(known.filter((entry) => entry.ref === "otto/goal-ship.md").length, 1);
});

test("entry ids are stable and groups name the Resources of the target then the other Blocks", () => {
  const resource = resourceEntry(worktreeFacts());
  const goal: PickerEntry = { kind: "goal", ref: "otto/goal-ship.md", title: "Ship the map" };
  assert.equal(pickerEntryId(resource), "resource:otto:wt-a");
  assert.equal(pickerEntryId(goal), "goal::otto/goal-ship.md");
  assert.equal(pickerEntryGroup(resource, true, "Otto"), "Resources in Otto");
  assert.equal(pickerEntryGroup(goal, true, "Otto"), "Other Blocks");
  assert.equal(pickerEntryGroup(goal, false, "Otto"), null);
});
