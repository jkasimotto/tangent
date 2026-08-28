// A Goal with no live session never starts one from the browser (ADR-0041,
// amendment 2026-08-28). Both openers of a Goal agent, the Work row route
// and the reader's Open agent, hand the ask to the Area brain composer,
// prefilled with the Goal so Julian only has to send it.

import test from "node:test";
import assert from "node:assert/strict";
import { bootWorkTable, press, settle } from "./work-table-harness.mjs";
import { workTableFixture } from "./work-table-fixture.mjs";

/** The reader's detail record for one fixture Goal with no session and no attempt. */
function detailFor(goal) {
  return {
    goal, markdown: `# ${goal.title}\n\nA note.`,
    dependencies: { prerequisites: [], requiredBy: [], unresolvedReferences: [], blockers: [], broken: [], blocked: false },
    relatedDocuments: [], queue: null, sessions: [], attempts: [], current: null,
    commands: [{ id: "read", label: "Read", enabled: true }, { id: "status", label: "Goal status", enabled: true }],
  };
}

test("the reader's Open agent on a Goal with no session asks the brain to start one", async () => {
  const fixture = workTableFixture();
  const goal = fixture.goals.find((item) => item.slug === "walkthrough");
  assert.equal(goal.session ?? null, null, "the fixture Goal has no session");
  const documentRecord = { file: goal.file, title: goal.title, area: goal.area, text: `# ${goal.title}\n\nA note.`, comments: [] };
  const { window, document, posts } = await bootWorkTable(fixture, { goalDetail: detailFor(goal), documentRecord });

  const row = document.querySelector(`[data-goal-anchor='${goal.file}']`);
  row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  row.querySelector("[data-work-row-title]").focus();
  press(window, "o");
  await settle(window, 5);
  const open = document.querySelector("[data-open-reader-agent]");
  assert.ok(open, "the reader offers Open agent for an open Goal");
  open.click();
  await settle(window, 3);

  assert.equal(document.querySelector("#describe-area")?.value, goal.area, "the composer is for the Goal's own Area brain");
  assert.equal(document.querySelector("#describe-work")?.value, `Start an agent on ${goal.title} (${goal.file})`, "the message names the Goal");
  assert.equal(posts.filter((post) => post.path.startsWith("/api/goals")).length, 0, "nothing started");
});

test("the Work row route of a Goal whose session is gone asks the brain, it never starts an agent itself", async () => {
  const fixture = workTableFixture();
  const goal = fixture.goals.find((item) => item.slug === "inconsistencies");
  // The pipeline still names a live step, but the session is no longer in
  // the list: the row keeps its run route and the route has nothing to open.
  fixture.sessions = fixture.sessions.filter((session) => session.goal !== goal.file);
  const { window, document, posts } = await bootWorkTable(fixture);
  const title = document.querySelector(`[data-goal-anchor='${goal.file}'] .work-cell-agent [data-open-goal-run]`);
  assert.equal(title?.dataset.openGoalRun, goal.file, "the Agent cell keeps the run route");
  title.click();
  await settle(window, 3);

  assert.equal(document.querySelector("#describe-area")?.value, goal.area);
  assert.equal(document.querySelector("#describe-work")?.value, `Start an agent on ${goal.title} (${goal.file})`);
  assert.equal(posts.filter((post) => post.path.startsWith("/api/goals")).length, 0, "nothing started");
});
