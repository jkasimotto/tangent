import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const RUNNER = path.join(HERE, "run-pool.mjs");
const MAP_FILE = "packages/agent-shell/app/map/ui/x.ts";

const SHEBANG = "#!/usr/bin/env node\n";
const PASSING_LINT = `${SHEBANG}process.stdout.write("alpha lint passed\\n");\n`;
const FAILING_LINT = `${SHEBANG}process.stdout.write("${MAP_FILE}:3  const n: number = 2\\nBrand the number.\\n");\nprocess.exit(1);\n`;
const ROGUE_TEST_LINT = `process.stdout.write("a test file must never run as a lint\\n");\nprocess.exit(1);\n`;
const HELPER_MODULE = `export const SCOPE = "helper";\nprocess.stdout.write("a helper module must never run as a lint\\n");\nprocess.exit(1);\n`;
const DOCSTRING_STUB = `process.exit(0);\n`;

const MAP_SOURCE = [
  "/** Doubles a branded count. */",
  "export function doubleCount(count) {",
  "  return count + count;",
  "}",
  ""
].join("\n");

const LONG_BLOCK = [
  "/** Sums two quantities and logs every operand so a reader can follow the arithmetic. */",
  "export function sumQuantitiesWithLogging(first, second) {",
  "  const firstValue = Number(first);",
  "  const secondValue = Number(second);",
  "  const total = firstValue + secondValue;",
  '  console.log("first", firstValue, "second", secondValue, "total", total);',
  '  if (total > 100) console.log("large total", total);',
  "  return total;",
  "}",
  ""
].join("\n");

/** Writes a file under the fixture root, creating its directories. */
function writeFixture(root, relative, content) {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

/** Creates a fixture root with a docstring stub, the jscpd config, and the given lints and sources. */
function makeRoot(lints, sources) {
  const root = mkdtempSync(path.join(os.tmpdir(), "run-pool-"));
  writeFixture(root, "scripts/lint-function-docstrings.mjs", DOCSTRING_STUB);
  copyFileSync(path.join(REPO_ROOT, ".jscpd.json"), path.join(root, ".jscpd.json"));
  for (const [name, source] of Object.entries(lints)) writeFixture(root, `scripts/lint/${name}`, source);
  for (const [relative, source] of Object.entries(sources)) writeFixture(root, relative, source);
  return root;
}

/** Runs the pool against a fixture root and returns its exit status and captured streams. */
function runPool(root, args) {
  try {
    const stdout = execFileSync(process.execPath, [RUNNER, "--root", root, ...args], { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return { status: error.status, stdout: String(error.stdout), stderr: String(error.stderr) };
  }
}

test("a passing lint passes; a test file or a helper module beside it is never run as a lint", () => {
  const root = makeRoot({ "alpha.mjs": PASSING_LINT, "gamma.test.mjs": ROGUE_TEST_LINT, "lint-scope.mjs": HELPER_MODULE }, { [MAP_FILE]: MAP_SOURCE });
  const result = runPool(root, [MAP_FILE]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /alpha lint passed/);
  assert.doesNotMatch(result.stdout, /a test file must never run/);
  assert.doesNotMatch(result.stdout, /a helper module must never run/);
  assert.match(result.stdout, /lint pool passed: 3 checks/);
});

test("a failing lint fails the pool with its line reported", () => {
  const root = makeRoot({ "alpha.mjs": PASSING_LINT, "beta.mjs": FAILING_LINT }, { [MAP_FILE]: MAP_SOURCE });
  const result = runPool(root, [MAP_FILE]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`${MAP_FILE.replace(/\//g, "\\/")}:3  const n: number = 2`));
  assert.match(result.stderr, /failed: beta/);
});

test("duplicate code in the strict scope fails the pool through jscpd", () => {
  const root = makeRoot({ "alpha.mjs": PASSING_LINT }, {
    "packages/agent-shell/app/map/input/one.ts": LONG_BLOCK,
    "packages/agent-shell/app/map/input/two.ts": LONG_BLOCK
  });
  const result = runPool(root, []);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Clone found/);
  assert.match(result.stderr, /failed: jscpd/);
});

test("a test file may duplicate production code without failing jscpd", () => {
  const root = makeRoot({ "alpha.mjs": PASSING_LINT }, {
    "packages/agent-shell/app/map/input/one.ts": LONG_BLOCK,
    "packages/agent-shell/app/map/input/one.test.ts": LONG_BLOCK
  });
  const result = runPool(root, []);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
