import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const LINT = fileURLToPath(new URL("./wire-guard-confinement.mjs", import.meta.url));
const REGISTRY = "packages/agent-shell/app/public/area-map-wire-values.js";
const MAP_FILE = "packages/agent-shell/app/map/kernel/kernel-boundary.ts";

const GUARD_SOURCE = `export const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
/** Accepts a minted revision id. */
export const acceptsRevision = (value) => OPAQUE_ID.test(value);
`;

const NON_GUARD_SOURCE = `/** Regex literals that share the prefix but are not identifier guards. */
export function strip(value) {
  const key = /^[hjkl]$/.test(value);
  const unquoted = value.replace(/^["'](.*)["']$/, "$1");
  const trimmed = value.replace(/^[/\\\\]+/, "");
  const rule = /^[-─━]+$/.test(value);
  return { key, unquoted, trimmed, rule };
}
`;

/** Creates a fresh fake repository root and returns its absolute path. */
function makeRoot() {
  return mkdtempSync(path.join(os.tmpdir(), "wire-guard-"));
}

/** Writes one fixture at a repo-relative path under the root and returns its absolute path. */
function writeFixture(root, repoPath, source) {
  const file = path.join(root, repoPath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source);
  return file;
}

/** Runs the lint against explicit paths and returns its exit status with combined output. */
function runLint(root, paths) {
  try {
    const stdout = execFileSync(process.execPath, [LINT, "--root", root, ...paths], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, output: stdout };
  } catch (error) {
    return { status: error.status, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

test("the wire registry may hold identifier guards", () => {
  const root = makeRoot();
  const file = writeFixture(root, REGISTRY, GUARD_SOURCE);
  const result = runLint(root, [file]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /wire-guard-confinement lint passed/);
});

test("an identifier guard in the Map fails on its line", () => {
  const root = makeRoot();
  const file = writeFixture(root, MAP_FILE, GUARD_SOURCE);
  const result = runLint(root, [file]);
  assert.equal(result.status, 1);
  assert.match(result.output, /kernel-boundary\.ts:1  export const OPAQUE_ID = /);
  assert.match(result.output, /Register the guard beside its minter/);
});

test("guards spelled with \\w, UUID shapes and grouped paths are all id-shaped", () => {
  const root = makeRoot();
  const source = `const a = /^\\w+$/;
const b = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const c = /^[A-Za-z0-9._-]+(?:\\/[A-Za-z0-9._-]+)*$/;
`;
  const file = writeFixture(root, "packages/agent-shell/app/fresh-route.mjs", source);
  const result = runLint(root, [file]);
  assert.equal(result.status, 1);
  assert.match(result.output, /3 violation\(s\)/);
});

test("single-key guards, rewrites, unanchored strips and box-drawing rules are not guards", () => {
  const root = makeRoot();
  const file = writeFixture(root, MAP_FILE, NON_GUARD_SOURCE);
  const result = runLint(root, [file]);
  assert.equal(result.status, 0, result.output);
});

test("test files and files outside the app are ignored", () => {
  const root = makeRoot();
  const testFile = writeFixture(root, "packages/agent-shell/app/map/kernel/kernel-boundary.test.ts", GUARD_SOURCE);
  const outside = writeFixture(root, "packages/agent-shell/src/cli.ts", GUARD_SOURCE);
  const result = runLint(root, [testFile, outside]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /0 file\(s\) checked/);
});
