import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createAreaBrainPane } from "./public/area-brain-pane.js";
import { areaBrainPaneMode } from "./public/area-brain-pane-core.js";

test("the Brain pane uses a terminal only for the exact live session", () => {
  assert.deepEqual(areaBrainPaneMode({ live: true, state: "working" }, { name: "tangent-brain" }), { kind: "terminal", session: "tangent-brain" });
  assert.deepEqual(areaBrainPaneMode({ live: true, health: { status: "failed" } }, { name: "stuck-brain" }), { kind: "terminal", session: "stuck-brain" });
});

test("missing processes resume while stopped or absent Brains wait for Julian", () => {
  assert.deepEqual(areaBrainPaneMode({ live: true, state: "working" }, null), { kind: "resuming" });
  assert.deepEqual(areaBrainPaneMode({ live: false, status: "inactive" }, null), { kind: "start", resume: true });
  assert.deepEqual(areaBrainPaneMode(null, null), { kind: "start", resume: false });
});

test("a stopped Brain refreshes its launch choices without replacing the pane", () => {
  const { window } = new JSDOM('<main id="host"></main>');
  const host = window.document.querySelector("#host");
  let selected = false;
  let seedCount = 0;
  /** Supplies a no-effect pane dependency for this focused test. */
  const noop = () => {};
  /** Keeps labels unchanged because the fixture contains no unsafe text. */
  const escapeHtml = (value) => String(value);
  const descriptor = createAreaBrainPane({
    area: "otto/tangent",
    terminalController: { disposeTerminal: noop, mountTerminal: noop, focus: noop, fit: noop },
    /** Returns the stopped-Brain facts and current launch choice. */
    projection: () => ({
      brain: { live: false }, live: null, label: "Brain stopped", presentation: { kind: "start" },
      /** Renders the current launch choice. */
      launchHtml: () => `<button data-focus-key="launch:harness:codex" aria-checked="${selected}">Codex</button>`,
    }),
    escapeHtml,
    onResume: noop,
    /** Records each request for the exact Area launch options. */
    onSeedStart: () => { seedCount += 1; },
  });
  const instance = descriptor.mount({ host });
  const firstButton = host.querySelector("[data-focus-key]");
  firstButton.focus();
  selected = true;
  instance.update({ layout: { open: new Set(["brain"]), primary: "brain", presentation: { kind: "single", active: "brain" } } });
  const nextButton = host.querySelector("[data-focus-key]");
  assert.notEqual(nextButton, firstButton, "the stopped-Brain content can reconcile changed launch state");
  assert.equal(nextButton.getAttribute("aria-checked"), "true");
  assert.equal(window.document.activeElement, nextButton, "the selected launch control keeps keyboard focus");
  assert.ok(seedCount >= 2, "each stopped-Brain refresh keeps the exact Area launch options available");
});

test("stopped and absent Brain panes focus their honest launch action", () => {
  for (const brain of [{ live: false, status: "inactive" }, null]) {
    const { window } = new JSDOM('<main id="host"></main>');
    const host = window.document.querySelector("#host");
    /** Supplies a no-effect pane dependency for each lifecycle case. */
    const noop = () => {};
    const descriptor = createAreaBrainPane({
      area: "otto/tangent",
      terminalController: { disposeTerminal: noop, mountTerminal: noop, focus: noop, fit: noop },
      /** Returns one stopped or absent lifecycle projection. */
      projection: () => ({
        brain, live: null, label: brain ? "Brain stopped" : "Brain not started", presentation: { kind: "start" },
        /** Renders the enabled action that honestly represents this Brain. */
        launchHtml: () => '<button data-launch-primary data-launch-start>Start or wake Brain</button>',
      }),
      escapeHtml: String,
      onResume: noop, onSeedStart: noop,
    });
    const instance = descriptor.mount({ host });
    instance.focus();
    assert.equal(window.document.activeElement.hasAttribute("data-launch-primary"), true, `${brain ? "stopped" : "absent"} Brain focus reaches its launch action`);
    assert.equal(host.querySelector("[data-leave-area-workspace], [data-toggle-workspace-map], [data-hide-workspace-brain]"), null, "the pane has no local navigation controls");
    window.close();
  }
});

test("a live Brain keeps one terminal and its exact metadata", () => {
  const { window } = new JSDOM('<main id="host"></main>');
  const host = window.document.querySelector("#host");
  const session = "tangent-brain-neara-designwarden-7";
  let label = "Neara / Designwarden Brain · working";
  let mountCount = 0;
  let disposeCount = 0;
  let focusCount = 0;
  let mountedHost = null;
  /** Supplies the exact live Brain facts without changing its session. */
  const projection = () => ({
    brain: { live: true },
    live: { name: session },
    label,
    presentation: { kind: "terminal", session },
  });
  const descriptor = createAreaBrainPane({
    area: "neara/designwarden",
    terminalController: {
      /** Records terminal disposal. */
      disposeTerminal: () => { disposeCount += 1; },
      /** Records the stable terminal mount target. */
      mountTerminal: (target) => { mountCount += 1; mountedHost = target; },
      /** Records terminal focus. */
      focus: () => { focusCount += 1; },
      /** Accepts the pane's fit request. */
      fit: () => {},
    },
    projection,
    escapeHtml: String,
    /** Accepts an unused resume request. */
    onResume: () => {},
    /** Accepts an unused start-form seed. */
    onSeedStart: () => {},
  });
  const instance = descriptor.mount({ host });
  const terminalHost = host.querySelector(".map-brain-terminal");
  const sessionTag = host.querySelector("[data-copy-session-tag]");
  assert.equal(host.querySelector("header strong").textContent, label);
  assert.equal(sessionTag.dataset.copySessionTag, session);
  assert.equal(sessionTag.querySelector("code").textContent, session);
  assert.equal(host.querySelector("[data-leave-area-workspace], [data-toggle-workspace-map], [data-hide-workspace-brain]"), null);
  assert.equal(mountedHost, terminalHost);
  label = "Neara / Designwarden Brain · waiting";
  instance.update({ layout: { open: new Set(["map", "brain"]), primary: "map", presentation: { kind: "split", active: "brain" } } });
  assert.equal(host.querySelector("header strong").textContent, label, "lifecycle metadata updates in place");
  assert.equal(host.querySelector(".map-brain-terminal"), terminalHost, "metadata updates keep the same terminal host");
  assert.equal(mountCount, 1, "the terminal mounts once for one exact session");
  assert.equal(disposeCount, 1, "the stable live session is not disposed during metadata updates");
  instance.focus();
  assert.equal(focusCount, 1, "the pane still delegates focus to the terminal");
  window.close();
});

test("a contextual Brain keeps a removable Document subject in its metadata", () => {
  const { window } = new JSDOM('<main id="host"></main>');
  const host = window.document.querySelector("#host");
  let subject = { title: "Map first contract" };
  let removed = 0;
  let instance = null;
  /** Supplies a no-effect pane dependency for this contextual fixture. */
  const noop = () => {};
  const descriptor = createAreaBrainPane({
    area: "otto/tangent",
    terminalController: { disposeTerminal: noop, mountTerminal: noop, focus: noop, fit: noop },
    /** Returns the stopped Brain projection shown with its Document context. */
    projection: () => ({
      brain: null,
      live: null,
      label: "Tangent Brain · stopped",
      presentation: { kind: "start" },
      /** Renders the fixture launch action. */
      launchHtml: () => '<button data-launch-primary>Start Brain</button>',
    }),
    escapeHtml: String,
    onResume: noop, onSeedStart: noop,
    /** Returns the current Document subject. */
    subject: () => subject,
    /** Records removal and clears the current Document subject. */
    onRemoveSubject: () => { removed += 1; subject = null; instance.update(); },
  });
  instance = descriptor.mount({ host });
  const header = host.querySelector("header");
  assert.match(header.textContent, /Tangent Brain · stopped.*Map first contract/s);
  assert.equal(header.querySelector("[data-leave-area-workspace], [data-toggle-workspace-map], [data-hide-workspace-brain]"), null);
  const remove = host.querySelector("[data-remove-brain-subject]");
  remove.focus();
  remove.click();
  assert.equal(removed, 1);
  assert.equal(host.querySelector("[data-brain-subject]").hidden, true, "removed subject metadata stays removed");
  assert.equal(window.document.activeElement.hasAttribute("data-launch-primary"), true, "focus moves to the stopped-Brain action when its subject control disappears");
  window.close();
});
