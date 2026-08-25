// The launch touchpoint on Work: one element per running row that says which
// harness, model, and effort runs it and opens that agent
// (otto/tangent/design-see-the-harness-model-effort-and-open-that-agent).

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootWorkTable } from "./work-table-harness.mjs";
import { workTableFixture } from "./work-table-fixture.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The fixture with the launch ids the server records at start time. */
function withLaunches(fixture) {
  const sessions = fixture.sessions.map((session) => (session.name === "standards--docs"
    ? { ...session, launchRef: "claude-otto/opus-5/medium" }
    : session));
  const pipelines = fixture.pipelines.map((pipeline) => ({
    ...pipeline,
    steps: pipeline.steps.map((step) => (step.session === "tangent--table"
      ? { ...step, launch: { harness: "pi-code", model: "glm-5-2", effort: null } }
      : step)),
  }));
  return { ...fixture, sessions, pipelines };
}

/** The primary open control of one Goal row. */
function openControl(document, slug) {
  return document.querySelector(`tr[data-goal-anchor$='goal-${slug}.md'] .work-cell-action [data-open-goal-run]`);
}

test("a running step's open control is its harness, model, and effort", async () => {
  const { document } = await bootWorkTable(withLaunches(workTableFixture()));
  const control = openControl(document, "compact-table");

  assert.equal(control.textContent.trim(), "pi-code/glm-5-2", "an empty effort is dropped, not printed");
  assert.equal(control.className, "desk-launch-ref", "the launch text never takes the state colour of .desk-action");
  assert.match(control.getAttribute("aria-label"), /^Open step 1 on pi-code\/glm-5-2:/, "the verb moves into the accessible name");
  assert.equal(control.getAttribute("title"), "Open step 1 on pi-code/glm-5-2");
  assert.equal(document.querySelectorAll("tr[data-goal-anchor$='goal-compact-table.md'] .work-cell-action [data-open-goal-run]").length, 1, "the fact and the control are one element");
});

test("a plain session's open control is its recorded launch ids", async () => {
  const { document } = await bootWorkTable(withLaunches(workTableFixture()));
  const control = openControl(document, "framework-docs");

  assert.equal(control.textContent.trim(), "claude-otto/opus-5/medium");
  assert.match(control.getAttribute("aria-label"), /^Open Claude on claude-otto\/opus-5\/medium:/);
});

test("a row with no recorded launch keeps its verb", async () => {
  const { document } = await bootWorkTable(withLaunches(workTableFixture()));
  const control = openControl(document, "nesc-241");

  assert.equal(control.textContent.trim(), "Open Claude", "a session started before the ids were recorded is never guessed at");
  assert.equal(control.className, "desk-action");
});

test("a row with no route shows no launch", async () => {
  const fixture = withLaunches(workTableFixture());
  // The stopped step of the walkthrough pipeline: given a launch it must still
  // draw nothing, because what you can read on Work you can click.
  fixture.pipelines[0].steps[2].launch = { harness: "codex", model: "luna", effort: "low" };
  const { document } = await bootWorkTable(fixture);
  const cell = document.querySelector("tr[data-goal-anchor$='goal-walkthrough.md'] .work-cell-action");

  assert.equal(cell.querySelector(".desk-launch-ref"), null);
  assert.equal(cell.textContent.includes("codex/luna/low"), false);
});

// The launch text is the widest thing the Action column ever holds, and it sits
// left of the `▾` menu. If the column cannot hold it, the inline-flex row of
// actions takes its max-content width and pushes the menu out of the cell:
// measured 3.5 px at 1440 px and 41 px at the 959 px breakpoint, where the menu
// left the table. Two rules hold the alignment, and this test pins both: the
// numbers must add up, and the actions row must be allowed to shrink.
test("the Action column holds the launch text, so every row's menu sits on one x", async () => {
  const css = await readFile(path.join(here, "public", "shell.css"), "utf8");
  /** Reads one declared pixel length off the rule that starts with `selector`. */
  const pixelsOf = (selector, property) => {
    const rule = css.split("\n").find((line) => line.trimStart().startsWith(`${selector} {`));
    assert.ok(rule, `${selector} has a rule`);
    const match = new RegExp(`${property}:\\s*(\\d+)px`).exec(rule);
    assert.ok(match, `${selector} declares a pixel ${property}`);
    return Number(match[1]);
  };
  const column = pixelsOf(".work-col-action", "width");
  const launch = pixelsOf(".desk-launch-ref", "max-width");
  const gap = pixelsOf(".desk-goal-actions", "gap");
  const menu = pixelsOf(".desk-action-menu > summary", "width");
  const padding = Number(/\.work-row > \* \{[^}]*padding:\s*\d+px\s+(\d+)px/.exec(css)[1]);

  assert.ok(launch + gap + menu + padding * 2 <= column, `the launch text, the gap, the menu and the cell padding fit ${column}px`);
  assert.ok(launch >= 141, "the widest launch in the registry, claude-otto/sonnet-5/xhigh, is 141px and is never clipped");
  const shrink = css.split("\n").find((line) => line.startsWith(".work-cell-action .desk-goal-actions {"));
  assert.match(shrink, /max-width:\s*100%/, "the actions row may shrink, or the ellipsis on the launch text never runs");
});
