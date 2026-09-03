import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "no-junk-drawer-modules.mjs");

/** Creates a fresh temporary repository root for one test. */
function makeRoot() {
  return mkdtempSync(path.join(os.tmpdir(), "no-junk-drawer-modules-"));
}

/** Writes one fixture at a repo-relative path under the root and returns that path. */
function writeFixture(root, repoPath, source) {
  const absolute = path.join(root, repoPath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, source);
  return repoPath;
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

test("no-junk-drawer-modules passes files named after the job they own", () => {
  const root = makeRoot();
  const owned = [
    writeFixture(root, "packages/agent-shell/app/map/units/scalar-math.ts", "export const one = 1;\n"),
    writeFixture(root, "packages/agent-shell/app/map/ui/tokens.css", ":root { --x: 0; }\n"),
    writeFixture(root, "packages/agent-shell/app/map/surfaces/common-surface-props.ts", "export const one = 1;\n"),
    writeFixture(root, "packages/agent-shell/app/public/area-map-utilities-core.js", "export const one = 1;\n")
  ];
  const result = runLint(root, owned);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no-junk-drawer-modules lint passed \(4 file\(s\) checked\)/);
});

test("no-junk-drawer-modules fails every ownerless basename, whatever the extension or case", () => {
  const root = makeRoot();
  const offenders = [
    writeFixture(root, "packages/agent-shell/app/map/utils.ts", "export const one = 1;\n"),
    writeFixture(root, "packages/agent-shell/app/map/ui/helpers.tsx", "export const one = 1;\n"),
    writeFixture(root, "packages/agent-shell/app/map/input/Util.ts", "export const one = 1;\n"),
    writeFixture(root, "packages/agent-shell/app/public/common.js", "export const one = 1;\n"),
    writeFixture(root, "packages/agent-shell/app/misc.mjs", "export const one = 1;\n"),
    writeFixture(root, "packages/agent-shell/app/map/ui/helper.css", ".x { }\n")
  ];
  const result = runLint(root, offenders);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^packages\/agent-shell\/app\/map\/utils\.ts:1  "utils" names no owner$/m);
  assert.match(result.stderr, /ui\/helpers\.tsx:1  "helpers" names no owner$/m);
  assert.match(result.stderr, /input\/Util\.ts:1  "util" names no owner$/m);
  assert.match(result.stderr, /public\/common\.js:1  "common" names no owner$/m);
  assert.match(result.stderr, /app\/misc\.mjs:1  "misc" names no owner$/m);
  assert.match(result.stderr, /ui\/helper\.css:1  "helper" names no owner$/m);
  assert.match(result.stderr, /no-junk-drawer-modules lint failed with 6 hit\(s\)/);
});

test("no-junk-drawer-modules ignores test files, fixtures and files outside the wider scope", () => {
  const root = makeRoot();
  const ignored = [
    writeFixture(root, "packages/agent-shell/app/map/utils.test.ts", "export const one = 1;\n"),
    writeFixture(root, "packages/agent-shell/app/test-fixtures/area-map/helpers.js", "export const one = 1;\n"),
    writeFixture(root, "packages/usage/src/utils.ts", "export const one = 1;\n")
  ];
  const result = runLint(root, ignored);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 file\(s\) checked/);
});
