import assert from "node:assert/strict";
import test from "node:test";
import { doneCascade } from "./outcome-cascade.mjs";

/** Builds the minimal indexed-outcome shape used by cascade tests. */
function outcome(file, slug, breakdown = []) {
  return { file, slug, breakdown };
}

test("done cascade walks all descendants across home nodes", () => {
  const root = outcome("otto/tangent/outcome-root.md", "root", ["child", "sibling"]);
  const child = outcome("otto/elsewhere/outcome-child.md", "child", ["grandchild"]);
  const grandchild = outcome("otto/third/outcome-grandchild.md", "grandchild");
  const sibling = outcome("otto/tangent/outcome-sibling.md", "sibling");
  const unrelated = outcome("otto/tangent/outcome-unrelated.md", "unrelated");
  const indexed = new Map([root, child, grandchild, sibling, unrelated].map((item) => [item.file, item]));

  assert.deepEqual(doneCascade(root.file, indexed).map((item) => item.file), [
    root.file,
    child.file,
    grandchild.file,
    sibling.file,
  ]);
});

test("done cascade tolerates missing links and cycles", () => {
  const root = outcome("node/outcome-root.md", "root", ["child", "missing"]);
  const child = outcome("node/outcome-child.md", "child", ["root"]);
  const indexed = new Map([root, child].map((item) => [item.file, item]));

  assert.deepEqual(doneCascade(root.file, indexed).map((item) => item.slug), ["root", "child"]);
  assert.deepEqual(doneCascade("node/outcome-absent.md", indexed), []);
});
