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
            id: step.id, index: index + 1, instruction: step.instruction, kind: step.kind, path: step.path, launch: step.launch ?? null, command: step.command ?? "",
            label: index === 0 ? "Codex · Sol · High" : "Claude · Fable 5", continueFromAssignmentId: step.continueFromAssignmentId ?? null,
            status: index === 0 ? "running" : "pending", session: index === 0 ? "dnd-ship-the-map" : null,
            handover: null, handoverSource: null, live: index === 0, state: index === 0 ? "working" : null, stateDetail: null, idleSince: null,
          })),
        };
        sessions = [{ name: "dnd-ship-the-map", goal: goal.file, state: "working", phase: "execute", command: "codex", pipeline: goal.file, step: 1 }];
        return jsonResponse({ session: "dnd-ship-the-map", pipeline });
      }
      if (pathname === "/api/pipelines/mutate") {
        for (const operation of body.operations) {
          if (operation.type === "add") {
            const after = operation.afterAssignmentId == null ? -1 : pipeline.steps.findIndex((step) => step.id === operation.afterAssignmentId);
            pipeline.steps.splice(after + 1, 0, {
              ...operation.assignment, label: operation.assignment.launch?.harness === "codex" ? "Codex · Sol" : "Claude · Fable 5",
              status: "pending", session: null, handover: null, handoverSource: null, live: false, state: null, stateDetail: null, idleSince: null,
            });
          } else if (operation.type === "update") {
            const assignment = pipeline.steps.find((step) => step.id === operation.assignmentId);
            Object.assign(assignment, operation.patch);
          } else if (operation.type === "remove") {
            pipeline.steps = pipeline.steps.filter((step) => step.id !== operation.assignmentId);
          } else if (operation.type === "move") {
            const index = pipeline.steps.findIndex((step) => step.id === operation.assignmentId);
            const [assignment] = pipeline.steps.splice(index, 1);
            const after = operation.afterAssignmentId == null ? -1 : pipeline.steps.findIndex((step) => step.id === operation.afterAssignmentId);
            pipeline.steps.splice(after + 1, 0, assignment);
          }
        }
        pipeline.steps.forEach((step, index) => { step.index = index + 1; });
        pipeline.revision += 1;
        pipeline.updatedAt = `t${pipeline.revision}`;
        return jsonResponse({ state: "updated", pipeline, added: [], removed: [], moved: [] });
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
  assert.match(window.document.querySelector("[data-launch-start]").textContent, /Start 2 assignments/);
  // Step 2 keeps the Area default and continues step 1's session.
  window.document.querySelector("#launch-instruction").value = "Review the design and update it";
  const continueSelect = window.document.querySelector("[data-launch-continue]");
  assert.ok(continueSelect, "a later step can continue an earlier one");
  const firstAssignmentId = window.document.querySelector("[data-launch-assignment]").dataset.launchAssignment;
  continueSelect.value = firstAssignmentId;
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
  assert.equal(start.body.steps.length, 2);
  assert.deepEqual(start.body.steps[0], {
    id: firstAssignmentId, instruction: "/design the map", kind: "implementation", path: null,
    continueFromAssignmentId: null, launch: { harness: "codex", model: "sol", effort: "high" },
  });
  assert.deepEqual(start.body.steps[1], {
    id: start.body.steps[1].id, instruction: "Review the design and update it", kind: "implementation", path: null,
    continueFromAssignmentId: firstAssignmentId, launch: { harness: "claude", model: "fable-5", effort: null },
  });
  assert.match(start.body.steps[1].id, /^draft-/);

  // The desk compresses pipeline mechanics into Open plus one action menu.
  click(window, "#work-tab");
  await settle(window);
  const row = window.document.querySelector(`[data-goal-anchor='${goal.file}']`);
  assert.match(row.querySelector(".desk-state").textContent, /^Working$/);
  // The open control is the step's launch, and the verb is its accessible name
  // (design-see-the-harness-model-effort-and-open-that-agent Decision 1).
  assert.equal(row.querySelector(".work-cell-action [data-open-goal-run]").textContent, "codex/sol/high");
  assert.match(row.querySelector(".work-cell-action [data-open-goal-run]").getAttribute("aria-label"), /^Open step 1 on codex\/sol\/high:/);
  assert.equal(row.querySelector(".desk-step"), null, "the step chips left the card");
  assert.equal(row.querySelector(".desk-goal-facts"), null, "agent count is not repeated on the Goal");
  assert.equal(row.querySelector("[data-check-goal]"), null);
  assert.equal(row.querySelector("[data-pipeline-control]"), null);
  assert.equal(row.querySelector("[data-stop-goal]"), null, "rare actions left the table markup");

  // The running pipeline row keeps a ▾ that opens the step list: history is
  // fixed, the pending step edits in place, and a draft row appends.
  click(window, `[data-goal-anchor='${goal.file}'] [data-work-object-actions]`);
  await settle(window);
  assert.ok(window.document.querySelector("[data-modal-action='editAssignments']"), "a running pipeline offers its assignments");
  click(window, "[data-modal-action='editAssignments']");
  await settle(window);
  await settle(window);
  assert.ok(popover(), "the popover opened on the running pipeline");
  assert.equal(window.document.querySelectorAll(".launch-step-fixed").length, 1, "the running step is history");
  assert.equal(window.document.querySelectorAll("[data-launch-step-select]").length, 1, "only the pending step is editable");
  assert.equal(window.document.querySelector("#launch-instruction").value, "Review the design and update it");
  assert.match(window.document.querySelector("[data-launch-start]").textContent, /Save pending changes/);
  click(window, "[data-launch-step-add]");
  assert.equal(window.document.querySelectorAll("[data-launch-step-select]").length, 2);
  assert.match(window.document.querySelector("[data-launch-start]").textContent, /Save pending changes/);
  window.document.querySelector("#launch-instruction").value = "Prove it";
  click(window, "[data-launch-harness='codex']");
  click(window, "[data-launch-start]");
  await settle(window);
  await settle(window);
  const mutation = posts.find((entry) => entry.path === "/api/pipelines/mutate");
  assert.equal(mutation.body.goal, goal.file);
  assert.equal(mutation.body.expectedRevision, 1);
  assert.match(mutation.body.operationId, /^[0-9a-f-]{36}$/);
  assert.equal(mutation.body.operations.length, 1);
  assert.equal(mutation.body.operations[0].type, "add");
  assert.equal(mutation.body.operations[0].afterAssignmentId, start.body.steps[1].id);
  assert.deepEqual(mutation.body.operations[0].assignment, {
    id: mutation.body.operations[0].assignment.id, instruction: "Prove it", kind: "implementation", path: null,
    continueFromAssignmentId: null, launch: { harness: "codex", model: "sol", effort: null },
  });
  assert.match(mutation.body.operations[0].assignment.id, /^draft-/);
  assert.equal(popover(), null, "the popover closed after the atomic save");
  assert.equal(posts.filter((entry) => entry.path === "/api/goals/start").length, 1, "a queue mutation never restarts the pipeline");
  const grownRow = window.document.querySelector(`[data-goal-anchor='${goal.file}']`);
  assert.equal(grownRow.querySelector(".work-cell-action [data-open-goal-run]").textContent, "codex/sol/high");

  // The step session dies: normal restart stays with the brain; Julian can Skip or end.
  // and the latest handover shows under the chips.
  sessions = [];
  pipeline.steps[0].live = false;
  click(window, "#menu-refresh");
  await settle(window);
  await settle(window);
  const stoppedRow = window.document.querySelector(`[data-goal-anchor='${goal.file}']`);
  assert.match(stoppedRow.querySelector(".desk-state").textContent, /^Stopped$/);
  assert.equal(stoppedRow.querySelector(".work-cell-action [data-open-goal-run]"), null, "a dead session is not offered as Open");
  assert.equal(stoppedRow.querySelector("[data-stop-goal]"), null);
  assert.equal(stoppedRow.querySelector("[data-pipeline-control='restart']"), null);
  click(window, `[data-goal-anchor='${goal.file}'] [data-work-object-actions]`);
  await settle(window);
  assert.ok(window.document.querySelector("[data-modal-action='skipAssignment']"));
  click(window, "[data-modal-action='skipAssignment']");
  await settle(window);
  await settle(window);
  const control = posts.find((entry) => entry.path === "/api/pipelines/control");
  assert.deepEqual({ goal: control.body.goal, action: control.body.action, step: control.body.step, expectedRevision: control.body.expectedRevision }, { goal: goal.file, action: "skip", step: 1, expectedRevision: 2 });
  assert.match(control.body.idempotencyKey, /^[0-9a-f-]{36}$/);
  const afterRow = window.document.querySelector(`[data-goal-anchor='${goal.file}']`);
  assert.equal(afterRow.querySelector(".desk-handover"), null, "the handover line left the card");

  // Step 2 died too. Stop work ends the run: the row settles back to a plain
  // open Goal and no Restart lingers.
  assert.match(afterRow.querySelector(".desk-state").textContent, /^Stopped$/);
  assert.equal(afterRow.querySelector(".work-cell-action [data-open-goal-run]"), null, "the stopped next step is controlled from the menu");
  click(window, `[data-goal-anchor='${goal.file}'] [data-work-object-actions]`);
  await settle(window);
  const stopWork = window.document.querySelector("[data-modal-action='endPipeline']");
  assert.ok(stopWork, "a stopped step offers End work");
  assert.match(stopWork.textContent, /End work/);
  click(window, "[data-modal-action='endPipeline']");
  await settle(window);
  await settle(window);
  const endPost = posts.filter((entry) => entry.path === "/api/pipelines/control").at(-1);
  assert.deepEqual({ goal: endPost.body.goal, action: endPost.body.action, step: endPost.body.step }, { goal: goal.file, action: "end", step: 2 });
  assert.match(endPost.body.idempotencyKey, /^[0-9a-f-]{36}$/);
  const endedRow = window.document.querySelector(`[data-goal-anchor='${goal.file}']`);
  // End work removes the run record, so Tangent knows of no agent that ran:
  // the row is a plain planned Goal again, never "Ready for validation".
  assert.match(endedRow.querySelector(".desk-state").textContent, /^Open$/);
  assert.equal(endedRow.querySelector("[data-pipeline-control]"), null, "nothing offers Restart after Stop work");

  // A finished pipeline: the row is a plain Goal row again, and its action
  // surface opens immutable history with an explicit Add route.
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
  click(window, `[data-goal-anchor='${goal.file}'] [data-work-object-actions]`);
  await settle(window);
  assert.match(window.document.querySelector("[data-modal-action='editAssignments']").textContent, /Edit pending assignments/, "the finished run's assignments stay one action away");
  click(window, "[data-modal-action='editAssignments']");
  await settle(window);
  await settle(window);
  assert.equal(window.document.querySelectorAll(".launch-step-fixed").length, 3, "finished steps stay as history");
  assert.equal(window.document.querySelectorAll("[data-launch-step-select]").length, 0, "history does not masquerade as a mutable draft");
  assert.match(window.document.querySelector("[data-launch-start]").textContent, /Save pending changes/);
  click(window, "[data-launch-step-add]");
  assert.equal(window.document.querySelectorAll("[data-launch-step-select]").length, 1, "Add creates one stable pending assignment");
  assert.match(window.document.querySelector("[data-launch-start]").textContent, /Save pending changes/);
  click(window, "[data-launch-step-remove='3']");
  assert.equal(window.document.querySelectorAll("[data-launch-step-select]").length, 0, "the unsaved assignment can be removed again");
  assert.match(window.document.querySelector("[data-launch-start]").textContent, /Save pending changes/);

  dom.window.close();
});
