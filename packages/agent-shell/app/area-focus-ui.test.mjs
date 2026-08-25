import test from "node:test";
import { assert, readFile, path, JSDOM, shellBundle, here, settle, click, submit, openDocumentViaGoTo, jsonResponse } from "./focus-shell-ui-fixture.mjs";

/** Builds one Goal for the Work projection. */
function goal(area, slug, title) {
  return {
    area, slug, title,
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
  const childProgram = {
    id: "process:otto/alpha/child:preview", area: "otto/alpha/child", type: "process",
    label: "Child preview", command: "npm run preview", available: true, session: null,
  };
  const programOnly = {
    id: "command:otto/delta:audit", area: "otto/delta", type: "command",
    label: "Delta audit", command: "npm run audit", available: true, session: null,
  };
  const alphaDocument = {
    file: "otto/alpha/focus-notes.md", area: "otto/alpha", kind: "document",
    title: "Alpha focus notes", searchText: "alpha focus notes", mtime: 1,
  };
  let vault = {
    areas: [
      { path: "otto", name: "otto", goals: [] },
      { path: "otto/alpha", name: "alpha", goals: [alpha] },
      { path: "otto/alpha/child", name: "child", goals: [child] },
      { path: "otto/beta", name: "beta", goals: [beta] },
      { path: "otto/delta", name: "delta", goals: [] },
      { path: "otto/gamma", name: "gamma", goals: [] },
    ],
    map: [
      { path: alpha.area, name: "alpha", goals: [alpha] },
      { path: child.area, name: "child", goals: [child] },
      { path: beta.area, name: "beta", goals: [beta] },
    ],
    documents: [alphaDocument],
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
    if (pathname === "/api/programs") return jsonResponse({ programs: [childProgram, programOnly], errors: [], areas: [], liveCount: 0 });
    if (pathname === "/api/document") return jsonResponse({ ...alphaDocument, text: "# Alpha focus notes\n\nFocused context stays exact.", hash: "alpha-focus" });
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
  assert.equal(window.document.activeElement.dataset.areaFocusPath, "otto/alpha/child", "a checkbox change keeps the native keyboard path active");
  const alphaChoice = window.document.querySelector('[data-area-focus-path="otto/alpha"]');
  alphaChoice.checked = true;
  alphaChoice.dispatchEvent(new window.Event("change", { bubbles: true }));
  const betaSearch = window.document.querySelector("#area-focus-search");
  betaSearch.value = "beta";
  betaSearch.dispatchEvent(new window.Event("input", { bubbles: true }));
  const betaChoice = window.document.querySelector('[data-area-focus-path="otto/beta"]');
  betaChoice.checked = true;
  betaChoice.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.ok(window.document.querySelector('[data-desk-area="otto/beta"]'), "staged changes do not rebuild or scope Work");
  submit(window, "[data-area-focus-form]");

  assert.ok(window.document.querySelector('[data-desk-area="otto/alpha"]'));
  assert.ok(window.document.querySelector('[data-desk-area="otto/beta"]'), "independent selected roots remain visible together");
  const panelPaths = [...window.document.querySelectorAll("[data-desk-area]")].map((panel) => panel.dataset.deskArea);
  assert.equal(new Set(panelPaths).size, panelPaths.length, "multiple roots do not duplicate Area panels");
  assert.equal(window.document.querySelectorAll('[data-program-area="otto/alpha/child"] .desk-program').length, 1, "a selected parent includes its descendant Program once");
  assert.equal(window.document.querySelector(".attention-focus-count").textContent, "2 shown in Focus · 0 outside Focus");
  assert.deepEqual(JSON.parse(window.localStorage.getItem("agent-shell.area-focus.v1")), {
    schema: "agent-shell.area-focus.v1", areas: ["otto/alpha", "otto/beta"],
  });

  click(window, "[data-change-area-focus]");
  const cancelSearch = window.document.querySelector("#area-focus-search");
  cancelSearch.value = "beta";
  cancelSearch.dispatchEvent(new window.Event("input", { bubbles: true }));
  const cancelBeta = window.document.querySelector('[data-area-focus-path="otto/beta"]');
  cancelBeta.checked = false;
  cancelBeta.dispatchEvent(new window.Event("change", { bubbles: true }));
  click(window, "[data-cancel-area-focus]");
  assert.ok(window.document.querySelector('[data-desk-area="otto/beta"]'), "Cancel keeps the applied multi-Area scope");

  click(window, "[data-change-area-focus]");
  const changeSearch = window.document.querySelector("#area-focus-search");
  changeSearch.value = "beta";
  changeSearch.dispatchEvent(new window.Event("input", { bubbles: true }));
  const changeBeta = window.document.querySelector('[data-area-focus-path="otto/beta"]');
  changeBeta.checked = false;
  changeBeta.dispatchEvent(new window.Event("change", { bubbles: true }));
  submit(window, "[data-area-focus-form]");

  assert.equal(window.document.querySelector('[data-desk-area="otto/beta"]'), null);
  assert.match(window.document.querySelector(".area-focus-summary").textContent, /Focus:\s*Alpha/);
  assert.equal(window.document.querySelector(".attention-queue > header > span").textContent, "2 total");
  assert.equal(window.document.querySelector(".attention-focus-count").textContent, "1 shown in Focus · 1 outside Focus");
  assert.equal(window.document.querySelector("#work-tab").textContent, "Work · 2");
  assert.equal(dockBadges.at(-1), 2, "the Dock badge keeps the complete For you total");
  assert.equal(window.document.querySelectorAll(".ask-row").length >= 1, true);
  assert.deepEqual(JSON.parse(window.localStorage.getItem("agent-shell.area-focus.v1")), {
    schema: "agent-shell.area-focus.v1", areas: ["otto/alpha"],
  });

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
  assert.equal(window.document.querySelector("#screen").scrollTop, 137, "worker Escape restores the Work scroll position");

  await openDocumentViaGoTo(window, alphaDocument.title);
  assert.ok(window.document.querySelector(".document-reader"));
  click(window, "#back-button");
  assert.match(window.document.querySelector(".area-focus-summary").textContent, /Alpha/);
  assert.equal(window.document.querySelector("#work-search").value, "alpha", "Document Back restores the focused Work query");

  click(window, `[data-open-goal-run="${alpha.file}"]`);
  click(window, "#back-button");
  await settle(window);
  assert.match(window.document.querySelector(".area-focus-summary").textContent, /Alpha/);
  assert.equal(window.document.querySelector("#work-search").value, "alpha", "worker Back restores focused Work");

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

  const returnedSearch = window.document.querySelector("#work-search");
  returnedSearch.value = "";
  returnedSearch.dispatchEvent(new window.Event("input", { bubbles: true }));
  click(window, "[data-clear-area-focus]");
  assert.equal(window.localStorage.getItem("agent-shell.area-focus.v1"), null);
  assert.ok(window.document.querySelector('[data-desk-area="otto/beta"]'), "Clear restores complete Work inside the remaining filters");

  click(window, "[data-open-area-focus]");
  const programSearch = window.document.querySelector("#area-focus-search");
  programSearch.value = "delta";
  programSearch.dispatchEvent(new window.Event("input", { bubbles: true }));
  const deltaChoice = window.document.querySelector('[data-area-focus-path="otto/delta"]');
  deltaChoice.checked = true;
  deltaChoice.dispatchEvent(new window.Event("change", { bubbles: true }));
  submit(window, "[data-area-focus-form]");
  assert.equal(window.document.querySelectorAll('[data-program-area="otto/delta"] .desk-program').length, 1, "a Program-only Focus renders its relevant work");
  assert.equal(window.document.querySelector('[data-desk-area="otto/delta"] .area-focus-empty'), null, "a visible Program is not an empty Focus");
  click(window, "[data-clear-area-focus]");

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

  click(window, '[data-work-filter="active"]');
  click(window, "[data-open-area-focus]");
  const awaySearch = window.document.querySelector("#area-focus-search");
  awaySearch.value = "otto/alpha";
  awaySearch.dispatchEvent(new window.Event("input", { bubbles: true }));
  const awayChoice = window.document.querySelector('[data-area-focus-path="otto/alpha"]');
  awayChoice.checked = true;
  awayChoice.dispatchEvent(new window.Event("change", { bubbles: true }));
  submit(window, "[data-area-focus-form]");
  click(window, `[data-open-goal-run="${alpha.file}"]`);
  vault = {
    ...vault,
    areas: vault.areas.filter((area) => !area.path.startsWith("otto/alpha")),
  };
  await window.refresh();
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle(window);
  assert.equal(window.localStorage.getItem("agent-shell.area-focus.v1"), null, "return cannot restore a Focus root removed while the worker was open");
  assert.equal(window.document.querySelector(".area-focus-summary"), null, "stale return context restores complete Work");
  dom.window.close();
});
