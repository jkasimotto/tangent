import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeFixtureRoot, runLint, writeFixture } from "./lint-test-support.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "surface-confinement.mjs");

test("surface-confinement passes a feature rendered through Surface and leaves the kit alone", () => {
  const root = makeFixtureRoot("surface-confinement");
  const clean = writeFixture(root, "packages/agent-shell/app/map/surfaces/help/Help.tsx", [
    "import { Surface } from \"../../ui/Surface.tsx\";",
    "// A comment may say role=\"dialog\" or .focus() without harm, and so may a string.",
    "const focusRing = \"focus\";",
    "/** Renders Help inside the registered surface. */",
    "export function Help() {",
    "  return <Surface id=\"help\"><section role=\"region\" className={focusRing} /></Surface>;",
    "}",
    ""
  ].join("\n"));
  const kit = writeFixture(root, "packages/agent-shell/app/map/ui/Surface.tsx", [
    "/** Renders a registered surface and moves focus on open. */",
    "export function Surface({ heading }: { heading: HTMLElement }) {",
    "  heading.focus();",
    "  return <div role=\"dialog\" aria-modal=\"true\" autoFocus />;",
    "}",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [clean, kit]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /surface-confinement lint passed \(1 file\(s\) checked\)/);
});

test("surface-confinement fails a feature that renders its own dialog, names the lines", () => {
  const root = makeFixtureRoot("surface-confinement");
  const offender = writeFixture(root, "packages/agent-shell/app/map/surfaces/help/Help.tsx", [
    "/** Renders Help as its own dialog. */",
    "export function Help({ heading }: { heading: HTMLElement }) {",
    "  heading.focus();",
    "  heading.setAttribute(\"aria-modal\", \"true\");",
    "  const props = { role: \"alertdialog\" };",
    "  return <section role=\"dialog\" aria-modal=\"true\" autoFocus {...props} />;",
    "}",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [offender]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^packages\/agent-shell\/app\/map\/surfaces\/help\/Help\.tsx:3  \.focus\( call outside the kit: heading\.focus\(\);$/m);
  assert.match(result.stderr, /Help\.tsx:4  aria-modal outside the kit: heading\.setAttribute/m);
  assert.match(result.stderr, /Help\.tsx:5  role="alertdialog" outside the kit/m);
  assert.match(result.stderr, /Help\.tsx:6  role="dialog" outside the kit/m);
  assert.match(result.stderr, /Help\.tsx:6  aria-modal outside the kit/m);
  assert.match(result.stderr, /Help\.tsx:6  autoFocus outside the kit/m);
  assert.match(result.stderr, /surface-confinement lint failed with 6 hit\(s\)/);
});

test("surface-confinement fails a focus call in a .ts module outside the kit", () => {
  const root = makeFixtureRoot("surface-confinement");
  const offender = writeFixture(root, "packages/agent-shell/app/map/input/keyboard-dispatch.ts", [
    "/** Moves focus to the Find field. */",
    "export function focusFind(field: HTMLElement | null): void {",
    "  field?.focus();",
    "}",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [offender]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /keyboard-dispatch\.ts:3  \.focus\( call outside the kit: field\?\.focus\(\);$/m);
});
