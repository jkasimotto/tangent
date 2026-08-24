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
      this.onSelectionChange = () => ({});
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
    if (pathname === "/api/programs") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
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
  const rootAction = window.document.querySelector(`[data-goal-anchor='${parent.file}'] .desk-brain-action`);
  const subgoalAction = window.document.querySelector(`[data-goal-anchor='${subgoal.file}'] .desk-brain-action`);
  const nestedAction = window.document.querySelector(`[data-goal-anchor='${nested.file}'] .desk-brain-action`);
  assert.equal(rootAction.textContent, "Open brain");
  assert.equal(rootAction.dataset.openBrain, "tangent-brain");
  assert.equal(rootAction.getAttribute("aria-label"), "Open brain for Goal Parent result, Otto / Tangent");
  assert.equal(rootAction.title, "Open Otto / Tangent brain");
  assert.equal(subgoalAction.dataset.openBrain, "tangent-brain", "Subgoals resolve from their own Area");
  assert.equal(nestedAction.dataset.openBrain, "nested-brain", "the live child replaces the parent inside its subtree");
  assert.equal(window.document.querySelector(`[data-goal-anchor='${orphan.file}'] .desk-brain-action`), null);

  const user = userEvent.setup({ document: window.document });
  rootAction.focus();
  await user.keyboard("{Enter}");
  assert.ok(window.document.querySelector("#describe-work-terminal[data-session='tangent-brain']"));
  assert.equal(terminalFocusCount, 1, "opening from a Goal card focuses the terminal");
  assert.equal(window.document.activeElement.tagName, "TEXTAREA");
  click(window, "#back-button");
  assert.equal(window.document.querySelector("#work-search").value, "");

  const workSearch = window.document.querySelector("#work-search");
  workSearch.value = "parent";
  workSearch.dispatchEvent(new window.Event("input", { bubbles: true }));
  const filteredAction = window.document.querySelector(`[data-goal-anchor='${parent.file}'] .desk-brain-action`);
  filteredAction.focus();
  await user.keyboard(" ");
  assert.ok(window.document.querySelector("#describe-work-terminal[data-session='tangent-brain']"));
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(window.document.querySelector("#work-search").value, "parent", "Escape restores the Work filter");

  click(window, `[data-goal-anchor='${parent.file}'] .desk-brain-action`);
  const terminal = window.document.querySelector("#describe-work-terminal[data-session='tangent-brain']");
  const repeatedAction = window.document.createElement("button");
  repeatedAction.dataset.openBrain = "tangent-brain";
  terminal.append(repeatedAction);
  repeatedAction.click();
  click(window, "#back-button");
  assert.equal(window.document.querySelector("#work-search").value, "parent", "a duplicate activation keeps the first return point");

  sessionProjection.splice(sessionProjection.findIndex((item) => item.name === "tangent-brain"), 1);
  click(window, `[data-goal-anchor='${parent.file}'] .desk-brain-action`);
  assert.ok(window.document.querySelector(".work-page"), "a stale click keeps Work visible");
  assert.equal(window.document.querySelector("#toast").textContent, "The brain session is not live.");

  parentLive = false;
  await window.refresh();
  await settle(window);
  assert.equal(window.document.querySelector(`[data-goal-anchor='${parent.file}'] .desk-brain-action`), null, "refresh removes an ended owner");
  childLive = false;
  sessionProjection = goalSessions;
  await window.refresh();
  await settle(window);
  assert.equal(window.document.querySelector(`[data-goal-anchor='${nested.file}'] .desk-brain-action`), null);
  dom.window.close();
});

test("the Goal brain action wraps inside standard and narrow cards", async () => {
  const [html, css] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.css"), "utf8"),
  ]);
  const dom = new JSDOM(html, { runScripts: "outside-only" });
  const style = dom.window.document.createElement("style");
  style.textContent = css;
  dom.window.document.head.append(style);
  const row = dom.window.document.createElement("article");
  row.className = "desk-goal";
  row.innerHTML = `<div class="desk-goal-main"><div class="desk-goal-line2"><span class="desk-goal-status">Working</span><span class="desk-goal-actions"><button class="desk-brain-action">Open brain</button><button class="desk-action">Open</button><details class="desk-action-menu"><summary>Actions</summary></details></span></div></div>`;
  dom.window.document.body.append(row);

  for (const width of [560, 260]) {
    row.style.width = `${width}px`;
    assert.equal(dom.window.getComputedStyle(row.querySelector(".desk-goal-line2")).flexWrap, "wrap", `${width}px cards wrap their second line`);
    assert.equal(dom.window.getComputedStyle(row.querySelector(".desk-goal-actions")).position, "", `${width}px actions stay in normal flow`);
    assert.equal(dom.window.getComputedStyle(row.querySelector(".desk-brain-action")).whiteSpace, "nowrap", `${width}px keeps the short label intact`);
  }
  dom.window.close();
});
