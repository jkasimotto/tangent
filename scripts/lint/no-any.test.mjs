import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeFixtureRoot, runLint, writeFixture } from "./lint-test-support.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "no-any.mjs");
const CLEAN = "packages/agent-shell/app/map/kernel/kernel-boundary.ts";
const OFFENDER = "packages/agent-shell/app/map/surfaces/find/find-store.ts";
const TSX_OFFENDER = "packages/agent-shell/app/map/canvas/MapCanvas.tsx";

test("no-any passes a file that uses unknown and named types", () => {
  const root = makeFixtureRoot("no-any");
  writeFixture(root, CLEAN, [
    "// any mention of any in a comment is fine, and so is the string 'as any'.",
    "const label = 'Record<string, any>';",
    "/** Narrows an unknown value to a record. */",
    "export function asRecord(value: unknown): Record<string, unknown> {",
    "  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : { label };",
    "}",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [CLEAN]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no-any lint passed \(1 file\(s\) checked\)/);
});

test("no-any fails each of the four banned forms, naming the lines", () => {
  const root = makeFixtureRoot("no-any");
  writeFixture(root, OFFENDER, [
    "const a: any = 1;",
    "const b = a as any;",
    "const c = <any>b;",
    "const d: Record<string, any> = {};",
    "export const all = [a, b, c, d];",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [OFFENDER]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^packages\/agent-shell\/app\/map\/surfaces\/find\/find-store\.ts:1  const a: any = 1;$/m);
  assert.match(result.stderr, /find-store\.ts:2  const b = a as any;$/m);
  assert.match(result.stderr, /find-store\.ts:3  const c = <any>b;$/m);
  assert.match(result.stderr, /find-store\.ts:4  const d: Record<string, any> = \{\};$/m);
  assert.match(result.stderr, /no-any lint failed with 4 hit\(s\)/);
});

test("no-any fails an any type inside a .tsx file", () => {
  const root = makeFixtureRoot("no-any");
  writeFixture(root, TSX_OFFENDER, [
    "/** Renders nothing typed. */",
    "export function MapCanvas(props: { api: any }) {",
    "  return <div>{props.api}</div>;",
    "}",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [TSX_OFFENDER]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MapCanvas\.tsx:2  export function MapCanvas\(props: \{ api: any \}\) \{$/m);
});
