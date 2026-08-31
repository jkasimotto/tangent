import assert from "node:assert/strict";
import test from "node:test";
import { bootWorkTable, press, settle } from "./work-table-harness.mjs";
import { workTableFixture } from "./work-table-fixture.mjs";

/** Exercises one Park confirmation path while its request remains pending. */
async function parkJourney(finalInput) {
  let release;
  const delayed = new Promise((resolve) => { release = resolve; });
  const fixture = workTableFixture();
  const goal = fixture.vault.areas.flatMap((area) => area.goals ?? []).find((item) => item.status === "open" || item.status === "active");
  const { window, document, posts } = await bootWorkTable(fixture, {
    /** Holds only the Park request so visible response can be asserted first. */
    postHandler: ({ path, body }) => path === "/api/goals/edit" && body.status === "parked" ? delayed : { ok: true },
  });
  const row = document.querySelector(`[data-goal-anchor='${goal.file}']`);
  row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  row.querySelector("[data-work-row-title]").focus();
  press(window, "x");
  await settle(window);
  assert.ok(document.querySelector("[data-modal-action='parked']"));
  press(window, "p");
  await settle(window);
  assert.match(document.querySelector("#modal-title").textContent, /Park/);
  if (finalInput === "pointer") document.querySelector("[data-modal-confirm]").click();
  else press(window, "Enter", { metaKey: true });
  assert.equal(document.querySelector("#modal-layer").hidden, true, `${finalInput} confirmation closes immediately`);
  assert.equal(document.querySelector(`[data-goal-anchor='${goal.file}']`), null, `${finalInput} confirmation removes the Goal immediately`);
  assert.equal(posts.filter((entry) => entry.path === "/api/goals/edit" && entry.body.status === "parked").length, 1);
  const request = posts.at(-1);
  assert.match(request.body.operationId, /^[0-9a-f-]{36}$/);
  release({ state: "committed", operationId: request.body.operationId, effect: { goalStatus: "parked" } });
  await settle(window);
}

test("Park responds immediately for pointer and keyboard confirmation while durability is delayed", async () => {
  await parkJourney("pointer");
  await parkJourney("keyboard");
});
