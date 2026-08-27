import test from "node:test";
import { assert, readFile, path, JSDOM, documentComments, areaMapView, shellBundle, here, goToCore, goalCardCore, askCore, settle, click, submit, openDocumentViaGoTo, jsonResponse } from "./focus-shell-ui-fixture.mjs";

test("a parent Area owns descendant work without a separate sub-Area section", async () => {
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
    title: "Release and deploy", status: "open", doneWhen: "Deployed.", changedAt: now - 100 * DAY, waitingOn: "", session: "embedded--working", depth: 0,
  };
  const brainStarts = [];
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (options.method === "POST") {
      if (pathname === "/api/brains/start") {
        const body = JSON.parse(options.body);
        brainStarts.push(body);
        return jsonResponse({ session: "embedded-js-brain", generation: 1, brain: { area: body.area, status: "active" } });
      }
      return jsonResponse({ ok: true });
    }
    if (pathname === "/api/sessions") {
      return jsonResponse({
        boot: "boot-1", caffeinate: false, pipelines: [],
        sessions: [{ name: "neara--brain", area: "neara", kind: "brain", state: "working", command: "codex" }, { name: "embedded--working", goal: embeddedGoal.file, state: "working", command: "codex" }, { name: "storm--working", goal: workingGoal.file, state: "working", command: "codex" }],
        brains: [
          { area: "neara", status: "active", live: true, session: "neara--brain", generation: 2, state: "working" },
          { area: "neara/hackathon/embedded-js/storm-response", status: "active", live: false, session: "storm-response-brain", generation: 1 },
        ],
      });
    }
    if (pathname === "/api/operations") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
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

  assert.equal(window.document.querySelectorAll(".work-table tbody").length, 1, "embedded-js and storm-response fold into one row group");
  const group = window.document.querySelector(".work-table tbody");
  assert.match(group.querySelector(".work-group-name [data-work-cursor-control]").textContent, /Neara/);
  assert.match(group.querySelector(".work-group-brain .work-group-brain-long").textContent, /Open brain/);
  assert.equal(group.getAttribute("aria-labelledby"), group.querySelector(".work-group-head").id, "the row group is named by its header");

  // Each descendant Area with its own Goals is one flat sub-header inside the
  // parent's row group, named by its path below Neara, in path order
  // (work-view-sub-areas Decision 1). It is not a second group.
  const subHeaders = [...group.querySelectorAll("tr[data-work-sub-area]")];
  assert.deepEqual(subHeaders.map((row) => row.dataset.workSubArea), ["neara/hackathon/embedded-js", "neara/hackathon/embedded-js/storm-response"]);
  assert.deepEqual(subHeaders.map((row) => row.querySelector("[data-work-cursor-control]").textContent), ["Hackathon / Embedded Js", "Hackathon / Embedded Js / Storm Response"],
    "a sub-header prints the path below the group, not one short name");
  assert.equal(group.querySelectorAll(".work-group-row:not([data-work-sub-area])").length, 1, "one top-level header");

  const stormRows = [...group.querySelectorAll("tr[data-work-area$='/storm-response']:not([data-work-sub-area])")];
  assert.ok(stormRows.length, "descendant Goals stay in the parent group");
  assert.equal(group.querySelector("tr[data-goal-anchor] .work-row-path"), null, "a Goal row under a sub-header carries no path tag: the sub-header names its Area");
  for (const row of stormRows) assert.equal(row.previousElementSibling.dataset.workSubArea ?? row.previousElementSibling.dataset.workArea, "neara/hackathon/embedded-js/storm-response", "storm-response rows sit under their sub-header");
  assert.equal(window.document.querySelectorAll(".work-group-brain").length, 3, "every header, top-level and sub, prints its brain button");
  assert.match(subHeaders[1].querySelector(".work-group-brain").textContent, /Resume brain/, "an inactive brain record says Resume");
  assert.match(subHeaders[0].querySelector(".work-group-brain").textContent, /Start brain/, "no brain record says Start");

  const titles = stormRows.map((row) => row.querySelector(".work-row-title").textContent);
  assert.deepEqual(titles, ["Working goal", "Needs you goal", "Old ready goal"], "one projection keeps live, waiting, and unstarted descendant Goals together");
  void brainStarts;
});
