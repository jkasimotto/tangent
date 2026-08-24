import test from "node:test";
import { assert, readFile, path, JSDOM, documentComments, areaMapView, shellBundle, here, goToCore, goalCardCore, askCore, settle, click, submit, openDocumentViaGoTo, jsonResponse } from "./focus-shell-ui-fixture.mjs";

test("current and planned work keep stable Area order", async () => {
  const [html, script, mapCore, mapView] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
    readFile(path.join(here, "public", "area-map-core.js"), "utf8"),
    readFile(path.join(here, "public", "area-map.js"), "utf8"),
  ]);
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  const DAY = 86_400_000;
  const now = Date.now();
  // Current work stays separate from unstarted work. Planned Areas keep stable path order.
  const megabranchGoal = {
    mtime: 1, area: "otto/megabranch", slug: "old-goal", file: "otto/megabranch/goal-old.md",
    title: "Old megabranch goal", status: "open", doneWhen: "Done.", changedAt: now - 60 * DAY, waitingOn: "", depth: 0,
  };
  const standardsGoal = {
    mtime: 2, area: "otto/standards", slug: "old-standards-goal", file: "otto/standards/goal-old.md",
    title: "Old standards goal", status: "open", doneWhen: "Done.", changedAt: now - 45 * DAY, waitingOn: "", depth: 0,
  };
  const dndGoal = {
    mtime: 3, area: "otto/dnd", slug: "working-goal", file: "otto/dnd/goal-working.md",
    title: "D&D goal in progress", status: "open", doneWhen: "Done.", changedAt: now - 1 * DAY, waitingOn: "", session: "dnd--working", depth: 0,
  };
  const tangentGoal = {
    mtime: 4, area: "otto/tangent", slug: "recent-goal", file: "otto/tangent/goal-recent.md",
    title: "Tangent goal recently touched", status: "open", doneWhen: "Done.", changedAt: now - 2 * DAY, waitingOn: "", depth: 0,
  };
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (options.method === "POST") return jsonResponse({ ok: true });
    if (pathname === "/api/sessions") {
      return jsonResponse({ boot: "boot-1", caffeinate: false, pipelines: [], sessions: [{ name: "dnd--working", goal: dndGoal.file, state: "working", command: "codex" }] });
    }
    if (pathname === "/api/programs") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    return jsonResponse({
      areas: [
        { path: "otto", name: "otto", goals: [] },
        { path: "otto/megabranch", name: "megabranch", goals: [megabranchGoal], documents: [] },
        { path: "otto/standards", name: "standards", goals: [standardsGoal], documents: [] },
        { path: "otto/dnd", name: "dnd", goals: [dndGoal], documents: [] },
        { path: "otto/tangent", name: "tangent", goals: [tangentGoal], documents: [] },
      ],
      map: [
        { path: "otto/megabranch", name: "megabranch", goals: [megabranchGoal] },
        { path: "otto/standards", name: "standards", goals: [standardsGoal] },
        { path: "otto/dnd", name: "dnd", goals: [dndGoal] },
        { path: "otto/tangent", name: "tangent", goals: [tangentGoal] },
      ],
      documents: [],
    });
  };
  window.eval(shellBundle);
  await settle(window);

  let headers = [...window.document.querySelectorAll(".area-desk-panel .area-desk-header h2")].map((node) => node.textContent);
  assert.deepEqual(headers, ["D&D"], "Current shows only the Area with live work");
  click(window, "[data-work-filter='inactive']");
  headers = [...window.document.querySelectorAll(".area-desk-panel .area-desk-header h2")].map((node) => node.textContent);
  assert.deepEqual(headers, ["Megabranch", "Standards", "Tangent"], "Planned work keeps stable path order instead of recent order");
});
