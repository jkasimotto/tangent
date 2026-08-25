import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createGoalLaunchView } from "./public/goal-launch-view.js";

/**
 * Builds the launch view with the picker already loaded for one Area and one
 * kind, and records every Area the view asks the server about. The server
 * supplies no harness of its own, so this client path decides what a one-press
 * Start agent runs on.
 */
function viewWithLoadedPicker({ area, kind = "launch", choice = { harness: "codex", model: "sol" }, declared = true }) {
  const dom = new JSDOM("<main></main>", { url: "http://agent-shell.test/" });
  globalThis.localStorage = dom.window.localStorage;
  const asked = [];
  const state = {
    describeDraft: { area, description: "", sources: [] },
    brains: [],
    launchTarget: "",
    launch: {
      area,
      kind,
      options: {
        harnesses: [{ id: "codex", label: "Codex", command: "codex", models: [{ id: "sol", label: "Sol", args: "--model sol" }] }],
        default: { harness: "codex", model: "sol", command: "codex --model sol", label: "Codex · Sol" },
      },
      loading: false,
      choice,
      command: "",
    },
    vault: { areas: [{ path: area }] },
  };
  /** Answers the Area default lookup and records which Area was asked about. */
  const api = async (url) => {
    asked.push(new URL(url, "http://agent-shell.test/").searchParams.get("area"));
    if (!declared) return { harnesses: [], default: null };
    return { harnesses: [], default: { harness: "claude-otto", model: "opus-5", effort: "medium", label: "Claude Otto · Opus 5 · Medium", command: "claude-otto" } };
  };
  /** Returns no posted value in this focused fixture. */
  const post = async () => ({});
  /** Ignores repaint requests in this focused fixture. */
  const paint = () => {};
  /** Ignores toast requests in this focused fixture. */
  const showToast = () => {};
  /** Returns no extra Areas in this focused fixture. */
  const allAreas = () => [];
  /** Uses the Area path as its display label. */
  const areaLabel = (value) => value;
  /** Uses the supplied Area as its path. */
  const areaPath = (value) => value;
  /** Returns the Area of the Describe work draft. */
  const describeLaunchArea = () => state.describeDraft.area;
  /** Returns no Goal in this focused fixture. */
  const goalByFile = () => null;
  /** Returns no current Goal in this focused fixture. */
  const currentGoal = () => null;
  /** Returns no Goal session in this focused fixture. */
  const sessionForGoal = () => null;
  /** Returns no brain in this focused fixture. */
  const brainForAreaCard = () => null;
  /** Returns no brain state text in this focused fixture. */
  const brainStateLabel = () => "";
  /** Returns no brain state class in this focused fixture. */
  const brainKind = () => "";
  /** Returns no launch popover in this focused fixture. */
  const launchPopover = () => "";
  const view = createGoalLaunchView({
    shell: { state, api, post, paint, showToast },
    areaModel: { allAreas, areaLabel, areaPath },
    work: { humanName: String, agentName: String, describeLaunchArea, goalByFile, currentGoal, sessionForGoal, brainForAreaCard, brainStateLabel, brainKind },
    overlays: { launchPopover, DESCRIBE_LAUNCH_TARGET: "__describe__", BRAIN_LAUNCH_TARGET: "__brain__" },
  });
  return { view, asked };
}

test("a one-press start uses the picker only for its own Area and its own kind", async () => {
  // The picker Julian opened for this Goal's Area speaks for the start: the
  // harness on screen is the harness that runs.
  const same = viewWithLoadedPicker({ area: "otto/tangent" });
  const own = await same.view.launchFieldsForArea("otto/tangent");
  assert.deepEqual(own.fields, { choice: { harness: "codex", model: "sol" } });
  assert.equal(own.label, "Codex · Sol");
  assert.deepEqual(same.asked, []);

  // A picker left open on another Area must not name this Area's harness. The
  // client asks for this Area's own declared default instead.
  const other = viewWithLoadedPicker({ area: "otto/dnd" });
  const elsewhere = await other.view.launchFieldsForArea("otto/tangent");
  assert.deepEqual(elsewhere.fields, { choice: { harness: "claude-otto", model: "opus-5", effort: "medium" } });
  assert.equal(elsewhere.label, "Claude Otto · Opus 5 · Medium");
  assert.deepEqual(other.asked, ["otto/tangent"]);

  // The brain picker holds the brain harness. A worker never inherits it.
  const brain = viewWithLoadedPicker({ area: "otto/tangent", kind: "brain" });
  const worker = await brain.view.launchFieldsForArea("otto/tangent");
  assert.deepEqual(worker.fields, { choice: { harness: "claude-otto", model: "opus-5", effort: "medium" } });
  assert.deepEqual(brain.asked, ["otto/tangent"]);
});

test("a start carries nothing when the Area declares no harness, so the server refuses it", async () => {
  // Nothing is invented on either side: the request goes out empty and the
  // server answers with the named refusal that says what to declare.
  const { view, asked } = viewWithLoadedPicker({ area: "otto/dnd", declared: false });
  const nothing = await view.launchFieldsForArea("otto/tangent");
  assert.deepEqual(nothing.fields, {});
  assert.equal(nothing.label, "");
  assert.deepEqual(asked, ["otto/tangent"]);
});
