import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "no-long-param-list.mjs");

/** Creates a fresh temporary repository root for one test. */
function makeRoot() {
  return mkdtempSync(path.join(os.tmpdir(), "no-long-param-list-"));
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

test("no-long-param-list passes seven parameters and a destructured object of many fields", () => {
  const root = makeRoot();
  const clean = writeFixture(root, "packages/agent-shell/app/map/input/placement.ts", [
    "/** Seven positional parameters sit exactly on the cap. */",
    "export function seven(a: number, b: number, c: number, d: number, e: number, f: number, g: number): number {",
    "  return a + b + c + d + e + f + g;",
    "}",
    "/** One destructured object counts as one parameter however many fields it names. */",
    "export const place = ({ a, b, c, d, e, f, g, h, i }: Record<string, number>): number => a + b + c + d + e + f + g + h + i;",
    "/** A `this` parameter is a type annotation, not an argument. */",
    "export function withThis(this: object, a: number, b: number, c: number, d: number, e: number, f: number, g: number): number {",
    "  return a + b + c + d + e + f + g;",
    "}",
    ""
  ].join("\n"));
  const result = runLint(root, [clean]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no-long-param-list lint passed \(1 file\(s\) checked, 0 grandfathered\)/);
});

test("no-long-param-list fails a function, an arrow and a method past the cap, naming the lines", () => {
  const root = makeRoot();
  const offender = writeFixture(root, "packages/agent-shell/app/map/canvas/MapCanvas.tsx", [
    "/** Eight positional parameters. */",
    "export function eight(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number): number {",
    "  return a + b + c + d + e + f + g + h;",
    "}",
    "/** An arrow with nine parameters, named by its declaration. */",
    "export const nine = (a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1, h: 1, i: 1): number => 0;",
    "export class Host {",
    "  /** A method with eight parameters. */",
    "  wire(a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1, h: 1): void {}",
    "}",
    ""
  ].join("\n"));
  const result = runLint(root, [offender]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^packages\/agent-shell\/app\/map\/canvas\/MapCanvas\.tsx:2  eight takes 8 parameters \(max 7\)$/m);
  assert.match(result.stderr, /MapCanvas\.tsx:6  nine takes 9 parameters \(max 7\)$/m);
  assert.match(result.stderr, /MapCanvas\.tsx:9  wire takes 8 parameters \(max 7\)$/m);
  assert.match(result.stderr, /no-long-param-list lint failed with 3 hit\(s\)/);
});

test("no-long-param-list parses plain JavaScript in the wider scope", () => {
  const root = makeRoot();
  const offender = writeFixture(root, "packages/agent-shell/app/public/area-board.js", [
    "/** Eight parameters in a JavaScript module. */",
    "export function eight(a, b, c, d, e, f, g, h) { return a; }",
    ""
  ].join("\n"));
  const result = runLint(root, [offender]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /area-board\.js:2  eight takes 8 parameters \(max 7\)$/m);
});

test("no-long-param-list ignores test files and files outside the wider scope", () => {
  const root = makeRoot();
  const testFile = writeFixture(root, "packages/agent-shell/app/map/input/placement.test.ts", "export const f = (a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1, h: 1) => 0;\n");
  const outside = writeFixture(root, "packages/usage/src/x.ts", "export const f = (a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1, h: 1) => 0;\n");
  const result = runLint(root, [testFile, outside]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 file\(s\) checked/);
});
