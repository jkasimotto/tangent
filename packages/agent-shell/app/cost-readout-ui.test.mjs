import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { costAmountText, costBreakdownMarkup, costTitleText, renderCostReadout } from "./public/cost-readout.js";

/** The three elements the top bar readout writes into. */
function readoutDom() {
  const dom = new JSDOM(`<div id="cost-readout" class="cost-readout" hidden>
    <span id="cost-amount" class="cost-amount" tabindex="0"></span>
    <div id="cost-breakdown" class="cost-breakdown"></div>
  </div>`);
  const { document } = dom.window;
  return {
    readout: document.querySelector("#cost-readout"),
    amount: document.querySelector("#cost-amount"),
    breakdown: document.querySelector("#cost-breakdown"),
  };
}

/** One ready snapshot, as `GET /api/cost` returns it. */
function snapshot(overrides = {}) {
  return {
    status: "ready", days: 1, since: "2026-09-03T00:00:00.000Z", computedAt: "2026-09-03T06:00:00.000Z",
    amount: 388.1, display: "$388", currency: "USD", complete: true, conversations: 85,
    byHarness: [{ harness: "claude-otto", amount: 301, display: "$301" }],
    byModel: [{ id: "anthropic/claude-opus-5", amount: 372, display: "$372" }],
    work: [{ scope: "job", area: "otto/tangent", name: "otto/tangent/goal-price-every-job.md", amount: 44, display: "$44" }],
    excluded: [],
    ...overrides,
  };
}

test("a complete figure is the plain amount", () => {
  assert.equal(costAmountText(snapshot()), "$388");
  assert.equal(costTitleText(snapshot()), "Estimated cost of today");
});

test("a figure that leaves something out is marked, on its face and in its title", () => {
  const partial = snapshot({ complete: false, excluded: [{ reason: "no rate for openai/gpt-5.6-sol", detail: "1.8B tokens. Add a rate to pricing.md.", count: 1 }] });
  assert.equal(costAmountText(partial), "~$388");
  assert.match(costTitleText(partial), /leaves out the work named in the breakdown/);
});

test("nothing is shown as a figure before the first reading finishes", () => {
  assert.equal(costAmountText({ status: "reading", days: 1 }), "…");
  assert.match(costBreakdownMarkup({ status: "reading", days: 1 }), /Reading transcripts/);
});

test("the breakdown answers where the money went before it answers anything else", () => {
  const markup = costBreakdownMarkup(snapshot());
  const order = ["Work", "Harness", "Model"].map((heading) => markup.indexOf(`>${heading}<`));
  assert.deepEqual(order, [...order].sort((left, right) => left - right));
  assert.ok(order.every((index) => index > 0));
  // A Goal is named the way a person would say it: not its vault path, not
  // its `goal-` prefix, and not its `.md` suffix.
  assert.match(markup, /<span>price every job<\/span>/);
  // The caveat travels with the number and is never dropped.
  assert.match(markup, /On a subscription this measures work done, not money spent/);
  assert.match(markup, /85 conversations/);
});

test("a brain is named as a brain, and every exclusion is stated in words", () => {
  const markup = costBreakdownMarkup(snapshot({
    complete: false,
    work: [{ scope: "brain", area: "otto/tangent", name: "otto/tangent brain", amount: 32, display: "$32" }],
    excluded: [
      { reason: "no rate for openai/gpt-5.6-sol", detail: "1.8B tokens. Add a rate to pricing.md.", count: 1 },
      { reason: "the codex-gw harness declares no transcripts folder", detail: null, count: 14 },
    ],
  }));
  assert.match(markup, /otto\/tangent brain/);
  assert.match(markup, /Not in this number/);
  assert.match(markup, /no rate for openai\/gpt-5\.6-sol/);
  assert.match(markup, /1\.8B tokens\. Add a rate to pricing\.md\./);
  assert.match(markup, /the codex-gw harness declares no transcripts folder/);
  assert.match(markup, />14</);
});

test("an empty group is left out rather than printed as an empty heading", () => {
  const markup = costBreakdownMarkup(snapshot({ work: [], byHarness: [], byModel: [] }));
  assert.equal(markup.includes(">Work<"), false);
  assert.equal(markup.includes(">Harness<"), false);
  assert.equal(markup.includes(">Model<"), false);
});

test("a name from a record cannot inject markup into the bar", () => {
  const markup = costBreakdownMarkup(snapshot({ work: [{ scope: "job", area: "a", name: "<img src=x onerror=alert(1)>", amount: 1, display: "$1" }] }));
  assert.equal(markup.includes("<img"), false);
  assert.match(markup, /&lt;img/);
});

test("the readout stays hidden until there is a snapshot, then shows the figure", () => {
  const dom = readoutDom();
  renderCostReadout(dom, null);
  assert.equal(dom.readout.hidden, true);
  renderCostReadout(dom, snapshot());
  assert.equal(dom.readout.hidden, false);
  assert.equal(dom.amount.textContent, "$388");
  assert.equal(dom.readout.classList.contains("cost-incomplete"), false);
  assert.match(dom.breakdown.innerHTML, /claude-otto/);
});

test("an incomplete figure carries the class the bar colours it with", () => {
  const dom = readoutDom();
  renderCostReadout(dom, snapshot({ complete: false, excluded: [{ reason: "x", detail: null, count: 1 }] }));
  assert.equal(dom.readout.classList.contains("cost-incomplete"), true);
  renderCostReadout(dom, snapshot());
  assert.equal(dom.readout.classList.contains("cost-incomplete"), false);
});

test("the figure is reachable by keyboard, so the breakdown opens without a pointer", () => {
  const dom = readoutDom();
  assert.equal(dom.amount.getAttribute("tabindex"), "0");
});
