import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeFixtureRoot, runLint, writeFixture } from "./lint-test-support.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "no-raw-number.mjs");
const OWNER = "packages/agent-shell/app/map/units/units.ts";
const CONSUMER = "packages/agent-shell/app/map/layout/layout-tokens.ts";
const OFFENDER = "packages/agent-shell/app/map/input/hit-test.ts";

test("no-raw-number passes brand owners, T[number], and branded quantities", () => {
  const root = makeFixtureRoot("no-raw-number");
  writeFixture(root, OWNER, [
    "declare const brand: unique symbol;",
    "export type ScreenPx = number & { readonly [brand]: 'ScreenPx' };",
    "/** Brands a raw number as screen pixels. */",
    "export function screenPx(value: number): ScreenPx { return value as ScreenPx; }",
    ""
  ].join("\n"));
  writeFixture(root, CONSUMER, [
    "import type { ScreenPx } from '../units/units.ts';",
    "type Sizes = readonly ScreenPx[];",
    "export type Size = Sizes[number];",
    "/** Returns the first size. */",
    "export function first(sizes: Sizes): ScreenPx { return sizes[0]; }",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [OWNER, CONSUMER]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no-raw-number lint passed \(2 file\(s\) checked\)/);
});

test("no-raw-number fails a raw number type outside the owners, naming the line", () => {
  const root = makeFixtureRoot("no-raw-number");
  writeFixture(root, OFFENDER, [
    "/** Adds one. */",
    "export function addOne(value: number): number {",
    "  return value + 1;",
    "}",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [OFFENDER]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^packages\/agent-shell\/app\/map\/input\/hit-test\.ts:2  export function addOne\(value: number\): number \{$/m);
  assert.match(result.stderr, /no-raw-number lint failed with 2 hit\(s\)/);
});

test("no-raw-number fails a raw number in a .tsx file and skips non-TypeScript files", () => {
  const root = makeFixtureRoot("no-raw-number");
  const tsx = writeFixture(root, "packages/agent-shell/app/map/ui/Surface.tsx", "export const width: number = 0;\n");
  const mjs = writeFixture(root, "scripts/lint/example.mjs", "export const width = 0;\n");
  const result = runLint(SCRIPT, root, [tsx, mjs]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Surface\.tsx:1  export const width: number = 0;$/m);
  assert.match(result.stderr, /1 hit\(s\) in 1 file\(s\)/);
});
