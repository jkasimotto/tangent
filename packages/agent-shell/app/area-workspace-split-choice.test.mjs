import assert from "node:assert/strict";
import test from "node:test";

import { AREA_WORKSPACE_LAYOUT_KEY } from "./public/split-workspace-core.js";
import { bootWorkTable, settle } from "./work-table-harness.mjs";

const AREA = "otto/tangent";
const BRAIN = "otto-tangent--brain";

/** Builds one Area with one live worker and one live Brain. */
function fixture() {
  const goal = {
    mtime: 1, changedAt: 1, area: AREA, slug: "split-choice", file: `${AREA}/goal-split-choice.md`,
    title: "Keep the panes Julian chose", status: "active", doneWhen: "The panes obey him.", waitingOn: "",
    depth: 0, order: 1, dependsOn: [], requiredBy: [], unresolvedDependencies: [], documents: [], agents: [],
    session: "split-choice-worker",
  };
  const goals = [goal];
  return {
    goals,
    vault: { areas: [{ path: AREA, name: "tangent", goals, documents: [] }], map: [{ path: AREA, name: "tangent", goals }], documents: [] },
    sessions: [
      { name: "split-choice-worker", goal: goal.file, area: AREA, state: "working", command: "codex", created: 1 },
      { name: BRAIN, area: AREA, kind: "brain", state: "working", command: "codex", created: 1 },
    ],
    brains: [{ area: AREA, status: "active", live: true, session: BRAIN, generation: 1, state: "working", forJulian: [], requests: [] }],
    pipelines: [],
  };
}

/** Boots Work with one optional remembered split choice. */
function boot(companion = false) {
  return bootWorkTable(fixture(), {
    startSurface: "work",
    terminalStandin: true,
    localStorageEntries: {
      "agent-shell.last-area": AREA,
      ...(companion ? { [AREA_WORKSPACE_LAYOUT_KEY]: { schema: "area-workspace-layout.v1", order: ["map", "brain"], sizePx: { brain: 560 }, companion: true } } : {}),
    },
  });
}

/** Reports which workspace panes a reader can see. */
function panes(document) {
  /** True when this pane is on screen for a reader. */
  const visible = (id) => {
    const pane = document.querySelector(`[data-split-pane="${id}"]`);
    return Boolean(pane) && !pane.hidden;
  };
  return { map: visible("map"), brain: visible("brain"), presentation: document.querySelector("[data-area-workspace]")?.dataset.presentation };
}

/** Opens the Area Brain from the Work desk, the route Julian uses. */
async function enterBrainFromWork(window) {
  const control = window.document.querySelector(`[data-open-brain="${BRAIN}"]`);
  assert.ok(control, "Work names one route into the Area Brain");
  control.click();
  await settle(window, 6);
}

test("opening a Brain from Work enters the Brain alone", async () => {
  const { window, document } = await boot();
  await enterBrainFromWork(window);
  assert.deepEqual(panes(document), { map: false, brain: true, presentation: "single" }, "the Brain fills the workspace and the Map stays closed");
  assert.ok(document.querySelector('[data-split-pane="map"]'), "the Map keeps its stable root for a later split");
  const split = document.querySelector("#split-button");
  assert.equal(split.hidden, false, "the split control is visible beside the Brain");
  assert.equal(split.getAttribute("aria-pressed"), "false");
  window.close();
});

test("the split is Julian's choice and it survives navigation and a restart", async () => {
  const first = await boot();
  await enterBrainFromWork(first.window);
  first.document.querySelector("#split-button").click();
  await settle(first.window, 6);
  assert.deepEqual(panes(first.document), { map: true, brain: true, presentation: "wide" }, "the split control opens the Map beside the Brain");
  assert.equal(first.document.querySelector("#split-button").getAttribute("aria-pressed"), "true");
  first.document.querySelector("#map-tab").click();
  await settle(first.window, 6);
  assert.deepEqual(panes(first.document), { map: true, brain: true, presentation: "wide" }, "reaching the Map keeps the split he asked for");
  const stored = JSON.parse(first.window.localStorage.getItem(AREA_WORKSPACE_LAYOUT_KEY));
  assert.equal(stored.companion, true, "the choice is remembered for the next visit");
  first.window.close();

  const next = await boot(true);
  await enterBrainFromWork(next.window);
  assert.deepEqual(panes(next.document), { map: true, brain: true, presentation: "wide" }, "a remembered split comes back after a restart");
  next.document.querySelector("#split-button").click();
  await settle(next.window, 6);
  assert.deepEqual(panes(next.document), { map: false, brain: true, presentation: "single" }, "closing the split leaves the pane he was reading");
  assert.equal(JSON.parse(next.window.localStorage.getItem(AREA_WORKSPACE_LAYOUT_KEY)).companion, false);
  next.window.close();
});
