import { strict as assert } from "node:assert";
import { test } from "node:test";
import { count, index } from "./units/units.ts";
import * as copy from "./copy.ts";

const EM_DASH = "—";
const RUNS = 2000;

/** Collects every string reachable from one exported value, walking objects and arrays. */
function collectStrings(value: unknown, into: string[]): string[] {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, into);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collectStrings(item, into);
  return into;
}

/** A small seeded generator so a failing run can be replayed by seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  /** Returns the next number in [0, 1) (mulberry32). */
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draws one kebab-case code such as "resource-xq-failed" from a seed. A code has at least two segments. */
function randomKind(next: () => number): string {
  const words = ["resource", "catalog", "zz", "operation", "qx", "tree", "world", "link", "path", "unknown"];
  const length = 2 + Math.floor(next() * 3);
  const parts: string[] = [];
  for (let position = 0; position < length; position += 1) {
    const roll = next();
    parts.push(roll < 0.5 ? words[Math.floor(next() * words.length)] ?? "x" : `k${Math.floor(next() * 1000)}`);
  }
  return parts.join("-");
}

test("the strings the browser suites match on are byte-identical", () => {
  assert.equal(copy.PICKER.name, "Place a Tangent block");
  assert.equal(copy.HELP.title, "Map keys");
  assert.equal(copy.RESOURCES_PANEL.title("Otto"), "Map resources · Otto");
  assert.equal(copy.FIND.name, "Find on the map");
  assert.equal(copy.RESOURCE_DETAILS.back, "← Back to resources");
  assert.equal(copy.OUTLINE.name, "Area hierarchy");
  assert.equal(copy.SAVE.statusName, "Map save status");
  assert.equal(copy.TOOLBAR.keysTitle, "Map keys (?)");
  assert.equal(copy.KINDS.problem("worktree", "icon worktre not found"), "Map kinds: worktree: icon worktre not found");
  assert.equal(copy.RECOVERY_ANNOUNCEMENTS.localDraftKept, "Local draft kept. Retry or reload saved.");
  assert.equal(copy.RESOURCE_ANNOUNCEMENTS.placed("Feature checkout"), "Placed Feature checkout on the Map.");
  assert.equal(copy.PLACEMENT.name("Feature checkout"), "Place Feature checkout on the Map");
  assert.equal(copy.PICKER.placeIn("otto"), "Place in otto");
  assert.equal(copy.SUGGESTIONS.reviewIn("Otto"), "Review in Otto");
  assert.equal(copy.SUGGESTIONS.reviewName("Shared staging", "otto"), "Review Shared staging in otto");
  assert.equal(copy.AREA_LABELS.runtimeActionName("problems", "Standards", copy.AREA_LABELS.problems(count(2))), "Open Problems for Standards: 2 problems");
  assert.equal(copy.AREA_LABELS.runtimeActionName("for-you", "Standards", copy.AREA_LABELS.forYou(count(1))), "Open For you for Standards: 1 for you");
});

test("parameterised sentences read as the old component printed them", () => {
  assert.equal(copy.FIND.position(index(2), count(12)), "3 of 12");
  assert.equal(copy.FIND_ANNOUNCEMENTS.matches(count(1), "Otto"), "1 match, Otto in view");
  assert.equal(copy.FIND_ANNOUNCEMENTS.step(index(0), count(3), "Otto"), "1 of 3, Otto in view");
  assert.equal(copy.OUTLINE.areaRow("Otto", index(0), "folded", count(4)), "Otto · depth 1 · folded · 4 blocks");
  assert.equal(copy.OUTLINE.blockRow("Main checkout", ["Current"], "Copy path"), " · Main checkout · Current · Copy path");
  assert.equal(copy.AREA_LABELS.accessibleName({ name: "Otto", parent: "map root", depth: index(0), fold: "unfolded", shardState: "loaded", blocks: count(1), runtimeWords: ["Ready"] }), "Otto, child of map root, depth 1, unfolded, loaded, 1 block, Ready");
  assert.equal(copy.RESOURCE_ROW.placementLabel("on-map", false, "otto"), "Show in otto");
  assert.equal(copy.RESOURCE_ROW.placementLabel("never-placed", true, "otto"), "Place on Map");
  assert.equal(copy.RESOURCE_ROW.name({ accessibleName: "Main checkout", provenance: "Direct", representationLabel: "On Map", launchOwner: "otto", warnings: [] }), "Main checkout. Direct. On Map. Workers start here by default from otto.");
  assert.equal(copy.RESOURCE_RECOVERY.message("open-url", "x", "staging"), "Could not open staging.");
  assert.equal(copy.RESOURCE_ANNOUNCEMENTS.legacyImportedCount(count(2)), "2 legacy resources imported.");
  assert.equal(copy.keyedTextToString(copy.FIND.keys), "↓ next · ↑ previous · ↵ keep · Esc cancel");
  assert.equal(copy.keyedTextToString(copy.PICKER.keys(false)), "Tab whole vault · Enter place · ⇧Enter place another · Esc close");
  assert.equal(copy.keyedTextToString(copy.HELP.selected), "With a block selected: Enter opens · X hides.");
});

test("no exported sentence contains an em dash", () => {
  const strings = collectStrings(copy, []);
  assert.ok(strings.length > 100);
  for (const value of strings) assert.ok(!value.includes(EM_DASH), `em dash in ${JSON.stringify(value)}`);
});

test("copyForFailure gives every known kind words that never print the kind", () => {
  for (const kind of copy.knownFailureKinds()) {
    const words = copy.copyForFailure(kind);
    assert.ok(words.headline.length && words.nextStep.length, `${kind} has empty words`);
    assert.ok(!words.headline.includes(kind) && !words.nextStep.includes(kind), `${kind} is printed`);
    assert.ok(!words.headline.includes(EM_DASH) && !words.nextStep.includes(EM_DASH));
  }
  assert.equal(copy.copyForFailure("duplicate-resource-target").headline, "That exact target already belongs to this Area.");
  assert.equal(copy.copyForFailure("inherited-resource-read-only").nextStep, "Open that Area's resources to change it.");
});

test("copyForFailure falls back to the operation the kind names, then to the Map", () => {
  assert.equal(copy.copyForFailure("resource-something-new").headline, "The resource change was not saved.");
  assert.equal(copy.copyForFailure("catalog-exploded").headline, "Map resources did not load.");
  assert.equal(copy.copyForFailure("tree-whatever").nextStep, "Reload saved or keep mine.");
  assert.deepEqual(copy.copyForFailure(""), copy.copyForFailure("nothing-known"));
  assert.equal(copy.copyForFailure("nothing-known").headline, "The Map could not finish that change.");
});

test("copyForFailure never prints an arbitrary kind and is total", () => {
  for (let seed = 1; seed <= RUNS; seed += 1) {
    const kind = randomKind(random(seed));
    const words = copy.copyForFailure(kind);
    assert.equal(typeof words.headline, "string", `seed ${seed}`);
    assert.ok(words.headline.length && words.nextStep.length, `seed ${seed} gave empty words for ${kind}`);
    assert.ok(!words.headline.includes(kind) && !words.nextStep.includes(kind), `seed ${seed} printed ${kind}`);
    assert.deepEqual(copy.copyForFailure(kind), words, `seed ${seed} is not deterministic`);
  }
});
