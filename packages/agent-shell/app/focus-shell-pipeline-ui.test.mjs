import test from "node:test";
import { assert, readFile, path, JSDOM, documentComments, areaMapView, shellBundle, here, goToCore, goalCardCore, askCore, settle, click, submit, openDocumentViaGoTo, jsonResponse } from "./focus-shell-ui-fixture.mjs";

test("the launch popover composes a pipeline of steps and the desk shows its progress", async () => {
  const [html, script, mapCore] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
    readFile(path.join(here, "public", "area-map-core.js"), "utf8"),
  ]);
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  const goal = {
    mtime: 1,
    area: "otto/dnd",
    slug: "ship-the-map",
    file: "otto/dnd/goal-ship-the-map.md",
    title: "Ship the map",
    status: "open",
    doneWhen: "The map ships.",
    stateText: "",
    currentBrief: "- You wanted: Ship the map.",
    storyText: "",
    documents: [],
    why: [],
    subgoalItems: [],
    subgoals: [],
    depth: 0,
  };
  const posts = [];
  let pipeline = null;
  let sessions = [];
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (options.method === "POST") {
      const body = options.body ? JSON.parse(options.body) : {};
      posts.push({ path: pathname, body });
      if (pathname === "/api/goals/start" && body.steps) {
        pipeline = {
          goal: goal.file, area: goal.area, slug: goal.slug, revision: 1, status: "running", updatedAt: "t1", extraFiles: [],
          steps: body.steps.map((step, index) => ({
            index: index + 1, instruction: step.instruction, launch: step.launch ?? null, command: step.command ?? "",
            label: index === 0 ? "Codex · Sol · High" : "Claude · Fable 5", continueFrom: step.continueFrom ?? null,
            status: index === 0 ? "running" : "pending", session: index === 0 ? "dnd-ship-the-map" : null,
            handover: null, handoverSource: null, live: index === 0, state: index === 0 ? "working" : null, stateDetail: null, idleSince: null,
          })),
        };
        sessions = [{ name: "dnd-ship-the-map", goal: goal.file, state: "working", phase: "execute", command: "codex", pipeline: goal.file, step: 1 }];
        return jsonResponse({ session: "dnd-ship-the-map", pipeline });
      }
      if (pathname === "/api/pipelines/append") {
        const added = body.steps.map((step, offset) => ({
          index: pipeline.steps.length + offset + 1, instruction: step.instruction, launch: step.launch ?? null, command: step.command ?? "",
          label: "Claude · Fable 5", continueFrom: step.continueFrom ?? null, status: "pending", session: null,
          handover: null, handoverSource: null, live: false, state: null, stateDetail: null, idleSince: null,
        }));
        pipeline.steps.push(...added);
        pipeline.updatedAt = `t${pipeline.steps.length}`;
        return jsonResponse({ status: "queued", after: 1, added: added.map((step) => step.index), pipeline });
      }
      if (pathname === "/api/pipelines/control" && body.action === "end") {
        for (const step of pipeline.steps) if (!["complete", "skipped"].includes(step.status)) { step.status = "ended"; step.live = false; }
        pipeline.status = "complete";
        pipeline.updatedAt = "t-ended";
        return jsonResponse({ status: "ended", next: null, ended: [2, 3], pipeline });
      }
      if (pathname === "/api/pipelines/control") {
        pipeline.steps[0].status = "complete";
        pipeline.steps[0].handover = "Design written: design-map.md.\nUnresolved: none.";
        pipeline.steps[1].status = "running";
        pipeline.steps[1].session = "dnd-ship-the-map-s2";
        pipeline.steps[1].live = false;
        return jsonResponse({ status: "started", next: { index: 2, session: "dnd-ship-the-map-s2" }, pipeline });
      }
      return jsonResponse({ ok: true, session: "dnd-ship-the-map" });
    }
    if (pathname === "/api/sessions") return jsonResponse({ boot: "boot-1", caffeinate: false, sessions, pipelines: pipeline ? [pipeline] : [] });
    if (pathname === "/api/operations") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    if (pathname === "/api/launch/options") {
      return jsonResponse({
        harnesses: [
          { id: "codex", label: "Codex", command: "codex", models: [{ id: "sol", label: "Sol", args: "--model sol" }], efforts: [{ id: "high", label: "High", args: "-c effort=high" }] },
          { id: "claude", label: "Claude", command: "claude", models: [{ id: "fable-5", label: "Fable 5", args: "--model claude-fable-5" }], efforts: [] },
        ],
        default: { harness: "claude", model: "fable-5", effort: null, command: "claude --model claude-fable-5", label: "Claude · Fable 5" },
      });
    }
    return jsonResponse({
      areas: [{ path: "otto", name: "otto", goals: [] }, { path: "otto/dnd", name: "dnd", goals: [goal], documents: [] }],
      map: [{ path: "otto/dnd", name: "dnd", goals: [goal] }],
      documents: [],
    });
  };
  window.eval(shellBundle);
  await settle(window);
  click(window, "[data-work-filter='inactive']");
  click(window, `[data-launch-for='${goal.file}']`);
  await settle(window);
  await settle(window);
  /** Reads the launch popover, which the shell redraws on every paint. */
  const popover = () => window.document.querySelector("[data-launch-popover]");
  assert.ok(popover(), "the popover opened");
  // One step, no instruction: a plain start with the Area default.
  assert.equal(window.document.querySelectorAll("[data-launch-step-select]").length, 1);
  assert.match(window.document.querySelector("[data-launch-start]").textContent, /Start Claude · Fable 5/);

  // Step 1: Codex Sol at High effort, with an instruction that survives repaints.
  click(window, "[data-launch-harness='codex']");
  assert.ok(window.document.querySelector("[data-launch-effort='high']"), "the Effort column shows for a harness with efforts");
  click(window, "[data-launch-effort='high']");
  assert.match(window.document.querySelector(".launch-command code").textContent, /codex --model sol -c effort=high/);
  window.document.querySelector("#launch-instruction").value = "/design the map";
  click(window, "[data-launch-step-add]");
  assert.equal(window.document.querySelectorAll("[data-launch-step-select]").length, 2);
  assert.match(window.document.querySelector("[data-launch-step-select='0']").textContent, /Codex · Sol · High/);
  assert.match(window.document.querySelector("[data-launch-step-select='0']").textContent, /design the map/);
  assert.match(window.document.querySelector("[data-launch-start]").textContent, /Start 2 steps/);
  // Step 2 keeps the Area default and continues step 1's session.
  window.document.querySelector("#launch-instruction").value = "Review the design and update it";
  const continueSelect = window.document.querySelector("[data-launch-continue]");
  assert.ok(continueSelect, "a later step can continue an earlier one");
  continueSelect.value = "1";
  continueSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
  // Switching rows keeps both drafts.
  click(window, "[data-launch-step-select='0']");
  assert.equal(window.document.querySelector("#launch-instruction").value, "/design the map");
  click(window, "[data-launch-step-select='1']");
  assert.equal(window.document.querySelector("#launch-instruction").value, "Review the design and update it");

  click(window, "[data-launch-start]");
  await settle(window);
  await settle(window);
  const start = posts.find((entry) => entry.path === "/api/goals/start");
  assert.equal(start.body.file, goal.file);
  assert.deepEqual(start.body.steps, [
    { instruction: "/design the map", continueFrom: null, launch: { harness: "codex", model: "sol", effort: "high" } },
    { instruction: "Review the design and update it", continueFrom: 1, launch: { harness: "claude", model: "fable-5", effort: null } },
  ]);

  // The desk compresses pipeline mechanics into Open plus one action menu.
  click(window, "#work-tab");
  click(window, "[data-work-filter='active']");
  await settle(window);
  const row = window.document.querySelector(`[data-goal-anchor='${goal.file}']`);
  assert.match(row.querySelector(".desk-state").textContent, /^Working$/);
  // The open control is the step's launch, and the verb is its accessible name
  // (design-see-the-harness-model-effort-and-open-that-agent Decision 1).
  assert.equal(row.querySelector("[data-open-goal-run]").textContent, "codex/sol/high");
  assert.match(row.querySelector("[data-open-goal-run]").getAttribute("aria-label"), /^Open step 1 on codex\/sol\/high:/);
  assert.equal(row.querySelector(".desk-step"), null, "the step chips left the card");
  assert.equal(row.querySelector(".desk-goal-facts"), null, "agent count is not repeated on the Goal");
  assert.equal(row.querySelector("[data-check-goal]"), null);
  assert.equal(row.querySelector("[data-pipeline-control]"), null);
  assert.match(row.querySelector("[data-stop-goal]").textContent, /^End work$/);

  // The running pipeline row keeps a ▾ that opens the step list: history is
  // fixed, the pending step edits in place, and a draft row appends.
  const stepsToggle = row.querySelector("[data-launch-for]");
  assert.ok(stepsToggle, "a running pipeline row offers its steps");
  assert.match(stepsToggle.textContent, /Steps and agents/);
  click(window, `[data-goal-anchor='${goal.file}'] [data-launch-for]`);
  await settle(window);
  await settle(window);
  assert.ok(popover(), "the popover opened on the running pipeline");
  assert.equal(window.document.querySelectorAll(".launch-step-fixed").length, 1, "the running step is history");
  assert.equal(window.document.querySelectorAll("[data-launch-step-select]").length, 1, "only the pending step is editable");
  assert.equal(window.document.querySelector("#launch-instruction").value, "Review the design and update it");
  assert.match(window.document.querySelector("[data-launch-start]").textContent, /Save step 2/);
  click(window, "[data-launch-step-add]");
  assert.equal(window.document.querySelectorAll("[data-launch-step-select]").length, 2);
  assert.match(window.document.querySelector("[data-launch-start]").textContent, /Add step 3/);
  window.document.querySelector("#launch-instruction").value = "Prove it";
  click(window, "[data-launch-harness='codex']");
  click(window, "[data-launch-start]");
  await settle(window);
  await settle(window);
  const append = posts.find((entry) => entry.path === "/api/pipelines/append");
  assert.equal(append.body.goal, goal.file);
  assert.deepEqual(append.body.steps, [{ instruction: "Prove it", continueFrom: null, launch: { harness: "codex", model: "sol", effort: null } }]);
  assert.equal(append.body.expectedRevision, 1);
  assert.match(append.body.idempotencyKey, /^[0-9a-f-]{36}$/);
  assert.equal(popover(), null, "the popover closed after the append");
  assert.equal(posts.filter((entry) => entry.path === "/api/goals/start").length, 1, "an append never restarts the pipeline");
  const grownRow = window.document.querySelector(`[data-goal-anchor='${goal.file}']`);
  assert.equal(grownRow.querySelector("[data-open-goal-run]").textContent, "codex/sol/high");

  // The step session dies: the row offers Restart and Skip; Skip advances the line
  // and the latest handover shows under the chips.
  sessions = [];
  pipeline.steps[0].live = false;
  click(window, "#menu-refresh");
  await settle(window);
  await settle(window);
  const stoppedRow = window.document.querySelector(`[data-goal-anchor='${goal.file}']`);
  assert.match(stoppedRow.querySelector(".desk-state").textContent, /^Stopped$/);
  assert.equal(stoppedRow.querySelector("[data-open-goal-run]"), null, "a dead session is not offered as Open");
  assert.equal(stoppedRow.querySelector("[data-stop-goal]"), null);
  assert.ok(stoppedRow.querySelector("[data-pipeline-control='restart']"));
  click(window, `[data-goal-anchor='${goal.file}'] [data-pipeline-control='skip']`);
  await settle(window);
  await settle(window);
  const control = posts.find((entry) => entry.path === "/api/pipelines/control");
  assert.deepEqual({ goal: control.body.goal, action: control.body.action, step: control.body.step, expectedRevision: control.body.expectedRevision }, { goal: goal.file, action: "skip", step: 1, expectedRevision: 1 });
  assert.match(control.body.idempotencyKey, /^[0-9a-f-]{36}$/);
  const afterRow = window.document.querySelector(`[data-goal-anchor='${goal.file}']`);
  assert.equal(afterRow.querySelector(".desk-handover"), null, "the handover line left the card");

  // Step 2 died too. Stop work ends the run: the row settles back to a plain
  // open Goal and no Restart lingers.
  assert.match(afterRow.querySelector(".desk-state").textContent, /^Stopped$/);
  assert.equal(afterRow.querySelector("[data-open-goal-run]"), null, "the stopped next step is controlled from the menu");
  const stopWork = afterRow.querySelector("[data-pipeline-control='end']");
  assert.ok(stopWork, "a stopped step offers Stop work");
  assert.equal(stopWork.textContent, "End work");
  click(window, `[data-goal-anchor='${goal.file}'] [data-pipeline-control='end']`);
  await settle(window);
  await settle(window);
  const endPost = posts.filter((entry) => entry.path === "/api/pipelines/control").at(-1);
  assert.deepEqual({ goal: endPost.body.goal, action: endPost.body.action, step: endPost.body.step }, { goal: goal.file, action: "end", step: 2 });
  assert.match(endPost.body.idempotencyKey, /^[0-9a-f-]{36}$/);
  click(window, "[data-work-filter='inactive']");
  const endedRow = window.document.querySelector(`[data-goal-anchor='${goal.file}']`);
  // End work removes the run record, so Tangent knows of no agent that ran:
  // the row is a plain planned Goal again, never "Ready for validation".
  assert.match(endedRow.querySelector(".desk-state").textContent, /^Open$/);
  assert.equal(endedRow.querySelector("[data-pipeline-control]"), null, "nothing offers Restart after Stop work");

  // A finished pipeline: the row is a plain Goal row again, and its ▾ opens
  // the finished steps with a draft row ready to append, never a fresh start.
  for (const step of pipeline.steps) { step.status = "complete"; step.live = false; }
  pipeline.status = "complete";
  pipeline.updatedAt = "t-complete";
  click(window, "#menu-refresh");
  await settle(window);
  await settle(window);
  const finishedRow = window.document.querySelector(`[data-goal-anchor='${goal.file}']`);
  // Every step ran and no Test exists yet, so the result is not offered for
  // acceptance (design-redesign-work-as-a-compact-table Decision 11).
  assert.match(finishedRow.querySelector(".desk-state").textContent, /^Preparing validation$/);
  assert.equal(finishedRow.querySelector(".desk-action-menu [data-launch-for]").textContent, "Steps and agents…", "the finished run's steps stay one menu item away");
  click(window, `[data-goal-anchor='${goal.file}'] [data-launch-for]`);
  await settle(window);
  await settle(window);
  assert.equal(window.document.querySelectorAll(".launch-step-fixed").length, 3, "finished steps stay as history");
  assert.equal(window.document.querySelectorAll("[data-launch-step-select]").length, 1, "one draft row waits to be appended");
  assert.equal(window.document.querySelector("[data-launch-step-remove]"), null, "the only draft row cannot be removed");
  assert.match(window.document.querySelector("[data-launch-start]").textContent, /Add step 4/);
  click(window, "[data-launch-step-add]");
  assert.match(window.document.querySelector("[data-launch-start]").textContent, /Add 2 steps/);
  click(window, "[data-launch-step-remove='4']");
  assert.match(window.document.querySelector("[data-launch-start]").textContent, /Add step 4/);

  dom.window.close();
});
