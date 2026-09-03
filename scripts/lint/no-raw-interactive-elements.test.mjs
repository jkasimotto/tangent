import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeFixtureRoot, runLint, writeFixture } from "./lint-test-support.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "no-raw-interactive-elements.mjs");

test("no-raw-interactive-elements passes a feature that composes the kit and leaves the kit alone", () => {
  const root = makeFixtureRoot("no-raw-interactive-elements");
  const clean = writeFixture(root, "packages/agent-shell/app/map/surfaces/find/Find.tsx", [
    "import { Button, TextField } from \"../../ui/Button.tsx\";",
    "// A comment may mention <input> and a string may hold \"<button>\" without harm.",
    "/** Renders Find from kit parts. */",
    "export function Find() {",
    "  return <form><TextField /><Button /></form>;",
    "}",
    ""
  ].join("\n"));
  const kit = writeFixture(root, "packages/agent-shell/app/map/ui/Button.tsx", "export const Button = () => <button type=\"button\" />;\n");
  const logic = writeFixture(root, "packages/agent-shell/app/map/surfaces/find/find-store.ts", "export const tag = \"<select>\";\n");
  const result = runLint(SCRIPT, root, [clean, kit, logic]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no-raw-interactive-elements lint passed \(1 file\(s\) checked\)/);
});

test("no-raw-interactive-elements fails each raw element outside the kit, naming the lines", () => {
  const root = makeFixtureRoot("no-raw-interactive-elements");
  const offender = writeFixture(root, "packages/agent-shell/app/map/surfaces/find/Find.tsx", [
    "/** Renders Find with raw controls. */",
    "export function Find() {",
    "  return (",
    "    <form>",
    "      <input type=\"search\" />",
    "      <button type=\"submit\">Go</button>",
    "      <select><option>a</option></select>",
    "      <textarea />",
    "    </form>",
    "  );",
    "}",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [offender]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^packages\/agent-shell\/app\/map\/surfaces\/find\/Find\.tsx:5  raw <input> outside the kit: <input type="search" \/>$/m);
  assert.match(result.stderr, /Find\.tsx:6  raw <button> outside the kit: <button type="submit">Go<\/button>$/m);
  assert.match(result.stderr, /Find\.tsx:7  raw <select> outside the kit/m);
  assert.match(result.stderr, /Find\.tsx:8  raw <textarea> outside the kit/m);
  assert.match(result.stderr, /no-raw-interactive-elements lint failed with 4 hit\(s\)/);
});
