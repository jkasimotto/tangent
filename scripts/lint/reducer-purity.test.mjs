import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const LINT = fileURLToPath(new URL("./reducer-purity.mjs", import.meta.url));
const STORE_DIR = "packages/agent-shell/app/map/surfaces/resources";

const PURE_STORE = `type State = { readonly items: readonly string[] };
type Action = { readonly type: "add"; readonly item: string; readonly at: number };
/** Adds one item without mutating the previous state. */
export function reduce(state: State, action: Action): State {
  const items = [...state.items, action.item].toSorted();
  return { ...state, items };
}
`;

const IMPURE_STORE = `type State = { readonly items: string[]; readonly stamp: number };
/** Reads the clock and mutates in place, which a reducer must never do. */
export function reduce(state: State): State {
  state.items.push("late");
  return { ...state, stamp: Date.now() };
}
`;

/** Creates a fresh fake repository root and returns its absolute path. */
function makeRoot() {
  return mkdtempSync(path.join(os.tmpdir(), "reducer-purity-"));
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

test("a pure store passes", () => {
  const root = makeRoot();
  const file = writeFixture(root, `${STORE_DIR}/resources-store.ts`, PURE_STORE);
  const result = runLint(root, [file]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /reducer-purity lint passed/);
});

test("a store that mutates an array and reads the clock fails on both lines", () => {
  const root = makeRoot();
  const file = writeFixture(root, `${STORE_DIR}/resources-store.ts`, IMPURE_STORE);
  const result = runLint(root, [file]);
  assert.equal(result.status, 1);
  assert.match(result.output, /resources-store\.ts:4  \.push\(\) mutates its receiver in place/);
  assert.match(result.output, /resources-store\.ts:5  Date\.now reads the clock or randomness/);
});

test("timers, fetch, new Date and window globals are each reported", () => {
  const root = makeRoot();
  const source = `/** Every banned effect on its own line. */
export function reduce(state: { readonly n: number }) {
  fetch("/x");
  setTimeout(() => undefined, 0);
  window.setInterval(() => undefined, 0);
  requestAnimationFrame(() => undefined);
  const stamp = new Date();
  const seed = Math.random() + performance.now();
  return { ...state, stamp, seed };
}
`;
  const file = writeFixture(root, `${STORE_DIR}/announce-store.ts`, source);
  const result = runLint(root, [file]);
  assert.equal(result.status, 1);
  for (const line of [3, 4, 5, 6, 7, 8]) {
    assert.match(result.output, new RegExp(`announce-store\\.ts:${line}  `), `line ${line} in ${result.output}`);
  }
  assert.match(result.output, /7 violation\(s\)/);
});

test("a file outside the strict scope or not named *-store.ts is ignored", () => {
  const root = makeRoot();
  const effects = writeFixture(root, `${STORE_DIR}/resources-effects.ts`, IMPURE_STORE);
  const elsewhere = writeFixture(root, "packages/agent-shell/app/legacy-store.ts", IMPURE_STORE);
  const result = runLint(root, [effects, elsewhere]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /0 store module\(s\) checked/);
});
