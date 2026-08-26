import test from "node:test";
import userEvent from "@testing-library/user-event";
import { assert, readFile, path, JSDOM, shellBundle, here, settle, click, jsonResponse } from "./focus-shell-ui-fixture.mjs";

/** Creates one compact Goal fixture, with an optional parent relation. */
function goal(area, slug, title, { depth = 0, parent = null } = {}) {
  const file = `${area}/goal-${slug}.md`;
  return {
    mtime: 1, area, slug, file, title, status: "active", session: `${slug}-agent`, doneWhen: "Done.",
    stateText: "In progress.", currentBrief: "", storyText: "", documents: [], depth,
    why: parent ? [{ file: parent.file, title: parent.title, doneWhen: parent.doneWhen, status: parent.status }] : [],
    subgoalItems: [], subgoals: [],
  };
}

test("Goal cards open their nearest live brain and preserve Work context", async () => {
  const html = await readFile(path.join(here, "public", "shell.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  let terminalFocusCount = 0;
  window.Terminal = class {
    constructor() {
      this.cols = 80;
      this.rows = 24;
      this.loadAddon = () => {};
      this.open = (host) => { this.element = host.appendChild(window.document.createElement("textarea")); };
      this.focus = () => { terminalFocusCount += 1; this.element.focus(); };
      this.onData = () => {};
      this.onSelectionChange = () => ({
        /** Ends the selection subscription. */
        dispose() {},
      });
      this.hasSelection = () => false;
      this.getSelection = () => "";
      this.getSelectionPosition = () => null;
      this.attachCustomKeyEventHandler = () => {};
      this.dispose = () => {};
    }
  };
  window.FitAddon = { FitAddon: class { constructor() { this.fit = () => {}; } } };
  window.ResizeObserver = class { constructor() { this.observe = () => {}; this.disconnect = () => {}; } };
  window.WebSocket = class {
    static OPEN = 1;
    constructor() { this.readyState = 0; this.close = () => {}; this.send = () => {}; }
  };

  const parent = goal("otto/tangent", "parent", "Parent result");
  const subgoal = goal("otto/tangent", "subgoal", "Child step", { depth: 1, parent });
  parent.subgoalItems = [{ file: subgoal.file, title: subgoal.title, doneWhen: subgoal.doneWhen, status: subgoal.status }];
  parent.subgoals = [subgoal.slug];
  const nested = goal("otto/tangent/nested", "nested", "Nested result");
  const orphan = goal("other/place", "orphan", "Orphan result");
  let childLive = true;
  let parentLive = true;
  const goalSessions = [parent, subgoal, nested, orphan].map((item) => ({ name: item.session, goal: item.file, state: "working", command: "codex" }));
  let sessionProjection = [
    ...goalSessions,
    { name: "tangent-brain", area: "otto/tangent", kind: "brain", state: "working" },
    { name: "nested-brain", area: "otto/tangent/nested", kind: "brain", state: "working" },
  ];

  window.fetch = async (url) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (pathname === "/api/sessions") {
      const brains = [
        { area: "otto/tangent", status: "running", live: parentLive, session: "tangent-brain", generation: 1 },
        { area: "otto/tangent/nested", status: "running", live: childLive, session: "nested-brain", generation: 1 },
      ];
      return jsonResponse({ boot: "boot-1", caffeinate: false, pipelines: [], sessions: sessionProjection, brains });
    }
    if (pathname === "/api/operations") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    return jsonResponse({
      areas: [
        { path: "otto", name: "otto", goals: [] },
        { path: "otto/tangent", name: "tangent", goals: [parent, subgoal], documents: [] },
        { path: "otto/tangent/nested", name: "nested", goals: [nested], documents: [] },
        { path: "other", name: "other", goals: [] },
        { path: "other/place", name: "place", goals: [orphan], documents: [] },
      ],
      map: [
        { path: "otto/tangent", name: "tangent", goals: [parent, subgoal] },
        { path: "otto/tangent/nested", name: "nested", goals: [nested] },
        { path: "other/place", name: "place", goals: [orphan] },
      ],
      documents: [],
    });
  };

  window.eval(shellBundle);
  await settle(window);
  /** The one brain route of the row group that holds one Goal row. */
  const groupBrain = (file) => window.document.querySelector(`[data-goal-anchor='${file}']`).closest("tbody").querySelector(".work-group-brain");
  const rootAction = groupBrain(parent.file);
  assert.equal(rootAction.querySelector(".work-group-brain-long").textContent, "Open brain");
  assert.equal(rootAction.dataset.openBrain, "tangent-brain");
  assert.equal(rootAction.getAttribute("aria-label"), "Open brain for Otto / Tangent");
  assert.equal(groupBrain(subgoal.file), rootAction, "a Subgoal reads the same group route as its parent");
  assert.equal(groupBrain(nested.file).dataset.openBrain, "nested-brain", "the live child owns its own row group");
  assert.equal(groupBrain(orphan.file).dataset.openBrain, undefined, "an Area with no brain offers Start instead");
  assert.equal(groupBrain(orphan.file).querySelector(".work-group-brain-long").textContent, "Start brain");
  assert.equal(window.document.querySelector(".desk-brain-action"), null, "no row repeats the group's brain route");

  const user = userEvent.setup({ document: window.document });
  rootAction.focus();
  await user.keyboard("{Enter}");
  assert.equal(window.document.querySelector("#session-layer-terminal").dataset.session, "tangent-brain");
  assert.equal(terminalFocusCount, 1, "opening from a Goal card focuses the terminal");
  assert.equal(window.document.activeElement.tagName, "TEXTAREA");
  click(window, "#session-layer");
  assert.equal(window.document.querySelector("#work-search").value, "");

  const workSearch = window.document.querySelector("#work-search");
  workSearch.value = "parent";
  workSearch.dispatchEvent(new window.Event("input", { bubbles: true }));
  const filteredAction = groupBrain(parent.file);
  filteredAction.focus();
  await user.keyboard(" ");
  assert.equal(window.document.querySelector("#session-layer-terminal").dataset.session, "tangent-brain");
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "j", metaKey: true, bubbles: true }));
  assert.equal(window.document.querySelector("#work-search").value, "parent", "Command-J restores the Work filter");

  groupBrain(parent.file).click();
  const terminal = window.document.querySelector("#session-layer-terminal[data-session='tangent-brain']");
  const repeatedAction = window.document.createElement("button");
  repeatedAction.dataset.openBrain = "tangent-brain";
  terminal.append(repeatedAction);
  repeatedAction.click();
  click(window, "#session-layer");
  assert.equal(window.document.querySelector("#work-search").value, "parent", "a duplicate activation keeps the first return point");

  sessionProjection.splice(sessionProjection.findIndex((item) => item.name === "tangent-brain"), 1);
  groupBrain(parent.file).click();
  assert.ok(window.document.querySelector(".work-page"), "a stale click keeps Work visible");
  assert.equal(window.document.querySelector("#toast").textContent, "The brain session is not live.");

  parentLive = false;
  await window.refresh();
  await settle(window);
  assert.equal(groupBrain(parent.file).dataset.openBrain, undefined, "refresh turns an ended owner back into Resume");
  assert.equal(groupBrain(parent.file).querySelector(".work-group-brain-long").textContent, "Resume brain");
  childLive = false;
  sessionProjection = goalSessions;
  await window.refresh();
  await settle(window);
  assert.equal(groupBrain(nested.file).querySelector(".work-group-brain-long").textContent, "Resume brain");
  dom.window.close();
});

test("the group brain action keeps one label per width and never wraps", async () => {
  const [html, css] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.css"), "utf8"),
  ]);
  const dom = new JSDOM(html, { runScripts: "outside-only" });
  const style = dom.window.document.createElement("style");
  style.textContent = css;
  dom.window.document.head.append(style);
  const button = dom.window.document.createElement("button");
  button.className = "work-group-brain";
  button.setAttribute("aria-label", "Open brain for Otto / Tangent");
  button.innerHTML = `<span class="work-group-brain-long">Open brain</span><span class="work-group-brain-short">Brain</span>`;
  dom.window.document.body.append(button);

  /** The computed style of one label span inside the group action. */
  const styleOf = (selector) => dom.window.getComputedStyle(button.querySelector(selector));
  assert.equal(dom.window.getComputedStyle(button).whiteSpace, "nowrap", "the group action never wraps");
  assert.equal(styleOf(".work-group-brain-long").display, "inline", "the wide label is the visible one by default");
  assert.equal(styleOf(".work-group-brain-short").display, "none", "the narrow label is hidden by default");
  assert.equal(button.getAttribute("aria-label"), "Open brain for Otto / Tangent", "the accessible name names the Area at every width");
  dom.window.close();
});
