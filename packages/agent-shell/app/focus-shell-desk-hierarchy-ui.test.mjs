import test from "node:test";
import { assert, readFile, path, JSDOM, documentComments, areaMapView, shellBundle, here, goToCore, goalCardCore, askCore, settle, click, submit, openDocumentViaGoTo, jsonResponse } from "./focus-shell-ui-fixture.mjs";

test("a parent Area owns descendant current work without a separate sub-Area section", async () => {
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
  // Authored (creation) order puts the oldest ready Goal first, the bug design-area-map Decision 2 fixes.
  const readyGoal = {
    mtime: 1, area: "neara/hackathon/embedded-js/storm-response", slug: "old-ready", file: "neara/hackathon/embedded-js/storm-response/goal-old-ready.md",
    title: "Old ready goal", status: "open", doneWhen: "Ready.", changedAt: now - 30 * DAY, waitingOn: "", depth: 0,
  };
  const workingGoal = {
    mtime: 2, area: "neara/hackathon/embedded-js/storm-response", slug: "working-goal", file: "neara/hackathon/embedded-js/storm-response/goal-working.md",
    title: "Working goal", status: "open", doneWhen: "Working.", changedAt: now - 10 * DAY, waitingOn: "", session: "storm--working", depth: 0,
  };
  const needsYouGoal = {
    mtime: 3, area: "neara/hackathon/embedded-js/storm-response", slug: "needs-you", file: "neara/hackathon/embedded-js/storm-response/goal-needs-you.md",
    title: "Needs you goal", status: "open", doneWhen: "Needs you.", changedAt: now - 2 * DAY, waitingOn: "Julian", depth: 0,
  };
  const embeddedGoal = {
    mtime: 4, area: "neara/hackathon/embedded-js", slug: "release-deploy", file: "neara/hackathon/embedded-js/goal-release-deploy.md",
    title: "Release and deploy", status: "open", doneWhen: "Deployed.", changedAt: now - 100 * DAY, waitingOn: "", depth: 0,
  };
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (options.method === "POST") return jsonResponse({ ok: true });
    if (pathname === "/api/sessions") {
      return jsonResponse({
        boot: "boot-1", caffeinate: false, pipelines: [],
        sessions: [{ name: "neara--brain", area: "neara", kind: "brain", state: "working", command: "codex" }, { name: "storm--working", goal: workingGoal.file, state: "working", command: "codex" }],
        brains: [{ area: "neara", status: "running", live: true, session: "neara--brain", generation: 2, state: "working" }],
      });
    }
    if (pathname === "/api/programs") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    return jsonResponse({
      areas: [
        { path: "neara", name: "neara", goals: [] },
        { path: "neara/hackathon", name: "hackathon", goals: [] },
        { path: "neara/hackathon/embedded-js", name: "embedded-js", goals: [embeddedGoal], documents: [] },
        { path: "neara/hackathon/embedded-js/storm-response", name: "storm-response", goals: [readyGoal, workingGoal, needsYouGoal], documents: [] },
      ],
      map: [
        { path: "neara/hackathon/embedded-js", name: "embedded-js", goals: [embeddedGoal] },
        { path: "neara/hackathon/embedded-js/storm-response", name: "storm-response", goals: [readyGoal, workingGoal, needsYouGoal] },
      ],
      documents: [],
    });
  };
  window.eval(shellBundle);
  await settle(window);

  assert.equal(window.document.querySelectorAll(".area-desk-panel").length, 1, "embedded-js and storm-response fold into one panel");
  const panel = window.document.querySelector(".area-desk-panel");
  assert.match(panel.querySelector(".area-desk-header h2").textContent, /Neara/);
  assert.match(panel.querySelector("[data-open-brain]").textContent, /Open brain/);
  assert.equal(panel.querySelector(".desk-subarea"), null, "a descendant does not become another card");
  assert.match(panel.querySelector("[data-work-area$='/storm-response'] h3").textContent, /Storm Response/);

  const titles = [...panel.querySelectorAll("[data-work-area$='/storm-response'] .desk-goal-main strong")].map((node) => node.textContent);
  assert.deepEqual(titles, ["Needs you goal", "Working goal"], "Current contains live and directly waiting descendant Goals");
});
