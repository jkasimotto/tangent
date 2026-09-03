import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const LINT = fileURLToPath(new URL("./module-size.mjs", import.meta.url));
const OWNER_DIRECTORY = "packages/agent-shell/app/map/surfaces";
const WIDER_DIRECTORY = "packages/agent-shell/app/public";

/** Writes fixtures at repo-relative paths under a fresh temporary root and returns that root. */
function fixtureRoot(files) {
  const root = mkdtempSync(path.join(tmpdir(), "module-size-"));
  for (const [repoPath, source] of Object.entries(files)) {
    const absolutePath = path.join(root, repoPath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, source);
  }
  return root;
}

/** Runs the lint against a root with explicit paths and returns its exit status and output. */
function runLint(root, paths) {
  try {
    const stdout = execFileSync(process.execPath, [LINT, "--root", root, ...paths], { encoding: "utf8", stdio: "pipe" });
    return { status: 0, output: stdout };
  } catch (error) {
    return { status: error.status, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

/** Builds a module of exactly the given number of lines, ending in a newline. */
function moduleOfLines(lines) {
  return Array.from({ length: lines }, (_, index) => `export const value${index} = ${index};`).join("\n") + "\n";
}

test("a module of exactly 400 lines passes", () => {
  const repoPath = `${OWNER_DIRECTORY}/fits-store.ts`;
  const root = fixtureRoot({ [repoPath]: moduleOfLines(400) });
  const result = runLint(root, [repoPath]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /module-size lint passed/);
});

test("a module of 401 lines fails at line 401", () => {
  const repoPath = `${OWNER_DIRECTORY}/too-long-store.ts`;
  const root = fixtureRoot({ [repoPath]: moduleOfLines(401) });
  const result = runLint(root, [repoPath]);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, new RegExp(`^${repoPath}:401  module is 401 lines \\(max 400\\)$`, "m"));
});

test("an oversized .js module in the wider scope fails when it is not grandfathered", () => {
  const repoPath = `${WIDER_DIRECTORY}/fixture-core.js`;
  const root = fixtureRoot({ [repoPath]: moduleOfLines(500) });
  const result = runLint(root, [repoPath]);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, new RegExp(`^${repoPath}:401  module is 500 lines \\(max 400\\)$`, "m"));
});

test("a test file is not a production module and is skipped", () => {
  const repoPath = `${OWNER_DIRECTORY}/skipped.test.ts`;
  const root = fixtureRoot({ [repoPath]: moduleOfLines(900) });
  const result = runLint(root, [repoPath]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /0 file\(s\) checked/);
});
