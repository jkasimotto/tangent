import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createGoalLaunchView } from "./public/goal-launch-view.js";

const DESCRIBE = "__describe__";

/** Renders Describe work with one optional controlling brain. */
function renderDescribe(brain = null, command = "") {
  const dom = new JSDOM("<main></main>", { url: "http://agent-shell.test/" });
  globalThis.localStorage = dom.window.localStorage;
  const state = {
    describeDraft: { area: "otto/tangent/child", description: "Keep this draft.", sources: [] },
    brains: brain ? [brain] : [],
    launchTarget: "",
    launch: {
      area: "otto/tangent/child",
      options: {
        harnesses: [{ id: "codex", label: "Codex", command: "codex", models: [{ id: "sol", label: "Sol", args: "--model sol" }] }],
        default: { harness: "codex", model: "sol", command: "codex --model sol", label: "Codex · Sol" },
      },
      loading: false,
      choice: { harness: "codex", model: "sol" },
      command,
    },
    vault: { areas: [{ path: "otto/tangent/child" }] },
  };
  /** Returns no fetched value in this synchronous render fixture. */
  const api = async () => ({});
  /** Returns no posted value in this synchronous render fixture. */
  const post = async () => ({});
  /** Ignores repaint requests in this synchronous render fixture. */
  const paint = () => {};
  /** Ignores toast requests in this synchronous render fixture. */
  const showToast = () => {};
  /** Returns no extra Areas in this focused fixture. */
  const allAreas = () => [];
  /** Uses the Area path as its display label. */
  const areaLabel = (area) => area;
  /** Uses the supplied Area as its path. */
  const areaPath = (area) => area;
  /** Returns the Area selected in the Describe work draft. */
  const describeLaunchArea = () => state.describeDraft.area;
  /** Returns no Goal in this focused fixture. */
  const goalByFile = () => null;
  /** Returns no current Goal in this focused fixture. */
  const currentGoal = () => null;
  /** Returns no Goal session in this focused fixture. */
  const sessionForGoal = () => null;
  /** Finds only the exact Area brain. */
  const brainForAreaCard = (area) => state.brains.find((item) => item.area === area) ?? null;
  /** Returns no brain state text in this focused fixture. */
  const brainStateLabel = () => "";
  /** Returns no brain state class in this focused fixture. */
  const brainKind = () => "";
  /** Returns no launch popover in this focused fixture. */
  const launchPopover = () => "";
  const view = createGoalLaunchView({
    shell: { state, api, post, paint, showToast },
    areaModel: { allAreas, areaLabel, areaPath },
    work: {
      humanName: String,
      agentName: String,
      describeLaunchArea,
      goalByFile,
      currentGoal,
      sessionForGoal,
      brainForAreaCard,
      brainStateLabel,
      brainKind,
    },
    overlays: { launchPopover, DESCRIBE_LAUNCH_TARGET: DESCRIBE, BRAIN_LAUNCH_TARGET: "__brain__" },
  });
  const document = new JSDOM(view.renderDescribeCapture()).window.document;
  return { document, view };
}

test("Describe work shows the truthful chooser and recipient for every brain state", () => {
  const live = renderDescribe({ area: "otto/tangent/child", live: true, resolvedLaunch: { label: "Claude Otto · Fable 5", command: "claude-otto --model fable" } });
  assert.equal(live.document.querySelector(`[data-launch-for="${DESCRIBE}"]`), null);
  assert.match(live.document.querySelector("button[type=submit]").textContent, /Send to Claude Otto · Fable 5 brain/);
  assert.deepEqual(live.view.launchRequestFields(true), {});

  const stopped = renderDescribe({ area: "otto/tangent/child", live: false, resolvedLaunch: { label: "Claude Otto · Fable 5", command: "claude-otto --model fable" } });
  assert.ok(stopped.document.querySelector(`[data-launch-for="${DESCRIBE}"]`));
  assert.match(stopped.document.querySelector("button[type=submit]").textContent, /Resume Codex · Sol brain/);
  assert.deepEqual(stopped.view.launchRequestFields(true), {});

  const absent = renderDescribe();
  assert.ok(absent.document.querySelector(`[data-launch-for="${DESCRIBE}"]`));
  assert.match(absent.document.querySelector("button[type=submit]").textContent, /Start Codex · Sol/);
  assert.deepEqual(absent.view.launchRequestFields(true), { choice: { harness: "codex", model: "sol" } });

  const edited = renderDescribe(null, "codex --model gpt-custom --effort high");
  assert.match(edited.document.querySelector("button[type=submit]").textContent, /codex --model gpt-custom --effort high/);
  assert.deepEqual(edited.view.launchRequestFields(true), { command: "codex --model gpt-custom --effort high" });
});
