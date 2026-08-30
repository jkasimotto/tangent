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

test("Work shows active and paused Processes at their exact Areas with state and controls", async () => {
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
  assert.equal(document.querySelector("[data-open-area-processes='otto/onboarding']"), null, "the active-loop summary stays limited to active loops");

  const tangentRows = [...document.querySelectorAll("[data-work-group='otto/tangent'] .work-process-row")];
  assert.deepEqual(tangentRows.map((row) => row.querySelector(".work-row-title").textContent), ["review", "triage"]);
  const paused = document.querySelector("[data-work-group='otto/onboarding'] .work-process-row.paused");
  assert.equal(paused.querySelector(".desk-state").textContent, "Paused");
  assert.equal(paused.querySelector("[data-control-process]").textContent, "Resume");
  assert.equal(paused.querySelector("[data-open-document]").getAttribute("aria-label"), "Inspect process paused");
  assert.equal(paused.querySelector("[data-remove-process]").textContent, "Remove");
  const scheduled = [...document.querySelectorAll("[data-work-group='otto/onboarding'] .work-process-row")]
    .find((row) => row.querySelector(".work-row-title").textContent === "scheduled");
  assert.equal(scheduled.querySelector("[data-remove-process]"), null);
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

test("Work Pause changes the exact Process once and restores focus", async () => {
  const fixture = withProcesses([process("otto/tangent", "review"), process("otto/standards", "review")]);
  const { window, document, posts } = await bootWorkTable(fixture, {
    /** Applies the server's exact-process mutation to the projected fixture. */
    postHandler: ({ path, body }) => {
      if (path !== "/api/processes/control") return { ok: true };
      const item = fixture.programs.processes.find((candidate) => candidate.area === body.area && candidate.slug === body.slug && candidate.file === body.file);
      item.status = "paused";
      item.state = "Paused";
      return { ok: true, process: structuredClone(item) };
    },
  });
  const pause = document.querySelector(".work-process-row [data-process-area='otto/tangent'][data-process-slug='review'][data-control-process]");
  assert.equal(pause.textContent, "Pause");
  assert.equal(pause.getAttribute("aria-label"), "Pause process review in Otto / Tangent");
  click(window, pause);
  assert.equal(pause.textContent, "Pausing…");
  assert.equal(pause.getAttribute("aria-busy"), "true");
  click(window, pause);
  await settle(window, 6);

  assert.deepEqual(posts.filter((entry) => entry.path === "/api/processes/control").map((entry) => entry.body), [
    { area: "otto/tangent", slug: "review", file: "otto/tangent/process-review.md", action: "pause" },
  ]);
  assert.equal(document.querySelector("[data-open-area-processes='otto/tangent']"), null);
  assert.ok(document.querySelector("[data-open-area-processes='otto/standards']"));
  assert.equal(document.activeElement.dataset.processSlug, "review");
});

test("Area Processes shows Pause and Resume and restores focus after control", async () => {
  const fixture = withProcesses([process("otto/tangent", "review")]);
  const { window, document } = await bootWorkTable(fixture, {
    /** Applies Stop or Resume to the process returned by the fake server. */
    postHandler: ({ path, body }) => {
      if (path !== "/api/processes/control") return { ok: true };
      const item = fixture.programs.processes[0];
      item.status = body.action === "pause" ? "paused" : "active";
      item.state = item.status === "paused" ? "Paused" : "Loop";
      return { ok: true, process: structuredClone(item) };
    },
  });
  click(window, document.querySelector("[data-open-area-processes='otto/tangent']"));
  await settle(window);
  const pause = document.querySelector(".area-processes [data-control-process]");
  assert.equal(pause.textContent, "Pause");
  click(window, pause);
  await settle(window, 6);
  const resume = document.querySelector(".area-processes [data-control-process]");
  assert.equal(resume.textContent, "Resume");
  assert.equal(document.activeElement, resume);
});

test("a failed Work Process control restores its action, focus, and honest state", async () => {
  const fixture = withProcesses([process("otto/tangent", "review")]);
  const { window, document } = await bootWorkTable(fixture, {
    /** Returns a server-shaped commit failure for the Process mutation. */
    postHandler: ({ path }) => path === "/api/processes/control"
      ? {
          ok: false,
          status: 409,
          /** Reads the fixture error body. */
          async json() { return { error: "vault commit failed" }; },
        }
      : { ok: true },
  });
  const pause = document.querySelector(".work-process-row [data-control-process]");
  click(window, pause);
  await settle(window, 6);

  const restored = document.querySelector(".work-process-row [data-control-process]");
  assert.equal(restored.textContent, "Pause");
  assert.equal(restored.disabled, false);
  assert.equal(document.activeElement, restored);
  assert.equal(document.querySelector(".work-process-row .desk-state").textContent, "Loop");
  assert.match(document.querySelector("#toast").textContent, /process did not change: vault commit failed/i);
});

test("Work Remove confirms and removes the exact loop while keeping its Area focusable", async () => {
  const fixture = withProcesses([process("otto/tangent", "review"), process("otto/standards", "review")]);
  const { window, document, posts } = await bootWorkTable(fixture, {
    /** Applies the exact-file removal to the refreshed projection. */
    postHandler: ({ path, body }) => {
      if (path !== "/api/processes/remove") return { ok: true };
      fixture.programs.processes = fixture.programs.processes.filter((item) => item.file !== body.file);
      return { ok: true, file: body.file, area: body.area, slug: body.slug };
    },
  });
  window.confirm = () => true;
  click(window, document.querySelector(".work-process-row [data-remove-process][data-process-area='otto/tangent']"));
  await settle(window, 6);

  assert.deepEqual(posts.find((entry) => entry.path === "/api/processes/remove").body, {
    area: "otto/tangent", slug: "review", file: "otto/tangent/process-review.md",
  });
  assert.equal(document.querySelector(".work-process-row [data-process-area='otto/tangent']"), null);
  assert.equal(document.activeElement.dataset.focusKey, "area:otto/tangent");
  assert.ok(document.querySelector(".work-process-row [data-process-area='otto/standards']"));
});
