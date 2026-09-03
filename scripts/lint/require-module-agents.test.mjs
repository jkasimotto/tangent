import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "require-module-agents.mjs");
const MODULE = "packages/agent-shell/app/map/ui";

/** Creates a fresh temporary repository root for one test. */
function makeRoot() {
  return mkdtempSync(path.join(os.tmpdir(), "require-module-agents-"));
}

/** Writes one fixture at a repo-relative path under the root and returns that path. */
function writeFixture(root, repoPath, source) {
  const absolute = path.join(root, repoPath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, source);
  return repoPath;
}

/** Writes `count` production files into a repo-relative directory and returns their paths. */
function writeModuleFiles(root, repoDirectory, count) {
  return Array.from({ length: count }, (_, index) => writeFixture(root, `${repoDirectory}/part-${index}.ts`, "export const one = 1;\n"));
}

/** Runs the lint with --root and explicit paths and returns its status and streams. */
function runLint(root, repoPaths) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, "--root", root, ...repoPaths], { encoding: "utf8", stdio: "pipe" });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return { status: error.status, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

test("require-module-agents passes a five-file directory with AGENTS.md and a CLAUDE.md symlink", () => {
  const root = makeRoot();
  writeModuleFiles(root, MODULE, 5);
  writeFixture(root, `${MODULE}/AGENTS.md`, "# Agent Notes\n");
  symlinkSync("AGENTS.md", path.join(root, MODULE, "CLAUDE.md"));
  const result = runLint(root, [MODULE]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /require-module-agents lint passed \(1 directory checked\)/);
});

test("require-module-agents passes a four-file directory without a guide, tests and .d.ts not counted", () => {
  const root = makeRoot();
  const files = writeModuleFiles(root, MODULE, 4);
  writeFixture(root, `${MODULE}/part-0.test.ts`, "export const one = 1;\n");
  writeFixture(root, `${MODULE}/types.d.ts`, "export type One = 1;\n");
  const result = runLint(root, files);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 directory checked/);
});

test("require-module-agents fails a five-file directory with no AGENTS.md, naming the directory", () => {
  const root = makeRoot();
  const files = writeModuleFiles(root, MODULE, 5);
  const result = runLint(root, [files[0]]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^packages\/agent-shell\/app\/map\/ui:1  holds 5 production files but no AGENTS\.md$/m);
  assert.match(result.stderr, /require-module-agents lint failed with 1 hit\(s\)/);
});

test("require-module-agents fails when CLAUDE.md is missing or is a copy instead of a symlink", () => {
  const root = makeRoot();
  writeModuleFiles(root, MODULE, 4);
  writeFixture(root, `${MODULE}/kit.css`, ".x { }\n");
  writeFixture(root, `${MODULE}/AGENTS.md`, "# Agent Notes\n");
  const missing = runLint(root, [MODULE]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /map\/ui:1  has AGENTS\.md but no CLAUDE\.md symlink/);
  writeFixture(root, `${MODULE}/CLAUDE.md`, "# Agent Notes\n");
  const copied = runLint(root, [MODULE]);
  assert.equal(copied.status, 1);
  assert.match(copied.stderr, /map\/ui:1  CLAUDE\.md must be a symlink to AGENTS\.md, not a separate file/);
});

test("require-module-agents walks the whole Map tree when given no paths", () => {
  const root = makeRoot();
  writeModuleFiles(root, "packages/agent-shell/app/map/surfaces/find", 6);
  writeModuleFiles(root, "packages/agent-shell/app/map/units", 2);
  writeModuleFiles(root, "packages/agent-shell/app/other", 9);
  const result = runLint(root, []);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /map\/surfaces\/find:1  holds 6 production files but no AGENTS\.md/);
  assert.doesNotMatch(result.stderr, /app\/other/);
  assert.match(result.stderr, /failed with 1 hit\(s\)/);
});
