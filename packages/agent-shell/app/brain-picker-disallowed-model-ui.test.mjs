// A Brain chooser lives inside the Brain pane, not in a floating popover.
// Clicking its own harness and model must keep the launch it shows, and a
// launch the Area policy refuses must say so and leave the chooser usable.

import assert from "node:assert/strict";
import test from "node:test";

import { bootWorkTable, settle } from "./work-table-harness.mjs";

const AREA = "otto/tangent";

// What the server returns for an Area whose inherited policy allows
// `codex-otto/sol/ultra` and `claude-otto/opus-5`, and which remembers no
// brain launch yet. Picking Codex and Sol composes `codex-otto/sol`, which
// that policy refuses because it names no effort.
const launchOptions = {
  area: AREA,
  harnesses: [
    {
      id: "claude-otto", label: "Claude", command: "claude", efforts: [],
      models: [{ id: "opus-5", label: "Opus 5", args: "--model claude-opus-5", command: "claude --model claude-opus-5", efforts: [] }],
    },
    {
      id: "codex-otto", label: "Codex", command: "codex", efforts: [],
      models: [{ id: "sol", label: "Sol", args: "--model sol", command: "codex --model sol", efforts: [{ id: "ultra", label: "Ultra", args: "--effort ultra", command: "codex --model sol --effort ultra" }] }],
    },
  ],
  remembered: null,
  policy: { allow: [{ harness: "codex-otto", model: "sol", effort: "ultra" }, { harness: "claude-otto", model: "opus-5" }], declaredBy: ["otto"], unrestricted: false, health: "valid", contracts: [] },
};

const REFUSAL = "launch codex-otto/sol is not allowed by the otto policy: codex-otto/sol/ultra, claude-otto/opus-5";

/** Builds one Area whose Brain is stopped, so opening it shows its chooser. */
function fixture() {
  const goal = {
    mtime: 1, changedAt: 1, area: AREA, slug: "disallowed-model", file: `${AREA}/goal-disallowed-model.md`,
    title: "Survive a disallowed model", status: "active", doneWhen: "The chooser survives it.", waitingOn: "",
    depth: 0, order: 1, dependsOn: [], requiredBy: [], unresolvedDependencies: [], documents: [], agents: [],
    session: "disallowed-model-worker",
  };
  const goals = [goal];
  return {
    goals,
    vault: { areas: [{ path: AREA, name: "tangent", goals, documents: [] }], map: [{ path: AREA, name: "tangent", goals }], documents: [] },
    sessions: [{ name: "disallowed-model-worker", goal: goal.file, area: AREA, state: "working", command: "codex", created: 1 }],
    brains: [{ area: AREA, status: "inactive", live: false, session: "otto-tangent--brain", generation: 1, state: "stopped", forJulian: [], requests: [] }],
    pipelines: [],
  };
}

/** Refuses the start the way the Area policy does, and counts nothing else. */
function refuseStart({ path, body }) {
  if (path !== "/api/brains/start") return { ok: true };
  const payload = { error: REFUSAL, code: "launch-not-allowed", launch: [body.choice?.harness, body.choice?.model, body.choice?.effort].filter(Boolean).join("/"), area: AREA, declaredBy: "otto", allowed: ["codex-otto/sol/ultra", "claude-otto/opus-5"] };
  return {
    ok: false, status: 403,
    /** Serves the refusal body the browser client reads. */
    async json() { return payload; },
    /** Serves the same refusal as text. */
    async text() { return JSON.stringify(payload); },
    headers: {
      /** The refusal carries no headers the client reads. */
      get: () => null,
    },
  };
}

/** Opens the stopped Area Brain from Work and returns its chooser. */
async function openBrainChooser(window) {
  window.document.querySelector(`[data-work-group="${AREA}"] .work-group-brain`).click();
  await settle(window, 6);
  const picker = window.document.querySelector("[data-map-brain-pane] [data-launch-picker]");
  assert.ok(picker, "the stopped Brain shows its chooser inside the Brain pane");
  return picker;
}

/** Reads the resolved launch the Brain pane prints above the columns. */
function shownLaunch(document) {
  return document.querySelector(".brain-launch-summary strong").textContent.trim();
}

test("the Brain pane chooser keeps the harness and model the pointer picked", async () => {
  const { window, document, posts } = await bootWorkTable(fixture(), { startSurface: "work", terminalStandin: true, launchOptions, postHandler: refuseStart, localStorageEntries: { "agent-shell.last-area": AREA } });
  await openBrainChooser(window);
  assert.equal(shownLaunch(document), "Not configured", "an Area with no remembered brain launch starts with nothing chosen");

  document.querySelector("[data-launch-harness='codex-otto']").click();
  await settle(window, 4);
  assert.equal(shownLaunch(document), "codex-otto/sol", "picking a harness picks its first model with it");

  document.querySelector("[data-launch-model='sol']").click();
  await settle(window, 4);
  assert.equal(shownLaunch(document), "codex-otto/sol", "picking a model in the pane's own chooser is not a click outside it");
  assert.equal(document.querySelectorAll("[data-launch-model]").length, 1, "the Model column is still there to pick from");
  assert.equal(document.querySelector("[data-launch-effort='ultra']") !== null, true, "the Effort column is still there to correct the choice");

  document.querySelector("[data-launch-start]").click();
  await settle(window, 8);
  const start = posts.find((entry) => entry.path === "/api/brains/start");
  assert.deepEqual(start.body.choice, { harness: "codex-otto", model: "sol" }, "the Brain starts on the launch the chooser shows, never on a remembered one it replaced");
  assert.equal(start.body.expectedLaunch, "codex-otto/sol");
  window.close();
});

test("a refused launch names the Area policy that refused it and leaves the chooser usable", async () => {
  const { window, document, posts } = await bootWorkTable(fixture(), { startSurface: "work", terminalStandin: true, launchOptions, postHandler: refuseStart, localStorageEntries: { "agent-shell.last-area": AREA } });
  await openBrainChooser(window);
  document.querySelector("[data-launch-harness='codex-otto']").click();
  await settle(window, 4);
  document.querySelector("[data-launch-start]").click();
  await settle(window, 8);

  assert.match(document.querySelector("#toast").textContent, /not allowed by the otto policy/, "the refusal names the Area whose contract refused it");
  assert.match(document.querySelector("#toast").textContent, /codex-otto\/sol\/ultra/, "the refusal names what that policy does allow");
  assert.ok(document.querySelector("[data-map-brain-pane] [data-launch-picker]"), "the chooser survives the refusal");
  assert.equal(shownLaunch(document), "codex-otto/sol", "the chooser still shows the refused launch, so the correction is one click away");

  document.querySelector("[data-launch-effort='ultra']").click();
  await settle(window, 4);
  assert.equal(shownLaunch(document), "codex-otto/sol/ultra", "the effort the policy asks for completes the launch in place");

  document.querySelector("[data-launch-start]").click();
  await settle(window, 8);
  const retry = posts.filter((entry) => entry.path === "/api/brains/start").at(-1);
  assert.deepEqual(retry.body.choice, { harness: "codex-otto", model: "sol", effort: "ultra" }, "the corrected launch is the one that starts");
  window.close();
});
