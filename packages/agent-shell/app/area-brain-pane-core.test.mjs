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
    onToggleMap: noop, onHideBrain: noop, onLeave: noop, onResume: noop,
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
      onToggleMap: noop, onHideBrain: noop, onLeave: noop, onResume: noop, onSeedStart: noop,
    });
    const instance = descriptor.mount({ host });
    instance.focus();
    assert.equal(window.document.activeElement.hasAttribute("data-launch-primary"), true, `${brain ? "stopped" : "absent"} Brain focus reaches its launch action`);
    assert.equal(window.document.activeElement.hasAttribute("data-leave-area-workspace"), false, "the pane does not pretend Work is the Brain action");
    window.close();
  }
});
