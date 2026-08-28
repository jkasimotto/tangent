// Stars from the row and the starred-only switch
// (docs/design/area-star-focus/design-record.md, Decisions 1, 2, 5, 6, 8).

import test from "node:test";
import assert from "node:assert/strict";
import { bootWorkTable, press, settle } from "./work-table-harness.mjs";
import { workTableFixture } from "./work-table-fixture.mjs";

/** The Area roots the page stored. */
function storedFocus(window) {
  return JSON.parse(window.localStorage.getItem("agent-shell.area-focus.v1") || "null");
}

/** Moves the cursor onto one Work row by pointer. */
async function clickRow(window, document, cursor) {
  document.querySelector(`[data-work-cursor='${cursor}']`).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
}

test("f stars the Area under the cursor, from an Area row or a Goal row, and the row shows it", async () => {
  const { window, document } = await bootWorkTable(workTableFixture());
  assert.equal(document.querySelector(".area-focus-summary"), null, "no bar without stars");
  await clickRow(window, document, "goal:otto/standards/goal-framework-docs.md");
  press(window, "f");
  await settle(window);
  assert.deepEqual(storedFocus(window), { schema: "agent-shell.area-focus.v1", areas: ["otto/standards"] }, "f on a Goal stars its Area");
  const star = document.querySelector("[data-work-cursor='area:otto/standards'] .work-star");
  assert.ok(star.classList.contains("starred"), "the header prints its star");
  assert.equal(star.getAttribute("aria-pressed"), "true");
  assert.equal(star.textContent, "★");
  assert.equal(document.querySelector("[data-work-cursor].cursor").dataset.workCursor, "goal:otto/standards/goal-framework-docs.md", "the cursor stays on its row");
  assert.match(document.querySelector(".area-focus-summary").textContent, /Starred:\s*Standards/);
  assert.ok(document.querySelector("[data-work-group='__other-areas']"), "the unstarred Areas fold into Other Areas");
  assert.ok(!document.querySelector("[data-work-group='otto/standards']").classList.contains("folded"), "starring never folds a group");

  document.querySelector("[data-work-group='__other-areas'] [data-work-tree-action='expand']").click();
  await settle(window);
  await clickRow(window, document, "goal:otto/tangent/goal-compact-table.md");
  press(window, "f");
  await settle(window);
  assert.deepEqual(storedFocus(window).areas, ["otto/standards", "otto/tangent"], "a Goal inside Other Areas stars its Area too");
  assert.equal(document.querySelectorAll(".work-star.starred").length, 2);
  await clickRow(window, document, "area:otto/tangent");
  for (const button of document.querySelectorAll(".work-star")) assert.equal(button.dataset.workCommand, "starArea", "the pointer teaches the key");

  press(window, "f");
  await settle(window);
  assert.deepEqual(storedFocus(window).areas, ["otto/standards"], "f again unstars");
  document.querySelector("[data-work-cursor='area:otto/standards'] .work-star").click();
  await settle(window);
  assert.equal(storedFocus(window), null, "the star button is the pointer way, and the last unstar removes the record");
  assert.equal(document.querySelector(".area-focus-summary"), null);
});

test("F shows only the starred Areas and Escape unwinds it before the stars", async () => {
  const { window, document } = await bootWorkTable(workTableFixture(), { areaFocus: ["otto/tangent"] });
  document.querySelector("[data-work-cursor-control]").focus();
  press(window, "F", { shiftKey: true });
  await settle(window);
  assert.equal(document.querySelector("[data-work-group='__other-areas']"), null, "only starred: Other Areas is gone");
  assert.equal(document.querySelector("[data-starred-only='1']").getAttribute("aria-pressed"), "true");
  assert.deepEqual(storedFocus(window), { schema: "agent-shell.area-focus.v1", areas: ["otto/tangent"], only: true });

  await clickRow(window, document, "area:otto/tangent");
  press(window, "f");
  await settle(window);
  assert.equal(storedFocus(window), null, "unstarring the last Area in only mode shows everything again");
  assert.ok(document.querySelector("[data-work-group='otto/standards']"), "every Area is back");

  press(window, "F", { shiftKey: true });
  assert.match(document.querySelector("#toast").textContent, /Star an Area first/);
  document.querySelector("[data-work-cursor='area:otto/onboarding'] .work-star").click();
  await settle(window);
  document.querySelector("[data-starred-only='1']").click();
  await settle(window);
  assert.equal(document.querySelector("[data-work-group='__other-areas']"), null, "the switch is the pointer way");
  document.querySelector("[data-starred-only='0']").click();
  await settle(window);
  assert.ok(document.querySelector("[data-work-group='__other-areas']"), "All brings the other Areas back");
});

test("f on an Area inside a starred ancestor refuses and names the ancestor", async () => {
  const fixture = workTableFixture();
  fixture.vault.areas.push({ path: "otto/tangent/ui", name: "ui", goals: [], documents: [] });
  const { window, document } = await bootWorkTable(fixture, { areaFocus: ["otto/tangent"] });
  await clickRow(window, document, "area:otto/tangent/ui");
  press(window, "f");
  await settle(window);
  assert.match(document.querySelector("#toast").textContent, /Inside starred Otto \/ Tangent/);
  assert.deepEqual(storedFocus(window).areas, ["otto/tangent"]);
});
