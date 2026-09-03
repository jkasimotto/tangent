import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeFixtureRoot, runLint, writeFixture } from "./lint-test-support.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "copy-confinement.mjs");

test("copy-confinement passes a feature that takes every sentence from copy.ts and leaves the kit alone", () => {
  const root = makeFixtureRoot("copy-confinement");
  const clean = writeFixture(root, "packages/agent-shell/app/map/surfaces/help/Help.tsx", [
    "import { COPY } from \"../../copy.ts\";",
    "import type { Count } from \"../../units/units.ts\";",
    "/** Renders Help from copy. */",
    "export function Help({ count }: { count: Count }) {",
    "  return (",
    "    <Panel title={COPY.help.title} aria-label={COPY.help.label} className=\"tangent-map-help\">",
    "      {COPY.help.body} · {count}",
    "      <Kbd>Esc</Kbd>",
    "    </Panel>",
    "  );",
    "}",
    ""
  ].join("\n"));
  const kit = writeFixture(root, "packages/agent-shell/app/map/ui/Dialog.tsx", "export const Dialog = () => <div title=\"Close the dialog\">Save now</div>;\n");
  const result = runLint(SCRIPT, root, [clean, kit]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /copy-confinement lint passed \(1 file\(s\) checked\)/);
});

test("copy-confinement fails feature text, literal children, and label strings, naming the lines", () => {
  const root = makeFixtureRoot("copy-confinement");
  const offender = writeFixture(root, "packages/agent-shell/app/map/surfaces/save/SaveStatus.tsx", [
    "/** Renders save status with its own words. */",
    "export function SaveStatus({ failed }: { failed: boolean }) {",
    "  return (",
    "    <section title=\"Save status\" aria-label={\"Saving the map\"}>",
    "      Saved just now",
    "      {failed ? \"Could not save\" : \"Saved\"}",
    "      <em>{`Retry in ${1} second`}</em>",
    "      <b>OK</b>",
    "    </section>",
    "  );",
    "}",
    ""
  ].join("\n"));
  const result = runLint(SCRIPT, root, [offender]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^packages\/agent-shell\/app\/map\/surfaces\/save\/SaveStatus\.tsx:4  title string is copy: <section title="Save status"/m);
  assert.match(result.stderr, /SaveStatus\.tsx:4  aria-label string is copy/m);
  assert.match(result.stderr, /SaveStatus\.tsx:5  JSX text of 3 words: Saved just now$/m);
  assert.match(result.stderr, /SaveStatus\.tsx:6  string literal of 3 words as JSX children: \{failed \? "Could not save" : "Saved"\}$/m);
  assert.match(result.stderr, /SaveStatus\.tsx:7  string literal of 3 words as JSX children/m);
  assert.match(result.stderr, /copy-confinement lint failed with 5 hit\(s\)/);
});
