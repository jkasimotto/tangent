import assert from "node:assert/strict";
import test from "node:test";
import { createShellCoordinator } from "./public/shell-coordinator.js";

/** Runs no deferred focus in a test. */
const ignoreTimeout = () => 0;
/** Finds nothing inside a stub node. */
const findNothing = () => null;
/** Appends nothing to a stub node. */
const insertNothing = () => {};
globalThis.window = globalThis.window || { setTimeout: ignoreTimeout };

/** Builds one trigger program record the coordinator can act on. */
function trigger(paused = false) {
  return { id: "trigger:neara/pgande:rebase", type: "trigger", area: "neara/pgande", name: "rebase", label: "Rebase", command: "./probe", cwd: "/repo", paused, session: null };
}

/** Stands in for one text node of the confirmation modal. */
function textNode() {
  return { textContent: "", innerHTML: "", hidden: true, querySelector: findNothing, insertAdjacentHTML: insertNothing };
}

/**
 * Builds the coordinator with the few capabilities its Program controls use.
 * `refreshWith` installs a fresh program list the way performRefresh does, so
 * a test can hand back the reading of a refresh that started before the
 * control was pressed.
 */
function coordinator({ programs = [trigger()], refreshWith = null } = {}) {
  const posted = [];
  const toasts = [];
  const modal = { kicker: textNode(), title: textNode(), copy: textNode(), field: textNode(), actions: textNode(), layer: { hidden: true, querySelector: findNothing } };
  const state = { programs: { operations: programs }, programId: programs[0]?.id ?? "", view: "program-detail" };
  /** Finds one program in the list the screen reads right now. */
  const programById = (id) => state.programs.operations.find((item) => item.id === id) ?? null;
  const shellCoordinator = createShellCoordinator({
    shell: {
      state,
      api: {},
      /** Records one control request. */
      post: async (url, body) => { posted.push({ url, body }); return {}; },
      actionTelemetry: {},
      /** Repaints nothing in a test. */
      paint: () => {},
      /** Replaces the program list the way a completed refresh does. */
      refresh: async () => { if (refreshWith) state.programs = { operations: refreshWith() }; },
      /** Records one toast. */
      showToast: (message) => toasts.push(message),
    },
    chrome: { modalLayer: modal.layer, modalKicker: modal.kicker, modalTitle: modal.title, modalCopy: modal.copy, modalField: modal.field, modalActions: modal.actions },
    work: {},
    areasFeature: {},
    programs: { programById },
    launch: {},
    documents: {},
  });
  return { shellCoordinator, state, posted, toasts, modal, programById };
}

test("Pause keeps its new flag when the refresh it waits for started before the write", async () => {
  const { shellCoordinator, posted, toasts, programById } = coordinator({
    /** Returns the older reading a refresh already in flight installs. */
    refreshWith: () => [trigger(false)],
  });
  await shellCoordinator.performProgramAction("pause", "trigger:neara/pgande:rebase");
  assert.deepEqual(posted, [{ url: "/api/operations/control", body: { id: "trigger:neara/pgande:rebase", action: "pause" } }]);
  assert.equal(programById("trigger:neara/pgande:rebase").paused, true);
  assert.deepEqual(toasts, ["The Trigger is paused. It checks again only after you resume it."]);
});

test("Resume clears the flag on the list the screen reads after the refresh", async () => {
  const { shellCoordinator, toasts, programById } = coordinator({
    programs: [trigger(true)],
    /** Returns the older reading a refresh already in flight installs. */
    refreshWith: () => [trigger(true)],
  });
  await shellCoordinator.performProgramAction("resume", "trigger:neara/pgande:rebase");
  assert.equal(programById("trigger:neara/pgande:rebase").paused, false);
  assert.deepEqual(toasts, ["The Trigger is back on its schedule."]);
});

test("Pause and Resume act at once and never open a confirmation", () => {
  const { shellCoordinator, posted, modal } = coordinator();
  shellCoordinator.controlProgram("pause", "trigger:neara/pgande:rebase");
  assert.equal(posted.length, 1);
  assert.equal(posted[0].body.action, "pause");
  assert.equal(modal.layer.hidden, true);
});

test("Check now asks in its own words and never says Stop", () => {
  const { shellCoordinator, modal } = coordinator();
  shellCoordinator.controlProgram("check", "trigger:neara/pgande:rebase");
  assert.equal(modal.layer.hidden, false);
  assert.equal(modal.title.textContent, "Check Rebase now?");
  assert.match(modal.copy.textContent, /runs the probe now/);
  assert.match(modal.actions.innerHTML, /data-modal-confirm>Check now</);
  assert.doesNotMatch(modal.actions.innerHTML, /Stop/);
});

test("Stop still asks with the words the Trigger design settled", () => {
  const { shellCoordinator, modal } = coordinator();
  shellCoordinator.controlProgram("stop", "trigger:neara/pgande:rebase");
  assert.equal(modal.title.textContent, "Stop Rebase?");
  assert.equal(modal.kicker.textContent, "Trigger agent");
  assert.equal(modal.copy.textContent, "This ends the live agent. The Trigger keeps its schedule and checks again at its next interval.");
  assert.match(modal.actions.innerHTML, /data-modal-confirm>Stop agent</);
});

test("Acknowledge clears the attention message without a confirmation", () => {
  const { shellCoordinator, posted, modal } = coordinator();
  shellCoordinator.controlProgram("acknowledge", "trigger:neara/pgande:rebase");
  assert.equal(posted[0].body.action, "acknowledge");
  assert.equal(modal.layer.hidden, true);
});
