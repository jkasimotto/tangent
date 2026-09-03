import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { MapKindsCatalog } from "../../kernel/kernel-types.ts";
import { kindsProblemLines } from "./kinds-lines.ts";

/** A catalog with the given problems and nothing else. */
function catalogWith(problems: MapKindsCatalog["problems"]): MapKindsCatalog {
  return { revision: "r", kinds: [], icons: {}, problems };
}

test("one line per problem, in the words the world suite expects", () => {
  const lines = kindsProblemLines(catalogWith([{ scope: "definition", name: "worktree", message: "icon worktre not found" }]));
  assert.deepEqual(lines, [{ key: "definition:worktree", text: "Map kinds: worktree: icon worktre not found" }]);
});

test("a problem with no name prints only its message, keyed by its position", () => {
  const lines = kindsProblemLines(catalogWith([
    { scope: "icon", name: null, message: "the image did not decode" },
    { scope: "icon", name: "pull-request", message: "the browser gave no 2d canvas" },
  ]));
  assert.deepEqual(lines.map((line) => line.text), ["Map kinds: the image did not decode", "Map kinds: pull-request: the browser gave no 2d canvas"]);
  assert.deepEqual(lines.map((line) => line.key), ["icon:0", "icon:pull-request"]);
});

test("no catalog and no problems both give no lines", () => {
  assert.deepEqual(kindsProblemLines(null), []);
  assert.deepEqual(kindsProblemLines(catalogWith([])), []);
});
