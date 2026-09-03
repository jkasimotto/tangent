import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const LINT = fileURLToPath(new URL("./no-unnamed-number.mjs", import.meta.url));
const MAP = "packages/agent-shell/app/map";

/** Creates a fresh temporary repository root for one test. */
function makeRoot() {
  return mkdtempSync(path.join(os.tmpdir(), "no-unnamed-number-"));
}

/** Writes one fixture at its owner path under the temporary root and returns that path. */
function writeFixture(root, repoPath, source) {
  const absolutePath = path.join(root, repoPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, source);
  return repoPath;
}

/** Runs the lint with --root and explicit paths, returning the exit status and both output streams. */
function runLint(root, paths) {
  try {
    const stdout = execFileSync(process.execPath, [LINT, "--root", root, ...paths], { encoding: "utf8", stdio: "pipe" });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return { status: error.status, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

test("accepts 0, 1, -1, the scaling 2, and numbers inside strings and comments", () => {
  const root = makeRoot();
  const fixture = writeFixture(root, `${MAP}/input/press-meaning.ts`, [
    "// The paste window is 1_000 ms, named in layout-tokens, never retyped as 1000 here.",
    "/** Reads the 16 px nudge from the tokens. */",
    'const label = "16 px";',
    "const first = 0;",
    "const one = 1;",
    "const back = -1;",
    "const half = one / 2;",
    "const doubled = one * 2;",
    "let scaled = one;",
    "scaled *= 2;",
    "scaled /= 2;",
    "export { label, first, one, back, half, doubled, scaled };",
    ""
  ].join("\n"));

  const result = runLint(root, [fixture]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no-unnamed-number lint passed/);
});

test("rejects an unnamed literal with its path, line and text", () => {
  const root = makeRoot();
  const fixture = writeFixture(root, `${MAP}/input/nudge.ts`, [
    "const zero = 0;",
    "const half = zero / 2;",
    "const step = 16;",
    "const twoNotScaling = 2 + step;",
    "const minusTwo = -2;",
    "export { half, twoNotScaling, minusTwo };",
    ""
  ].join("\n"));

  const result = runLint(root, [fixture]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`^${MAP}/input/nudge\\.ts:3  const step = 16;$`, "m"));
  assert.match(result.stderr, new RegExp(`^${MAP}/input/nudge\\.ts:4  `, "m"));
  assert.match(result.stderr, new RegExp(`^${MAP}/input/nudge\\.ts:5  `, "m"));
  assert.match(result.stderr, /failed with 3 hit\(s\)/);
});

test("rejects a literal in a JSX attribute but not a string attribute or tabIndex -1", () => {
  const root = makeRoot();
  const fixture = writeFixture(root, `${MAP}/surfaces/find/FindPanel.tsx`, [
    "/** Renders the panel. */",
    'export function FindPanel() { return <div tabIndex={-1} title="3 hits" data-size={3} />; }',
    ""
  ].join("\n"));

  const result = runLint(root, [fixture]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`^${MAP}/surfaces/find/FindPanel\\.tsx:2  `, "m"));
  assert.match(result.stderr, /failed with 1 hit\(s\)/);
});

test("exempts the unit owners, layout-tokens.ts and test files", () => {
  const root = makeRoot();
  const fixtures = [
    writeFixture(root, `${MAP}/units/units.ts`, "export const SIXTEEN = 16;\n"),
    writeFixture(root, `${MAP}/units/scalar-math.ts`, "export const NINETY = 90;\n"),
    writeFixture(root, `${MAP}/layout/layout-tokens.ts`, "export const NARROW = 960;\n"),
    writeFixture(root, `${MAP}/input/nudge.test.ts`, "const expected = 16;\nexport { expected };\n")
  ];

  const result = runLint(root, fixtures);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 file\(s\) checked/);
});

test("lints the whole strict scope when no paths are given", () => {
  const root = makeRoot();
  writeFixture(root, `${MAP}/input/nudge.ts`, "export const step = 16;\n");
  writeFixture(root, `${MAP}/units/units.ts`, "export const SIXTEEN = 16;\n");
  writeFixture(root, "packages/agent-shell/app/browser/old.jsx", "export const old = 16;\n");

  const result = runLint(root, []);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`^${MAP}/input/nudge\\.ts:1  `, "m"));
  assert.doesNotMatch(result.stderr, /old\.jsx/);
  assert.match(result.stderr, /failed with 1 hit\(s\)/);
});
