import test from "node:test";
import { assert, readFile, path, JSDOM, shellBundle, here, settle, click, jsonResponse } from "./focus-shell-ui-fixture.mjs";

/**
 * The exact shape Julian hit on 2026-08-25: a pipeline whose step 1 stopped
 * while step 2 runs live. The card read `Stopped 1/2` and offered no route, so
 * the working agent was unreachable from Work
 * (goal-every-goal-card-on-work-has-a-way-to-open-its-ag).
 */
function pipelineWithStoppedFirstStep(goal) {
  return {
    goal: goal.file,
    area: goal.area,
    slug: goal.slug,
    status: "running",
    currentAssignmentId: "assignment-2",
    updatedAt: "t2",
    extraFiles: [],
    steps: [
      {
        id: "assignment-1", index: 1, instruction: "Branch the graphics commits.", launch: null, command: "pi-code", label: "Pi Code · GLM 5.2",
        continueFrom: null, status: "stopped", session: "viz-branch-graphics", startedAt: "2026-08-25T11:03:37.588Z",
        endedAt: "2026-08-25T11:41:34.505Z", handover: null, handoverSource: null, live: false, state: null,
        stateDetail: null, idleSince: null,
      },
      {
        id: "assignment-2", index: 2, instruction: "Branch the graphics commits.", launch: null, command: "pi-code", label: "Pi Code · GLM 5.2",
        continueFrom: null, status: "running", session: "viz-branch-graphics-s2", startedAt: "2026-08-25T19:31:20.765Z",
        endedAt: null, handover: null, handoverSource: null, live: true, state: "working",
        stateDetail: null, idleSince: null,
      },
    ],
  };
}

test("a Goal whose first step stopped still opens the step that runs", async () => {
  const html = await readFile(path.join(here, "public", "shell.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  const goal = {
    mtime: 1, area: "neara/viz-input", slug: "branch-graphics", file: "neara/viz-input/goal-branch-graphics.md",
    title: "Branch graphics commits", status: "active", session: null, doneWhen: "The review is requested.",
    stateText: "", currentBrief: "", storyText: "", documents: [], why: [], subgoalItems: [], subgoals: [], depth: 0,
  };
  const pipeline = pipelineWithStoppedFirstStep(goal);
  let sessions = [
    { name: "viz-branch-graphics", goal: goal.file, area: goal.area, kind: "goal", state: "working", command: "pi-code", pipeline: goal.file, step: 1 },
    { name: "viz-branch-graphics-s2", target: "$viz", goal: goal.file, area: goal.area, kind: "goal", state: "working", command: "pi-code", pipeline: goal.file, step: 2 },
  ];
  let brains = [];
  const posts = [];

  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (options.method === "POST") {
      posts.push({ pathname, body: JSON.parse(options.body) });
      return jsonResponse({ ok: true });
    }
    if (pathname === "/api/sessions") return jsonResponse({ boot: "boot-1", caffeinate: false, sessions, pipelines: [pipeline], brains });
    if (pathname === "/api/operations") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    return jsonResponse({
      areas: [{ path: "neara", name: "neara", goals: [] }, { path: "neara/viz-input", name: "viz-input", goals: [goal], documents: [] }],
      map: [{ path: "neara/viz-input", name: "viz-input", goals: [goal] }],
      documents: [],
    });
  };

  window.eval(shellBundle);
  await settle(window);
  /** Reads the Goal's row, which the shell redraws on every paint. */
  const row = () => window.document.querySelector(`[data-goal-anchor='${goal.file}']`);
  assert.equal(row().querySelector(".desk-state").textContent, "Working", "the pill follows the live step, not the stopped one");
  assert.match(row().querySelector(".work-cell-agent").textContent, /2\/2/, "the step count names the step that runs");
  assert.match(row().querySelector(".work-cell-agent [data-open-goal-run]").getAttribute("aria-label"), /^Open step 2/);
  assert.equal(row().querySelector("[data-pipeline-control='restart']"), null, "a live step is not offered a restart of the dead one");

  click(window, `[data-goal-anchor='${goal.file}'] [data-work-object-actions]`);
  assert.equal(window.document.querySelector("[data-modal-action='stopAgent']").dataset.modalKey, "s");
  click(window, "[data-modal-cancel]");
  row().querySelector("[data-work-row-title]").focus();
  row().querySelector("[data-work-row-title]").dispatchEvent(new window.KeyboardEvent("keydown", { key: "s", bubbles: true, cancelable: true }));
  assert.match(window.document.querySelector("#modal-title").textContent, /Stop Agent/);
  click(window, "[data-modal-confirm]");
  await settle(window);
  assert.deepEqual(posts.at(-1), {
    pathname: "/api/goals/stop",
    body: { goal: goal.file, expectedSession: "viz-branch-graphics-s2", expectedTarget: "$viz" },
  }, "s fences the stop to the authoritative current pipeline session");

  // The For you row must not ask about step 1 either: the work moved past it.
  assert.equal(
    [...window.document.querySelectorAll(".ask-table .ask-question")].map((cell) => cell.textContent).find((text) => /Step 1 stopped/.test(text)),
    undefined,
    "a stopped step behind a live one asks Julian nothing",
  );

  // The record lags a session that lives: step 2 reads stopped while its pane
  // still runs. The card opens the session rather than going inert.
  pipeline.steps[1].status = "stopped";
  pipeline.steps[1].live = false;
  click(window, "#menu-refresh");
  await settle(window);
  await settle(window);
  assert.equal(row().querySelector(".desk-state").textContent, "Working");
  assert.match(row().querySelector(".work-cell-agent [data-open-goal-run]").getAttribute("aria-label"), /^Open/);

  // No session at all: the card says why, and its menu still holds the exits.
  sessions = [];
  brains = [{ area: goal.area, status: "active", live: false, health: { status: "failed" }, recovery: { exhausted: true } }];
  click(window, "#menu-refresh");
  await settle(window);
  await settle(window);
  assert.equal(row().querySelector(".desk-state").textContent, "Stopped");
  assert.match(row().querySelector(".work-cell-agent .work-agent-ref.past").textContent, /2\/2$/, "the newest attempt is the one to restart, printed muted");
  assert.equal(row().querySelector(".work-cell-agent [data-open-goal-run]"), null);
  assert.equal(row().querySelector("[data-pipeline-control='restart']"), null);
  const postCount = posts.length;
  row().querySelector("[data-work-row-title]").dispatchEvent(new window.KeyboardEvent("keydown", { key: "s", bubbles: true, cancelable: true }));
  assert.equal(posts.length, postCount, "s does not post when the selected Goal has no live agent");
  assert.match(window.document.querySelector("#toast").textContent, /no live agent/);
  assert.equal(row().querySelector("[data-goal-recovery]"), null, "guarded recovery does not reinterpret a stopped assignment as pending");

  // The run finishes past the step that died. The card must not fall back to
  // reporting step 1's death: the pipeline is over, so the Goal reads as plain
  // open work, with no Restart of a step the run already left behind.
  pipeline.steps[1].status = "complete";
  click(window, "#menu-refresh");
  await settle(window);
  await settle(window);
  assert.doesNotMatch(row().querySelector(".work-cell-agent").textContent, /\d\/\d/, "a finished run names no current step");
  assert.notEqual(row().querySelector(".desk-state").textContent, "Stopped");
  assert.equal(row().querySelector("[data-goal-recovery]"), null, "no recovery start for a step the run moved past");
  assert.ok(row().querySelector("[data-work-row-title][data-open-close]"), "the Goal is plain open work again: it opens its reader, only the brain starts an agent (D8)");
  assert.equal(row().querySelector("[data-open-goal-run]"), null, "no run route on a finished run");
  assert.equal(row().querySelector("[data-launch-for]"), null, "no chooser on a Goal row");

  // A pending assignment with no current attempt waits for the brain: only
  // the brain starts workers (D8), so Work offers no recovery start.
  pipeline.steps[0].status = "complete";
  pipeline.steps[1].status = "pending";
  pipeline.currentAssignmentId = null;
  click(window, "#menu-refresh");
  await settle(window);
  await settle(window);
  assert.equal(row().querySelector("[data-goal-recovery]"), null, "no recovery start: the brain starts the pending assignment");
  click(window, `[data-goal-anchor='${goal.file}'] [data-work-object-actions]`);
  await settle(window);
  assert.equal(window.document.querySelector("[data-modal-action='recoveryStart']"), null, "the action menu offers no recovery start");
  assert.equal(posts.filter((entry) => entry.pathname === "/api/goals/start").length, 0, "the browser never starts a worker");
});
