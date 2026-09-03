// What a worker cost, on the two surfaces where a person meets a worker.
//
// The proofs here are the honesty rules the cost work established, read from
// the outside: no guessed dollar, a floor that reads as one, and whatever the
// figure leaves out named on the same surface.

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { bootWorkTable } from "./work-table-harness.mjs";
import { withBrainOnlyArea, workTableFixture } from "./work-table-fixture.mjs";
import { paintWorkerCosts, workerCostClass, workerCostMarkup, workerCostText, workerCostTitle } from "./public/worker-cost.js";

/** One worker index entry, as `GET /api/cost/workers` returns it. */
function entry(overrides = {}) {
  return {
    amount: 12.3, display: "$12.30", floor: false, conversations: 1, workers: 1,
    harnesses: ["claude-otto"], unpricedTokens: 0, unpricedDisplay: null,
    subagents: "Subagents are inside this figure: Claude's own ledger already counts them.",
    reasons: [],
    ...overrides,
  };
}

test("a finished, fully priced worker shows a plain dollar", () => {
  assert.equal(workerCostText(entry()), "$12.30");
  assert.equal(workerCostClass(entry()), "worker-cost");
  assert.match(workerCostTitle(entry(), "Redesign Work"), /\$12\.30 for Redesign Work: 1 conversation on claude-otto\./);
});

test("a live worker's figure reads as a floor and says why on the same surface", () => {
  const live = entry({ floor: true, reasons: ["this worker is still running, so this is what it has cost so far"] });
  assert.equal(workerCostText(live), "~$12.30");
  assert.match(workerCostClass(live), /worker-cost-floor/);
  const title = workerCostTitle(live, "Redesign Work");
  assert.match(title, /Not in this figure:/);
  assert.match(title, /still running/);
});

test("a worker with no rate shows tokens and the reason, never a dollar", () => {
  const unrated = entry({
    amount: 0, display: "$0", floor: true, unpricedTokens: 1_800_000, unpricedDisplay: "1.8M tok",
    reasons: ["no rate for openai/gpt-5.6-sol: 1.8M tokens are not in this figure. Add a rate to pricing.md."],
  });
  assert.equal(workerCostText(unrated), "1.8M tok");
  assert.match(workerCostClass(unrated), /worker-cost-tokens/);
  assert.match(workerCostTitle(unrated, "Extract NESC"), /Add a rate to pricing\.md/);
});

test("a worker nothing was recorded for shows a dash, not a zero", () => {
  assert.equal(workerCostText(null), "—");
  assert.match(workerCostClass(null), /worker-cost-none/);
  assert.match(workerCostTitle(null, "Redesign Work"), /Nothing has been recorded for Redesign Work yet\./);
});

test("what the figure covers, including its subagents, is stated before what it leaves out", () => {
  const many = entry({ workers: 3, conversations: 5, harnesses: ["claude-otto", "codex-otto"] });
  const title = workerCostTitle(many, "Redesign Work");
  assert.match(title, /3 workers over 5 conversations on claude-otto and codex-otto/);
  assert.ok(title.indexOf("Subagents are inside this figure") < title.indexOf("List prices"));
});

test("a reason from a record cannot inject markup into a figure", () => {
  const nasty = entry({ floor: true, reasons: ["<img src=x onerror=alert(1)>"] });
  const markup = workerCostMarkup(nasty, "<b>goal</b>");
  assert.equal(markup.includes("<img"), false);
  assert.equal(markup.includes("<b>goal</b>"), false);
});

test("figures are written in place, so a changed dollar never repaints a row", () => {
  // A bare cell outside a table is dropped by the HTML parser, so the row it
  // belongs in is written out.
  const dom = new JSDOM(`<table><tbody><tr><td data-worker-cost="job:otto/tangent/goal-a.md" data-worker-cost-subject="A"></td></tr></tbody></table>
    <span data-worker-cost="tangent--table" data-worker-cost-scope="session" data-worker-cost-subject="this worker"></span>`);
  const { document } = dom.window;
  paintWorkerCosts(document, {
    work: { "job:otto/tangent/goal-a.md": entry({ display: "$40", amount: 40 }) },
    sessions: { "tangent--table": entry({ display: "$4", amount: 4, floor: true, reasons: ["this worker is still running, so this is what it has cost so far"] }) },
  });
  assert.equal(document.querySelector("td[data-worker-cost]").textContent, "$40");
  assert.equal(document.querySelector('[data-worker-cost-scope="session"]').textContent, "~$4");
});

test("the Work table carries one Cost cell per Goal row, keyed by the Goal file", async () => {
  const fixture = workTableFixture();
  const table = fixture.goals.find((goal) => goal.slug === "compact-table");
  const { document } = await bootWorkTable(fixture, {
    workerCost: {
      work: {
        [`job:${table.file}`]: entry({ amount: 44, display: "$44", workers: 2, conversations: 3 }),
      },
      // The brain's figure is its live session's own, so it is keyed the way
      // a session is keyed.
      sessions: { "otto-tangent--brain": entry({ amount: 9, display: "$9" }) },
    },
  });

  const cell = document.querySelector(`[data-worker-cost="job:${table.file}"]`);
  assert.ok(cell, "the Goal's row carries a Cost cell keyed by its file");
  assert.equal(cell.textContent.trim(), "$44");
  assert.match(cell.querySelector(".worker-cost").title, /2 workers over 3 conversations/);

  // Every Goal row has the cell, and a Goal with nothing recorded shows a dash
  // rather than a zero that would read as free.
  const rows = [...document.querySelectorAll(".work-table tr.desk-goal")];
  assert.ok(rows.length > 1);
  assert.equal(rows.every((row) => row.querySelector(".work-cell-cost")), true);
  const walkthrough = document.querySelector('[data-worker-cost="job:otto/onboarding/goal-walkthrough.md"]');
  assert.equal(walkthrough.textContent.trim(), "—");

  // An Area brain has no row of its own, so its live session's figure rides
  // in the group header, keyed by that session.
  assert.equal(document.querySelector('[data-worker-cost="otto-tangent--brain"]').textContent.trim(), "$9");

  // Every row keeps the column count, so no cell slides into the wrong column.
  const columns = document.querySelectorAll(".work-table thead th").length;
  for (const row of document.querySelectorAll(".work-table tbody tr:not(.work-group-row):not(.work-empty-row)")) {
    assert.equal(row.children.length, columns, `row ${row.className} has ${row.children.length} cells, not ${columns}`);
  }
});

test("a brain with no live session shows no figure at all", async () => {
  const fixture = withBrainOnlyArea(workTableFixture(), { live: false, planned: true });
  const { document } = await bootWorkTable(fixture, {
    // The stopped brain's Area ran before and its spend is on the machine.
    // It is still not printed: the figure answers what is running now.
    workerCost: { work: { "brain:otto/quiet": entry({ amount: 9, display: "$9" }) }, sessions: { "otto-quiet--brain": entry({ amount: 9, display: "$9" }) } },
  });

  const quiet = document.querySelector('[data-work-area="otto/quiet"]');
  assert.ok(quiet, "the Area with the stopped brain is on the table");
  assert.equal(quiet.querySelector(".work-group-cost"), null);
  // The Area whose brain is live still carries its figure on the same table.
  assert.ok(document.querySelector('[data-work-area="otto/tangent"] .work-group-cost'));
});
