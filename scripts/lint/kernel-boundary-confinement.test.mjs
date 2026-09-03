import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { makeFixtureRoot, runLint, writeFixture } from "./lint-test-support.mjs";

const SCRIPT = fileURLToPath(new URL("./kernel-boundary-confinement.mjs", import.meta.url));
const BOUNDARY = "packages/agent-shell/app/map/kernel/kernel-boundary.ts";
const CONSUMER = "packages/agent-shell/app/map/input/hit-test.ts";
const ROGUE_IMPORTER = "packages/agent-shell/app/map/canvas/projection.ts";

test("kernel-boundary-confinement accepts public/ imports in the kernel and typed imports elsewhere", () => {
  const root = makeFixtureRoot("kernel-boundary-confinement-pass");
  const boundary = writeFixture(root, BOUNDARY, [
    "import { composeWorld } from \"../../public/area-map-world-core.js\";",
    "export { composeWorld };",
    ""
  ].join("\n"));
  const consumer = writeFixture(root, CONSUMER, [
    "import { composeWorld } from \"../kernel/kernel-boundary.ts\";",
    "export const compose = composeWorld;",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [boundary, consumer]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /kernel-boundary-confinement lint passed/);
});

test("kernel-boundary-confinement rejects static, re-exported and dynamic public/ imports outside the kernel", () => {
  const root = makeFixtureRoot("kernel-boundary-confinement-fail");
  const importer = writeFixture(root, ROGUE_IMPORTER, [
    "import { projectCanvas } from \"../../public/area-map-world-controller.js\";",
    "export * from \"../../public/area-board-core.js\";",
    "/** Loads the kernel lazily and untyped. */",
    "export async function load(): Promise<unknown> {",
    "  return import(\"../../public/area-map-entities.js\");",
    "}",
    "export const project = projectCanvas;",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [importer]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`^${ROGUE_IMPORTER}:1  `, "m"));
  assert.match(result.stderr, new RegExp(`^${ROGUE_IMPORTER}:2  `, "m"));
  assert.match(result.stderr, new RegExp(`^${ROGUE_IMPORTER}:5  `, "m"));
  assert.match(result.stderr, /kernel-boundary-confinement lint failed with 3 hit/);
});
