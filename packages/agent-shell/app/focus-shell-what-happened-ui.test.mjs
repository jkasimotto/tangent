import test from "node:test";
import { assert, readFile, path, JSDOM, documentComments, areaMapView, shellBundle, here, goToCore, goalCardCore, askCore, settle, click, submit, openDocumentViaGoTo, jsonResponse } from "./focus-shell-ui-fixture.mjs";

test("What happened shows an Area's closed work from the last 12 hours, one overlay at a time, and Esc leaves the desk unchanged", async () => {
  const [html, script, mapCore, mapView, whatHappenedCore] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
    readFile(path.join(here, "public", "area-map-core.js"), "utf8"),
    readFile(path.join(here, "public", "area-map.js"), "utf8"),
    readFile(path.join(here, "public", "what-happened-core.js"), "utf8"),
  ]);
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  const HOUR = 3_600_000;
  const now = Date.now();

  const dndGoal = {
    mtime: 1, area: "otto/dnd", slug: "ship-the-map", file: "otto/dnd/goal-ship-the-map.md", title: "Ship the map", status: "open",
    doneWhen: "Shipped.", stateText: "", currentBrief: "", storyText: "", documents: [], why: [], subgoalItems: [], subgoals: [], depth: 0,
  };
  const tangentGoal = {
    mtime: 1, area: "otto/tangent", slug: "write-docs", file: "otto/tangent/goal-write-docs.md", title: "Write the docs", status: "open",
    doneWhen: "Docs exist.", stateText: "", currentBrief: "", storyText: "", documents: [], why: [], subgoalItems: [], subgoals: [], depth: 0,
  };
  const oldThing = {
    mtime: 1, area: "otto/dnd", slug: "old-thing", file: "otto/dnd/goal-old-thing.md", title: "Old thing", status: "done",
    doneWhen: "It works.", stateText: "", currentBrief: "", storyText: "", documents: [], why: [], subgoalItems: [], subgoals: [], depth: 0,
  };
  const childThing = {
    mtime: 1, area: "otto/dnd/maps", slug: "child-thing", file: "otto/dnd/maps/goal-child-thing.md", title: "Child thing", status: "dropped",
    doneWhen: "", stateText: "### Won't do\n\nToo niche for now.", currentBrief: "", storyText: "", documents: [], why: [], subgoalItems: [], subgoals: [], depth: 0,
  };
  const recentCloses = [
    { file: "otto/dnd/goal-old-thing.md", kind: "done", at: now - 2 * HOUR, session: "tangent-brain-g6" },
    { file: "otto/dnd/maps/goal-child-thing.md", kind: "wontdo", at: now - 3 * HOUR, session: null },
    { file: "otto/dnd/goal-ancient.md", kind: "done", at: now - 13 * HOUR, session: null },
  ];

  const calls = [];
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    calls.push({ pathname, method: options.method ?? "GET" });
    if (options.method === "POST") return jsonResponse({ ok: true });
    if (pathname === "/api/sessions") return jsonResponse({ boot: "boot-1", caffeinate: false, sessions: [] });
    if (pathname === "/api/programs") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    if (pathname === "/api/map-state") return jsonResponse({ area: "otto/dnd", state: null });
    if (pathname === "/api/document") return jsonResponse({ file: oldThing.file, kind: "goal", text: "# Old thing\n", hash: "h1", comments: [] });
    return jsonResponse({
      areas: [
        { path: "otto", name: "otto", goals: [], documents: [], children: ["otto/dnd", "otto/tangent"], parent: "" },
        { path: "otto/dnd", name: "dnd", goals: [dndGoal, oldThing], documents: [], children: ["otto/dnd/maps"], parent: "otto" },
        { path: "otto/dnd/maps", name: "maps", goals: [childThing], documents: [], children: [], parent: "otto/dnd" },
        { path: "otto/tangent", name: "tangent", goals: [tangentGoal], documents: [], children: [], parent: "otto" },
      ],
      map: [
        { path: "otto/dnd", name: "dnd", goals: [dndGoal, oldThing] },
        { path: "otto/dnd/maps", name: "maps", goals: [childThing] },
        { path: "otto/tangent", name: "tangent", goals: [tangentGoal] },
      ],
      documents: [],
      recentCloses,
    });
  };
  window.eval(shellBundle);
  await settle(window);

  const panels = [...window.document.querySelectorAll(".area-desk-panel")];
  const dndPanel = panels.find((node) => node.textContent.includes("Ship the map"));
  const tangentPanel = panels.find((node) => node.textContent.includes("Write the docs"));
  assert.ok(dndPanel, "dnd is a desk panel");
  assert.ok(tangentPanel, "tangent is a desk panel");
  const panelTitles = panels.map((panel) => panel.querySelector("h2").textContent);

  const dndButton = dndPanel.querySelector("[data-what-happened-for]");
  assert.equal(dndButton.textContent.trim(), "What happened", "the action is plain text, no count or badge");
  dndButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);

  let overlay = window.document.querySelector("[data-what-happened]");
  assert.ok(overlay, "the overlay opens");
  let rows = [...overlay.querySelectorAll(".what-happened-row")];
  assert.equal(rows.length, 2, "the 13-hour close is absent");
  const doneRow = rows.find((row) => row.dataset.openClose === "otto/dnd/goal-old-thing.md");
  assert.ok(doneRow);
  assert.match(doneRow.querySelector(".what-happened-kind").textContent, /done/);
  assert.equal(doneRow.querySelector(".what-happened-closer").textContent, "brain g6");
  assert.match(doneRow.querySelector(".what-happened-title").textContent, /^Old thing/);
  const childRow = rows.find((row) => row.dataset.openClose === "otto/dnd/maps/goal-child-thing.md");
  assert.ok(childRow);
  assert.match(childRow.querySelector(".what-happened-kind").textContent, /won.?t do/);
  assert.ok(childRow.querySelector(".what-happened-area"), "the child-Area row carries the dim Area suffix");

  // Escape closes the overlay; the desk under it has not moved.
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle(window);
  assert.equal(window.document.querySelector("[data-what-happened]"), null, "Escape closes the overlay");
  const panelsAfterEscape = [...window.document.querySelectorAll(".area-desk-panel")];
  assert.deepEqual(panelsAfterEscape.map((panel) => panel.querySelector("h2").textContent), panelTitles, "the desk still holds the same panels");

  // A click on another panel's button swaps the overlay to that Area; an empty window says so.
  // (A repaint replaces the desk DOM, so panels and buttons must be re-queried live.)
  /** Finds a panel's What happened button by a title that appears in it. */
  const findWhatHappenedButton = (titleText) => {
    const panel = [...window.document.querySelectorAll(".area-desk-panel")].find((node) => node.textContent.includes(titleText));
    return panel.querySelector("[data-what-happened-for]");
  };
  findWhatHappenedButton("Write the docs").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  overlay = window.document.querySelector("[data-what-happened]");
  assert.ok(overlay, "the tangent overlay opens");
  assert.match(overlay.getAttribute("aria-label"), /Tangent/);
  assert.match(overlay.querySelector(".what-happened-empty").textContent, /Nothing was marked done or won't do/);

  // Reopen dnd's overlay and click its done row: it opens the Goal file in the reader.
  findWhatHappenedButton("Ship the map").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  overlay = window.document.querySelector("[data-what-happened]");
  rows = [...overlay.querySelectorAll(".what-happened-row")];
  rows.find((row) => row.dataset.openClose === "otto/dnd/goal-old-thing.md").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  assert.ok(calls.some((call) => call.pathname === "/api/document"), "the row click fetches the Document");
});
