import assert from "node:assert/strict";
import test from "node:test";

import { bootWorkTable, press, settle } from "./work-table-harness.mjs";

const AREA = "otto/tangent";

const launchOptions = {
  area: AREA,
  harnesses: [
    {
      id: "codex", label: "Codex", command: "codex",
      models: [
        { id: "sol", label: "Sol", args: "--model sol", efforts: [{ id: "low", label: "Low", args: "--effort low" }, { id: "high", label: "High", args: "--effort high" }] },
        { id: "luna", label: "Luna", args: "--model luna", efforts: [] },
      ],
    },
    { id: "claude", label: "Claude", command: "claude", models: [{ id: "opus", label: "Opus", args: "--model opus" }] },
  ],
  remembered: { harness: "codex", model: "sol", effort: "low", label: "Codex · Sol · Low", command: "codex --model sol --effort low", source: AREA },
  default: { harness: "codex", model: "sol", effort: "low", label: "Codex · Sol · Low", command: "codex --model sol --effort low", source: AREA },
  workDefault: { harness: "codex", model: "sol", effort: "low", label: "Codex · Sol · Low", command: "codex --model sol --effort low", source: AREA },
  brainDefault: { harness: "codex", model: "sol", effort: "low", label: "Codex · Sol · Low", command: "codex --model sol --effort low", source: AREA },
  declarations: { work: { mode: "inherit" }, brain: { mode: "work" } },
};

/** Builds one Area whose Brain is stopped, so opening it shows its chooser. */
function fixture() {
  const goal = {
    mtime: 1, changedAt: 1, area: AREA, slug: "picker-motion", file: `${AREA}/goal-picker-motion.md`,
    title: "Move the model choice with j and k", status: "active", doneWhen: "The keys move it.", waitingOn: "",
    depth: 0, order: 1, dependsOn: [], requiredBy: [], unresolvedDependencies: [], documents: [], agents: [],
    session: "picker-motion-worker",
  };
  const goals = [goal];
  return {
    goals,
    vault: { areas: [{ path: AREA, name: "tangent", goals, documents: [] }], map: [{ path: AREA, name: "tangent", goals }], documents: [] },
    sessions: [{ name: "picker-motion-worker", goal: goal.file, area: AREA, state: "working", command: "codex", created: 1 }],
    brains: [{ area: AREA, status: "inactive", live: false, session: "otto-tangent--brain", generation: 1, state: "stopped", forJulian: [], requests: [] }],
    pipelines: [],
  };
}

/** Opens the stopped Area Brain from Work and returns its chooser. */
async function openBrainChooser(window) {
  const control = window.document.querySelector(`[data-work-group="${AREA}"] .work-group-brain`);
  assert.ok(control, "Work names one route into the Area Brain");
  control.click();
  await settle(window, 6);
  const picker = window.document.querySelector("[data-map-brain-pane] [data-launch-picker]");
  assert.ok(picker, "the stopped Brain shows its chooser inside the Brain pane");
  return picker;
}

test("the Brain pane chooser answers the one motion grammar and swallows the keys", async () => {
  const { window, document } = await bootWorkTable(fixture(), { startSurface: "work", terminalStandin: true, launchOptions, localStorageEntries: { "agent-shell.last-area": AREA } });
  await openBrainChooser(window);

  document.querySelector("[data-launch-start]").focus();
  const down = press(window, "j");
  await settle(window, 3);
  assert.equal(down.defaultPrevented, true, "the chooser takes the key instead of letting it fall through and beep");
  assert.equal(document.activeElement.dataset.launchHarness, "claude", "j moves the checked harness past the default");
  assert.equal(document.querySelector("[data-launch-harness='claude']").getAttribute("aria-checked"), "true", "moving is choosing");

  const up = press(window, "k");
  await settle(window, 3);
  assert.equal(up.defaultPrevented, true);
  assert.equal(document.activeElement.dataset.launchHarness, "codex", "k moves back to the default harness");

  const right = press(window, "l");
  await settle(window, 3);
  assert.equal(right.defaultPrevented, true);
  assert.equal(document.activeElement.dataset.launchModel, "sol", "l enters the Model column on its checked value");
  press(window, "j");
  await settle(window, 3);
  assert.equal(document.activeElement.dataset.launchModel, "luna", "j moves inside the Model column");

  const left = press(window, "h");
  await settle(window, 3);
  assert.equal(left.defaultPrevented, true);
  assert.equal(document.activeElement.dataset.launchHarness, "codex", "h goes back to the Harness column");

  // Arrows and Control-N are the same grammar, so they move the same way.
  press(window, "ArrowRight");
  await settle(window, 3);
  assert.equal(document.activeElement.dataset.launchModel, "luna");
  press(window, "ArrowUp");
  await settle(window, 3);
  assert.equal(document.activeElement.dataset.launchModel, "sol");
  press(window, "n", { ctrlKey: true });
  await settle(window, 3);
  assert.equal(document.activeElement.dataset.launchModel, "luna", "Control-N moves as j does");
  window.close();
});

test("the Brain pane chooser prints the keys that move it, and its letters still run", async () => {
  const { window, document } = await bootWorkTable(fixture(), { startSurface: "work", terminalStandin: true, launchOptions, localStorageEntries: { "agent-shell.last-area": AREA } });
  const picker = await openBrainChooser(window);

  const hint = picker.querySelector(".launch-key-hint").textContent.replace(/\s+/g, " ");
  assert.match(hint, /h\/l column/, "the chooser prints the column keys where the columns are");
  assert.match(hint, /j\/k choose/, "the chooser prints the keys that move the choice");

  document.querySelector("[data-launch-start]").focus();
  const letter = press(window, "e");
  await settle(window, 5);
  assert.equal(letter.defaultPrevented, true, "a printed letter still runs its own command");
  assert.equal(document.querySelector("[data-harness-form], [data-harness-field]") !== null || document.querySelector("[data-launch-picker]") === null, true, "e leaves the chooser for the harness registry");
  window.close();
});
