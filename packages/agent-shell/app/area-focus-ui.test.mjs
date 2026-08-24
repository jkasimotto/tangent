import test from "node:test";
import { assert, readFile, path, JSDOM, shellBundle, here, settle, click, submit, jsonResponse } from "./focus-shell-ui-fixture.mjs";

/** Builds one Goal for the Work projection. */
function goal(area, slug, title, assignees = ["Julian"]) {
  return {
    area, slug, title, assignees, assigneeKeys: assignees.map((name) => `${area}::${name.toLowerCase()}`),
    file: `${area}/goal-${slug}.md`, status: "active", session: `${slug}-worker`, depth: 0,
    doneWhen: "The result works.", stateText: "In progress.", currentBrief: "", storyText: "", documents: [],
    why: [], subgoalItems: [], subgoals: [], mtime: 1,
  };
}

/** Builds one live brain with one durable direct ask. */
function brain(area, name) {
  return {
    area, session: `${name}-brain`, status: "running", live: true, state: "working", generation: 1,
    requests: [{
      id: `${name}-request`, kind: "decision", subject: `${name} decision`,
      question: `Approve ${name}?`, proposal: `Use ${name}.`, detail: `${name} needs a direct answer.`, status: "open",
    }],
  };
}

test("Area Focus stages selection, scopes Work and asks, preserves return context, and recovers after deletion", async () => {
  const html = await readFile(path.join(here, "public", "shell.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.Terminal = class {
    constructor() {
      this.cols = 80; this.rows = 24; this.loadAddon = () => {};
      this.open = (host) => { this.element = host.appendChild(window.document.createElement("textarea")); };
      this.focus = () => this.element.focus(); this.onData = () => {}; this.onSelectionChange = () => ({
        /** Ends the fixture subscription. */
        dispose() {},
      });
      this.hasSelection = () => false; this.getSelection = () => ""; this.getSelectionPosition = () => null;
      this.attachCustomKeyEventHandler = () => {}; this.dispose = () => {};
    }
  };
  window.FitAddon = { FitAddon: class { constructor() { this.fit = () => {}; } } };
  window.ResizeObserver = class { constructor() { this.observe = () => {}; this.disconnect = () => {}; } };
  window.WebSocket = class { static OPEN = 1; constructor() { this.readyState = 0; this.close = () => {}; this.send = () => {}; } };
  const dockBadges = [];
  window.__agentShellNativeDockBadge = true;
  Object.defineProperty(window.navigator, "setAppBadge", {
    /** Records the complete attention count. */
    value: async (count) => dockBadges.push(count),
  });

  const alpha = goal("otto/alpha", "alpha-current", "Alpha current");
  const child = goal("otto/alpha/child", "alpha-planned", "Alpha child planned");
  const beta = goal("otto/beta", "beta-current", "Beta current");
  let vault = {
    areas: [
      { path: "otto", name: "otto", goals: [], roster: ["Julian"], rosterArea: "otto" },
      { path: "otto/alpha", name: "alpha", goals: [alpha], roster: ["Julian"], rosterArea: "otto/alpha" },
      { path: "otto/alpha/child", name: "child", goals: [child], roster: ["Julian"], rosterArea: "otto/alpha/child" },
      { path: "otto/beta", name: "beta", goals: [beta], roster: ["Julian"], rosterArea: "otto/beta" },
      { path: "otto/gamma", name: "gamma", goals: [], roster: [], rosterArea: "otto/gamma" },
    ],
    map: [
      { path: alpha.area, name: "alpha", goals: [alpha] },
      { path: child.area, name: "child", goals: [child] },
      { path: beta.area, name: "beta", goals: [beta] },
    ],
    documents: [],
  };
  const brains = [brain("otto/alpha", "Alpha"), brain("otto/beta", "Beta")];
  const sessions = [
    { name: alpha.session, goal: alpha.file, area: alpha.area, state: "working", command: "codex" },
    { name: beta.session, goal: beta.file, area: beta.area, state: "working", command: "codex" },
    ...brains.map((item) => ({ name: item.session, area: item.area, kind: "brain", state: "working", command: "codex" })),
  ];
  window.fetch = async (url) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (pathname === "/api/sessions") return jsonResponse({ boot: "focus-boot", sessions, pipelines: [], brains });
    if (pathname === "/api/programs") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    return jsonResponse(vault);
  };

  window.eval(shellBundle);
  await settle(window);
  assert.ok(window.document.querySelector('[data-desk-area="otto/alpha"]'));
  assert.ok(window.document.querySelector('[data-desk-area="otto/beta"]'));
  assert.equal(window.document.querySelector(".attention-queue > header > span").textContent, "2");

  click(window, "[data-open-area-focus]");
  await settle(window);
  const search = window.document.querySelector("#area-focus-search");
  assert.equal(window.document.activeElement, search);
  search.value = "alpha";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  const childChoice = window.document.querySelector('[data-area-focus-path="otto/alpha/child"]');
  childChoice.checked = true;
  childChoice.dispatchEvent(new window.Event("change", { bubbles: true }));
  const alphaChoice = window.document.querySelector('[data-area-focus-path="otto/alpha"]');
  alphaChoice.checked = true;
  alphaChoice.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.ok(window.document.querySelector('[data-desk-area="otto/beta"]'), "staged changes do not rebuild or scope Work");
  submit(window, "[data-area-focus-form]");

  assert.ok(window.document.querySelector('[data-desk-area="otto/alpha"]'));
  assert.equal(window.document.querySelector('[data-desk-area="otto/beta"]'), null);
  assert.match(window.document.querySelector(".area-focus-summary").textContent, /Focus:\s*Alpha/);
  assert.equal(window.document.querySelector(".attention-queue > header > span").textContent, "2 total");
  assert.equal(window.document.querySelector(".attention-focus-count").textContent, "1 shown in Focus · 1 outside Focus");
  assert.equal(window.document.querySelector("#work-tab").textContent, "Work · 2");
  assert.equal(dockBadges.at(-1), 2, "the Dock badge keeps the complete For you total");
  assert.equal(window.document.querySelectorAll(".attention-row").length >= 1, true);
  assert.deepEqual(JSON.parse(window.localStorage.getItem("agent-shell.area-focus.v1")), {
    schema: "agent-shell.area-focus.v1", areas: ["otto/alpha"],
  });

  click(window, '[data-person-value="mine"]');
  const focusedSearch = window.document.querySelector("#work-search");
  focusedSearch.value = "alpha";
  focusedSearch.dispatchEvent(new window.Event("input", { bubbles: true }));
  window.document.querySelector("#screen").scrollTop = 137;
  click(window, `[data-open-goal-run="${alpha.file}"]`);
  assert.ok(window.document.querySelector(`#agent-terminal[data-session="${alpha.session}"]`));
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle(window);
  assert.match(window.document.querySelector(".area-focus-summary").textContent, /Alpha/);
  assert.equal(window.document.querySelector("#work-search").value, "alpha");
  assert.equal(window.document.querySelector('[data-person-value="mine"]').getAttribute("aria-checked"), "true");
  assert.equal(window.document.querySelector("#screen").scrollTop, 137, "worker Escape restores the Work scroll position");

  click(window, '[data-work-filter="inactive"]');
  const workSearch = window.document.querySelector("#work-search");
  assert.ok(window.document.querySelector('[data-desk-area="otto/alpha"]'));
  assert.equal(window.document.querySelector('[data-desk-area="otto/beta"]'), null, "secondary filters cannot reveal an Area outside Focus");
  assert.equal(window.document.querySelectorAll(`[data-open-goal-run="${child.file}"]`).length, 1, "overlapping staged roots do not duplicate descendant work");

  click(window, '[data-desk-area="otto/alpha"] [data-open-brain]');
  assert.ok(window.document.querySelector("#describe-work-terminal[data-session='Alpha-brain']"));
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.match(window.document.querySelector(".area-focus-summary").textContent, /Alpha/);
  assert.equal(window.document.querySelector("#work-search").value, "alpha");
  assert.equal(window.document.querySelector('[data-work-filter="inactive"]').getAttribute("aria-pressed"), "true");
  assert.equal(window.document.querySelector('[data-person-value="mine"]').getAttribute("aria-checked"), "true");

  const returnedSearch = window.document.querySelector("#work-search");
  returnedSearch.value = "";
  returnedSearch.dispatchEvent(new window.Event("input", { bubbles: true }));
  click(window, "[data-clear-area-focus]");
  assert.equal(window.localStorage.getItem("agent-shell.area-focus.v1"), null);
  assert.ok(window.document.querySelector('[data-desk-area="otto/beta"]'), "Clear restores complete Work inside the remaining filters");

  click(window, "[data-open-area-focus]");
  const pickerSearch = window.document.querySelector("#area-focus-search");
  pickerSearch.value = "gamma";
  pickerSearch.dispatchEvent(new window.Event("input", { bubbles: true }));
  const gammaChoice = window.document.querySelector('[data-area-focus-path="otto/gamma"]');
  gammaChoice.checked = true;
  gammaChoice.dispatchEvent(new window.Event("change", { bubbles: true }));
  submit(window, "[data-area-focus-form]");
  assert.ok(window.document.querySelector('[data-desk-area="otto/gamma"]'), "a focused Area remains visible without matching work");
  assert.match(window.document.querySelector('[data-desk-area="otto/gamma"] .area-focus-empty').textContent, /No planned work matches/);

  vault = {
    ...vault,
    areas: vault.areas.filter((area) => area.path !== "otto/gamma"),
  };
  await window.refresh();
  await settle(window);
  assert.equal(window.localStorage.getItem("agent-shell.area-focus.v1"), null, "the stale final root clears on refresh");
  assert.equal(window.document.querySelector(".area-focus-summary"), null);
  assert.ok(window.document.querySelector('[data-desk-area="otto/beta"]'), "stale Focus recovery restores complete Work");
  dom.window.close();
});
