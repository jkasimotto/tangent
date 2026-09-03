import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeFixtureRoot, runLint, writeFixture } from "./lint-test-support.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "no-imperative-dom.mjs");

test("no-imperative-dom passes a Map module that renders through React and skips its test file", () => {
  const root = makeFixtureRoot("no-imperative-dom");
  const clean = writeFixture(root, "packages/agent-shell/app/map/surfaces/help/Help.tsx", [
    "// A comment may say innerHTML or document.createElement without harm.",
    "const note = \"appendChild in a string is not a call\";",
    "/** Renders the Help surface. */",
    "export function Help() {",
    "  return <section className=\"tangent-map-help\">{note}</section>;",
    "}",
    ""
  ].join("\n"));
  const testFile = writeFixture(root, "packages/agent-shell/app/map/surfaces/help/Help.test.tsx", "document.body.innerHTML = \"\";\n");
  const result = runLint(SCRIPT, root, [clean, testFile]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no-imperative-dom lint passed \(1 file\(s\) checked\)/);
});

test("no-imperative-dom fails every banned call in the kit too, naming the lines", () => {
  const root = makeFixtureRoot("no-imperative-dom");
  const offender = writeFixture(root, "packages/agent-shell/app/map/ui/Panel.tsx", [
    "/** Mounts a panel by hand. */",
    "export function mountPanel(host: HTMLElement, html: string) {",
    "  const panel = document.createElement(\"div\");",
    "  panel.innerHTML = html;",
    "  host.appendChild(panel);",
    "  host.insertAdjacentHTML(\"beforeend\", \"<hr />\");",
    "  return <div dangerouslySetInnerHTML={{ __html: html }} />;",
    "}",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [offender]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^packages\/agent-shell\/app\/map\/ui\/Panel\.tsx:3  document\.createElement is imperative DOM: const panel = document\.createElement\("div"\);$/m);
  assert.match(result.stderr, /Panel\.tsx:4  innerHTML is imperative DOM: panel\.innerHTML = html;$/m);
  assert.match(result.stderr, /Panel\.tsx:5  appendChild is imperative DOM/m);
  assert.match(result.stderr, /Panel\.tsx:6  insertAdjacentHTML is imperative DOM/m);
  assert.match(result.stderr, /Panel\.tsx:7  dangerouslySetInnerHTML is imperative DOM/m);
  assert.match(result.stderr, /no-imperative-dom lint failed with 5 hit\(s\)/);
});

test("no-imperative-dom fails document.write and an outerHTML read in a .ts module", () => {
  const root = makeFixtureRoot("no-imperative-dom");
  const offender = writeFixture(root, "packages/agent-shell/app/map/canvas/projection.ts", [
    "/** Reads the host markup. */",
    "export function hostMarkup(host: HTMLElement): string {",
    "  globalThis.document.write(\"\");",
    "  return host[\"outerHTML\"];",
    "}",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [offender]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /projection\.ts:3  document\.write is imperative DOM/m);
  assert.match(result.stderr, /projection\.ts:4  outerHTML is imperative DOM/m);
});
