import assert from "node:assert/strict";
import test from "node:test";

import { bootWorkTable, press, settle } from "./work-table-harness.mjs";
import { workTableFixture } from "./work-table-fixture.mjs";

/** Builds one projected process record for a Work fixture. */
function process(area, slug, extra = {}) {
  return {
    area, slug, file: `${area}/process-${slug}.md`, title: slug, loop: true,
    status: "active", error: "", brainLive: true, every: "20m",
    body: `Review ${slug}.`, when: "Every 20m, to the brain", state: "Loop",
    nextRunAt: "2026-08-28T10:20:00.000Z", lastRunAt: "2026-08-28T10:00:00.000Z",
    ...extra,
  };
}

/** Adds the process projection to the standard Work fixture. */
function withProcesses(items) {
  const fixture = workTableFixture();
  fixture.programs = { operations: [], processes: items, problems: [], areas: [], liveCount: 0 };
  return fixture;
}

/** Activates one DOM control through the delegated click route. */
function click(window, element) {
  element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
}

test("Work shows exact-Area active loop counts and runtime state", async () => {
  const fixture = withProcesses([
    process("otto/tangent", "review"),
    process("otto/tangent", "triage"),
    process("otto/standards", "waiting", { brainLive: false, state: "Waiting for brain" }),
    process("otto/onboarding", "paused", { status: "paused", state: "Paused" }),
    process("otto/onboarding", "broken", { error: "Missing every", state: "Broken note" }),
    process("otto/onboarding", "scheduled", { loop: false }),
    process("otto/onboarding", "probe", { loop: false, when: "When tests fail" }),
  ]);
  const { document } = await bootWorkTable(fixture);

  const on = document.querySelector("[data-open-area-processes='otto/tangent']");
  const waiting = document.querySelector("[data-open-area-processes='otto/standards']");
  assert.equal(on.textContent, "↻ 2 loops · on");
  assert.equal(on.getAttribute("aria-label"), "Otto / Tangent has 2 active loops, on. Open Processes.");
  assert.equal(waiting.textContent, "↻ 1 loop · waiting");
  assert.equal(document.querySelector("[data-open-area-processes='otto/onboarding']"), null);
});

test("the loop control opens Processes and Escape restores its Work focus and scroll", async () => {
  const fixture = withProcesses([process("otto/tangent", "review")]);
  const { window, document } = await bootWorkTable(fixture);
  const opener = document.querySelector("[data-open-area-processes='otto/tangent']");
  opener.focus();
  document.querySelector("#screen").scrollTop = 73;
  click(window, opener);
  await settle(window);

  assert.equal(document.activeElement.id, "area-processes-heading");
  assert.equal(document.querySelector(".area-processes .process-open strong").textContent, "review");

  press(window, "Escape");
  await settle(window);
  assert.equal(document.activeElement.dataset.focusKey, "loops:otto/tangent");
  assert.equal(document.querySelector("#screen").scrollTop, 73);
});

test("Active-only keeps an Area whose active loop waits for its brain", async () => {
  const fixture = withProcesses([process("otto/onboarding", "waiting", { brainLive: false, state: "Waiting for brain" })]);
  fixture.sessions = fixture.sessions.filter((item) => item.area !== "otto/onboarding" && item.goal?.startsWith("otto/onboarding/") !== true);
  fixture.brains = fixture.brains.filter((item) => item.area !== "otto/onboarding");
  fixture.pipelines = fixture.pipelines.filter((item) => !item.goal.startsWith("otto/onboarding/"));
  const { window, document } = await bootWorkTable(fixture);

  press(window, "A", { shiftKey: true });
  await settle(window);
  assert.ok(document.querySelector("[data-work-group='otto/onboarding']"));
  assert.equal(document.querySelector("[data-open-area-processes='otto/onboarding']").textContent, "↻ 1 loop · waiting");
});
