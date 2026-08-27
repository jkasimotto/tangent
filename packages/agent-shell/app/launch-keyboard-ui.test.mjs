import test from "node:test";
import assert from "node:assert/strict";
import { bootWorkTable, press, settle } from "./work-table-harness.mjs";
import { plannedWorkFixture, workTableFixture, withBrainOnlyArea } from "./work-table-fixture.mjs";

const launchOptions = {
  area: "otto/onboarding",
  harnesses: [
    {
      id: "codex", label: "Codex", command: "codex",
      models: [
        { id: "sol", label: "Sol", args: "--model sol", efforts: [{ id: "low", label: "Low", args: "--effort low" }, { id: "high", label: "High", args: "--effort high" }] },
        { id: "luna", label: "Luna", args: "--model luna", efforts: [{ id: "low", label: "Low", args: "--effort low" }, { id: "high", label: "High", args: "--effort high" }] },
      ],
    },
    { id: "claude", label: "Claude", command: "claude", models: [{ id: "opus", label: "Opus", args: "--model opus" }] },
  ],
  default: { harness: "codex", model: "sol", effort: "low", label: "Codex · Sol · Low", command: "codex --model sol --effort low", source: "otto" },
  workDefault: { harness: "codex", model: "sol", effort: "low", label: "Codex · Sol · Low", command: "codex --model sol --effort low", source: "otto" },
  brainDefault: { harness: "claude", model: "opus", label: "Claude · Opus", command: "claude --model opus", source: "otto" },
  declarations: {
    work: { mode: "launch", launch: { harness: "codex", model: "sol", effort: "low" } },
    brain: { mode: "launch", launch: { harness: "claude", model: "opus" } },
  },
};

const harnessRegistry = {
  version: 1,
  harnesses: [{ id: "codex", label: "Codex", command: "codex", modelSet: "codex", effortSet: "efforts" }],
  modelSets: { codex: [{ id: "sol", label: "Sol", args: "--model sol", effortSet: "efforts" }] },
  effortSets: { efforts: [{ id: "low", label: "Low", args: "--effort low" }] },
};

test("defaults are a complete keyboard chooser with staged Escape and exact return focus", async () => {
  const { window, document } = await bootWorkTable(workTableFixture(), { launchOptions });
  const origin = document.activeElement.closest("[data-work-cursor]")?.dataset.workCursor;

  press(window, "d");
  await settle(window, 5);
  const popover = document.querySelector("[data-launch-popover]");
  assert.ok(popover);
  assert.equal(document.activeElement.dataset.defaultAgentEdit, "work", "d enters the settings surface without a mouse");

  press(window, "Enter");
  await settle(window);
  assert.equal(document.activeElement.dataset.launchHarness, "codex", "Enter on Change enters the shared chooser");
  press(window, "l");
  assert.equal(document.activeElement.dataset.launchModel, "sol", "l moves from Harness to Model");
  press(window, "j");
  assert.equal(document.activeElement.dataset.launchModel, "luna", "j moves within Model choices");
  press(window, "Enter");
  await settle(window);
  assert.equal(document.activeElement.dataset.launchModel, "luna", "selection repaint preserves the focused model");
  press(window, "ArrowRight");
  assert.equal(document.activeElement.dataset.launchEffort, "low", "right arrow reaches Effort");
  press(window, "ArrowDown");
  press(window, "Enter");
  await settle(window);
  assert.equal(document.querySelector("[data-launch-effort='high']").classList.contains("selected"), true);

  const last = document.querySelector("[data-focus-key='launch:registry']");
  last.focus();
  press(window, "Tab");
  assert.ok(document.querySelector("[data-launch-popover]").contains(document.activeElement), "Tab wraps inside the chooser");

  press(window, "Escape");
  await settle(window);
  assert.ok(document.querySelector("[data-launch-popover]"), "first Escape leaves the default edit stage");
  assert.equal(document.activeElement.dataset.defaultAgentEdit, "work");
  press(window, "Escape");
  await settle(window);
  assert.equal(document.querySelector("[data-launch-popover]"), null, "second Escape closes the chooser");
  assert.equal(document.activeElement.closest("[data-work-cursor]")?.dataset.workCursor, origin, "closing restores the exact Work row");
});

test("Goal and brain spawning share the Harness, Model, Effort keyboard surface", async () => {
  const fixture = withBrainOnlyArea(workTableFixture(), { live: false, planned: true });
  fixture.pipelines = fixture.pipelines.filter((pipeline) => pipeline.goal !== "otto/onboarding/goal-walkthrough.md");
  const unstarted = fixture.goals.find((goal) => goal.file === "otto/onboarding/goal-walkthrough.md");
  unstarted.firstStartAt = null;
  const { window, document } = await bootWorkTable(fixture, { launchOptions });

  const goal = document.querySelector("[data-goal-anchor='otto/onboarding/goal-walkthrough.md'] [data-work-row-title]");
  goal.click();
  await settle(window, 5);
  assert.equal(document.activeElement.dataset.launchHarness, "codex", "Goal launch starts at the selected Harness: it composes no assignments (D8)");
  document.querySelector("[data-launch-edit]").click();
  await settle(window);
  assert.equal(document.activeElement.id, "launch-command-input");
  press(window, "Escape");
  await settle(window);
  assert.ok(document.querySelector("[data-launch-popover]"), "Escape leaves command editing before the Goal chooser");
  press(window, "Escape");
  await settle(window);
  assert.equal(document.activeElement, document.querySelector("[data-goal-anchor='otto/onboarding/goal-walkthrough.md'] [data-work-row-title]"));

  const brain = document.querySelector("[data-work-group='otto/quiet'] .work-group-brain");
  brain.click();
  await settle(window, 5);
  assert.equal(document.activeElement.id, "brain-instruction", "brain spawn starts where its instruction can be typed");
  press(window, "Tab");
  assert.equal(document.activeElement.dataset.launchHarness, "codex", "one Tab enters the same choice columns");
  press(window, "l");
  press(window, "j");
  press(window, "Enter");
  await settle(window);
  assert.equal(document.querySelector("[data-launch-model='luna']").classList.contains("selected"), true);
  press(window, "Escape");
  await settle(window);
  assert.equal(document.activeElement, document.querySelector("[data-work-group='otto/quiet'] .work-group-brain"));
});

test("harness editing has one keyboard and pointer Back contract without losing its draft", async () => {
  const { window, document, posts } = await bootWorkTable(workTableFixture(), { launchOptions, harnessRegistry });
  const origin = document.activeElement.closest("[data-work-cursor]")?.dataset.workCursor;

  press(window, "d");
  await settle(window, 5);
  document.querySelector("[data-open-harnesses]").click();
  await settle(window, 5);
  const label = document.querySelector("[data-harness-field='label']");
  label.value = "Codex restored";
  label.dispatchEvent(new window.Event("input", { bubbles: true }));
  label.focus();
  press(window, "Escape");
  await settle(window);
  assert.equal(document.querySelector("[data-harness-form]"), null);
  assert.equal(posts.some((entry) => entry.path === "/api/harnesses"), false, "Escape never saves");
  assert.equal(document.activeElement.closest("[data-work-cursor]")?.dataset.workCursor, origin);

  press(window, "d");
  await settle(window, 5);
  document.querySelector("[data-open-harnesses]").click();
  await settle(window);
  assert.equal(document.querySelector("[data-harness-field='label']").value, "Codex restored", "Back keeps the unsaved draft in memory");
  document.querySelector("[data-leave-harnesses]").click();
  await settle(window);
  assert.equal(document.activeElement.closest("[data-work-cursor]")?.dataset.workCursor, origin, "pointer Back uses the same return point");

  press(window, "d");
  await settle(window, 5);
  document.querySelector("[data-open-harnesses]").click();
  await settle(window);
  document.querySelector("[data-harness-field='label']").focus();
  press(window, "Enter", { metaKey: true });
  await settle(window, 5);
  assert.ok(posts.some((entry) => entry.path === "/api/harnesses"), "Command-Enter runs the visible Save action");
  assert.equal(document.querySelector("[data-harness-form]"), null);
});

test("switching from defaults to a Goal loads the Goal catalog and returns to that Goal", async () => {
  const allOptions = { ...launchOptions };
  delete allOptions.default;
  const { window, document, gets } = await bootWorkTable(plannedWorkFixture(), {
    /** Test helper for launchOptions. */
    launchOptions: (url) => url.searchParams.get("kind") === "all" ? allOptions : launchOptions,
  });

  press(window, "d");
  await settle(window, 5);
  const goal = document.querySelector("[data-goal-anchor='otto/tangent/goal-startable.md'] [data-work-row-title]");
  goal.click();
  await settle(window, 5);

  assert.equal(document.activeElement.dataset.launchHarness, "codex", "the Goal starts at its selected Harness");
  assert.equal(document.querySelector("[data-launch-harness='codex']").getAttribute("aria-checked"), "true", "the Goal receives its launch default, not the settings catalog");
  const launchRequests = gets.filter((url) => new URL(url).pathname === "/api/launch/options");
  assert.equal(new URL(launchRequests.at(-1)).searchParams.has("kind"), false, "the replacement chooser requests Goal launch options");
  press(window, "Escape");
  await settle(window);
  assert.equal(document.activeElement, document.querySelector("[data-goal-anchor='otto/tangent/goal-startable.md'] [data-work-row-title]"), "Back returns to the Goal that replaced the prior chooser");
});

test("Brain defaults are a nested Back stage and preserve the typed brain instruction", async () => {
  const fixture = withBrainOnlyArea(workTableFixture(), { live: false, planned: true });
  const { window, document } = await bootWorkTable(fixture, { launchOptions });
  const brain = document.querySelector("[data-work-group='otto/quiet'] .work-group-brain");
  brain.click();
  await settle(window, 5);
  const instruction = document.querySelector("#brain-instruction");
  instruction.value = "Keep this exact brain instruction.";
  instruction.dispatchEvent(new window.Event("input", { bubbles: true }));

  document.querySelector("[data-default-agents-origin='brain']").click();
  await settle(window, 5);
  assert.equal(document.activeElement.dataset.defaultAgentEdit, "brain", "nested settings starts at the Brain default");
  assert.equal(document.querySelector("[data-launch-close]").textContent.trim(), "Back");
  press(window, "Enter");
  await settle(window);
  press(window, "Escape");
  await settle(window);
  assert.equal(document.activeElement.dataset.defaultAgentEdit, "brain", "cancelling a Brain default edit returns to its own row");
  press(window, "Escape");
  await settle(window, 5);

  assert.equal(document.querySelector("#brain-instruction").value, "Keep this exact brain instruction.");
  assert.equal(document.activeElement.dataset.focusKey, "launch:brain:default", "Back restores the nested opener in the brain chooser");
  press(window, "Escape");
  await settle(window);
  assert.equal(document.activeElement, document.querySelector("[data-work-group='otto/quiet'] .work-group-brain"), "the next Back returns to the original Area row");
});

test("launch choices expose selected state and trap Tab while options load", async () => {
  let releaseOptions;
  const pendingOptions = new Promise((resolve) => { releaseOptions = resolve; });
  const { window, document } = await bootWorkTable(plannedWorkFixture(), {
    /** Test helper for launchOptions. */
    launchOptions: () => pendingOptions });

  document.querySelector("[data-goal-anchor='otto/tangent/goal-startable.md'] [data-work-row-title]").click();
  await settle(window);
  const popover = document.querySelector("[data-launch-popover]");
  assert.equal(document.activeElement, popover, "the loading chooser owns focus");
  const tab = press(window, "Tab");
  assert.equal(tab.defaultPrevented, true, "Tab cannot move behind a loading chooser");
  assert.equal(document.activeElement, popover);

  releaseOptions(launchOptions);
  await settle(window, 5);
  const selectedHarness = document.querySelector("[data-launch-column='harness'] [role='radio'][aria-checked='true']");
  assert.equal(selectedHarness?.dataset.launchHarness, "codex");
  assert.equal(selectedHarness.closest("[role='radiogroup']")?.getAttribute("aria-label"), "Harness");
});

test("a cached chooser opened from Commands keeps focus after the command modal closes", async () => {
  const { window, document } = await bootWorkTable(workTableFixture(), { launchOptions });
  let area = document.querySelector("[data-work-group='otto/onboarding'] .work-group-row");
  area.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  area.querySelector("[data-work-cursor-control]").focus();

  press(window, "d");
  await settle(window, 5);
  press(window, "Escape");
  await settle(window);
  area = document.querySelector("[data-work-group='otto/onboarding'] .work-group-row");
  area.querySelector("[data-work-cursor-control]").focus();
  press(window, ":", { shiftKey: true });
  await settle(window);
  const commands = document.querySelector("[data-modal-action='defaults']");
  assert.ok(commands, "Commands uses the same state-owned action rows as the pointer menu");
  commands.click();
  await settle(window, 5);

  const popover = document.querySelector("[data-launch-popover]");
  assert.ok(popover);
  assert.ok(popover.contains(document.activeElement), "modal return focus does not escape the newly opened chooser");
  assert.equal(document.activeElement.dataset.defaultAgentEdit, "work");
  window.close();
});

test("a chooser near the viewport bottom flips above its trigger", async () => {
  const { window, document } = await bootWorkTable(plannedWorkFixture(), { launchOptions });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  const trigger = document.querySelector("[data-goal-anchor='otto/tangent/goal-startable.md'] [data-work-row-title]");
  trigger.getBoundingClientRect = () => ({ top: 740, bottom: 770, right: 1_200 });
  trigger.click();
  await settle(window, 5);

  const popover = document.querySelector("[data-launch-popover]");
  assert.ok(popover);
  assert.equal(popover.style.top, "", "a flipped chooser no longer uses the unusable below-trigger top");
  assert.equal(popover.style.bottom, "68px", "the chooser bottom sits eight pixels above the trigger");
  assert.ok(Number.parseFloat(popover.style.maxHeight) > 600, "the full space above the trigger remains scrollable");
  window.close();
});
