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

/** The agent control of one Goal row: the one button that enters its run. */
function openControl(document, slug) {
  return document.querySelector(`tr[data-goal-anchor$='goal-${slug}.md'] .work-cell-agent [data-open-goal-run]`);
}

/** The control's words without the `⌘⇧↵` it prints after them. */
function words(control) {
  return [...control.childNodes].filter((node) => node.nodeName !== "KBD").map((node) => node.textContent).join("").trim();
}

test("a running step's open control is its harness, model, and effort", async () => {
  const { document } = await bootWorkTable(withLaunches(workTableFixture()));
  const control = openControl(document, "compact-table");

  assert.match(words(control), /^Codex · pi-code\/glm-5-2 · 1\/\d$/, "agent, launch, and step print once; an empty effort is dropped, not printed");
  assert.equal(control.className, "work-agent-ref", "the launch text never takes the state colour of .desk-action");
  assert.match(control.getAttribute("aria-label"), /^Open step 1 on pi-code\/glm-5-2:/, "the verb moves into the accessible name");
  assert.match(control.getAttribute("title"), /^Open step 1 on pi-code\/glm-5-2\n/, "the hover carries the verb, then the step instruction");
  assert.equal(control.querySelector("kbd").textContent, "⌘⇧↵", "the control prints the key that enters the run");
  assert.equal(document.querySelectorAll("tr[data-goal-anchor$='goal-compact-table.md'] .work-cell-agent [data-open-goal-run]").length, 1, "the fact and the control are one element");
});

test("a plain session's open control is its recorded launch ids", async () => {
  const { document } = await bootWorkTable(withLaunches(workTableFixture()));
  const control = openControl(document, "framework-docs");

  assert.equal(words(control), "Claude · claude-otto/opus-5/medium");
  assert.match(control.getAttribute("aria-label"), /^Open Claude on claude-otto\/opus-5\/medium:/);
});

test("a row with no recorded launch keeps its verb", async () => {
  const { document } = await bootWorkTable(withLaunches(workTableFixture()));
  const control = openControl(document, "nesc-241");

  assert.equal(words(control), "Claude", "a session started before the ids were recorded is never guessed at: the name alone");
  assert.equal(control.className, "work-agent-ref");
});

test("a row with no route prints its last launch muted, with no key and no button", async () => {
  const fixture = withLaunches(workTableFixture());
  // The stopped step of the walkthrough pipeline (work-screen-refresh D5):
  // the launch is a fact worth reading, but nothing here can be clicked.
  fixture.pipelines[0].steps[2].launch = { harness: "codex", model: "luna", effort: "low" };
  const { document } = await bootWorkTable(fixture);
  const cell = document.querySelector("tr[data-goal-anchor$='goal-walkthrough.md'] .work-cell-agent");

  assert.equal(cell.querySelector("button, [data-open-goal-run], kbd"), null);
  assert.equal(cell.querySelector(".work-agent-ref.past").textContent, "codex/luna/low · 3/3");
});

// The Agent column holds the longest launch in the registry beside the agent
// name and the step. The cell clips with an ellipsis instead of pushing the
// Status column, so every row's Status starts on one x.
test("the Agent column holds the launch text and clips instead of pushing Status", async () => {
  const css = await readFile(path.join(here, "public", "shell.css"), "utf8");
  /** Reads one declared pixel length off the rule that starts with `selector`. */
  const pixelsOf = (selector, property) => {
    const rule = css.split("\n").find((line) => line.trimStart().startsWith(`${selector} {`));
    assert.ok(rule, `${selector} has a rule`);
    const match = new RegExp(`${property}:\\s*(\\d+)px`).exec(rule);
    assert.ok(match, `${selector} declares a pixel ${property}`);
    return Number(match[1]);
  };
  assert.equal(pixelsOf(".work-col-agent", "width"), 260, "the Agent column is 260 px (work-screen-refresh D8)");
  assert.match(css.split("\n").find((line) => line.startsWith(".work-cell-agent {")), /overflow:\s*hidden/, "the cell clips");
  assert.match(css.split("\n").find((line) => line.startsWith(".work-agent-ref {")), /max-width:\s*100%/, "the control may shrink, or the ellipsis never runs");
  assert.match(css.split("\n").find((line) => line.startsWith(".work-agent-ref-text {")), /text-overflow:\s*ellipsis/);
});
