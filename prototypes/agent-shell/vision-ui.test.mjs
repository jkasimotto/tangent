import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Clicks one required element in the browser-like test document. */
function click(window, selector) {
  const element = window.document.querySelector(selector);
  assert.ok(element, `Expected ${selector}`);
  element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}

/** Submits one required form in the browser-like test document. */
function submit(window, selector) {
  const form = window.document.querySelector(selector);
  assert.ok(form, `Expected ${selector}`);
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
}

test("the product vision keeps native chat and uses flexible work boundaries", async () => {
  const [html, script] = await Promise.all([
    readFile(path.join(here, "public", "vision.html"), "utf8"),
    readFile(path.join(here, "public", "vision.js"), "utf8"),
  ]);
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/vision" });
  const { window } = dom;
  window.eval(script);

  assert.match(window.document.body.textContent, /Reload the thought before the controls/);
  assert.match(window.document.querySelector("#demo-shell").textContent, /Current brief/);
  assert.doesNotMatch(window.document.querySelector("#demo-shell").textContent, /What changed|Two-minute context/);
  assert.match(window.document.querySelector("#demo-shell").textContent, /Design Document: Live Edit Collaboration/);
  assert.match(window.document.querySelector("#demo-shell").textContent, /Reply to Codex/);

  click(window, "[data-action='next']");
  assert.match(window.document.querySelector("#demo-shell").textContent, /OpenAI Codex/);
  assert.match(window.document.querySelector("#demo-shell").textContent, /Native agent surface/);
  assert.match(window.document.querySelector("#demo-shell").textContent, /design-tangent\.md/);
  assert.equal(window.document.querySelector("#demo-shell form"), null);
  assert.equal(window.document.querySelector("#demo-shell textarea"), null);

  click(window, "[data-scene='2']");
  submit(window, "[data-describe-form]");
  assert.ok(window.document.querySelector("[aria-label='Native conversation about new work']"));
  assert.match(window.document.querySelector("#demo-shell").textContent, /Otto \/ D&D repository/);
  assert.match(window.document.querySelector("#demo-shell").textContent, /Before I create Goals/);
  assert.match(window.document.querySelector("#demo-shell").textContent, /Continue defining the work/);
  assert.equal(window.document.querySelector("[data-scope]"), null);
  assert.doesNotMatch(window.document.querySelector("#demo-shell").textContent, /Review execution plan|Read what will happen/);

  click(window, "[data-scene='3']");
  assert.match(window.document.querySelector("#demo-shell").textContent, /Where work belongs/);
  assert.match(window.document.querySelector("#demo-shell").textContent, /Hackathon/);
  assert.match(window.document.querySelector("#demo-shell").textContent, /Live Edit/);
  click(window, "[data-action='new-root-area']");
  assert.match(window.document.querySelector("#demo-shell").textContent, /Add a top-level Area/);
  click(window, "[data-action='area-tree']");
  click(window, "[data-action='move-area']");
  assert.match(window.document.querySelector("#demo-shell").textContent, /Path preview/);
  assert.match(window.document.querySelector("#demo-shell").textContent, /neara\/hackathon\/live-edit/);
  click(window, "[data-action='area-tree']");
  click(window, "[data-action='new-nested-area']");
  submit(window, "[data-area-create-form]");
  assert.match(window.document.querySelector("#demo-shell").textContent, /Live Edit/);

  click(window, "[data-scene='4']");
  assert.match(window.document.querySelector("#demo-shell").textContent, /Things that run/);
  assert.match(window.document.querySelector("#demo-shell").textContent, /Development server/);
  assert.match(window.document.querySelector("#demo-shell").textContent, /Daily remediation run/);
  click(window, "[data-program='dnd-server']");
  assert.match(window.document.querySelector("#demo-shell").textContent, /Open session/);
  click(window, "[data-action='stop-dnd-server']");
  assert.match(window.document.querySelector("#demo-shell").textContent, /Stop the D&D server/);
  click(window, "[data-action='confirm-stop-dnd-server']");
  assert.match(window.document.querySelector("#demo-shell").textContent, /Stopped/);
  assert.match(window.document.querySelector("#demo-shell").textContent, /scrollback/);
  click(window, "[data-action='program-list']");
  click(window, "[data-program='daily-agent']");
  assert.match(window.document.querySelector("#demo-shell").textContent, /Tomorrow at 07:30/);
  assert.match(window.document.querySelector("#demo-shell").textContent, /skips the duplicate/);

  click(window, "[data-scene='5']");
  click(window, "[data-action='awake']");
  assert.match(window.document.querySelector("#demo-shell").textContent, /Mac stays awake/);

  click(window, "[data-scene='6']");
  assert.match(window.document.querySelector("#demo-shell").textContent, /Document/);
  assert.match(window.document.querySelector("#demo-shell").textContent, /design-live-edit-collaboration\.md/);
  assert.equal(window.document.querySelectorAll(".vision-table-wrap table").length, 1);
  assert.equal(window.document.querySelector(".vision-review-nav"), null);
  assert.ok(window.document.querySelector(".vision-reader"));
  assert.equal(window.document.querySelector(".shell-context").textContent, "");
  assert.equal(window.document.querySelectorAll(".vision-document-picker [data-review-document]").length, 3);
  assert.match(window.document.querySelector(".vision-page-outline").textContent, /On this page/);
  assert.match(window.document.querySelector(".vision-reader-toolbar").textContent, /Open agent/);
  assert.equal(window.document.querySelector("[data-action='review-back']").disabled, true);
  click(window, ".vision-doc-link");
  assert.match(window.document.querySelector(".vision-document-page").textContent, /Shared boundaries are explicit and small/);
  assert.equal(window.document.querySelector("[data-action='review-back']").disabled, false);
  click(window, "[data-action='review-back']");
  assert.match(window.document.querySelector(".vision-document-page").textContent, /Project edits/);
  click(window, "[data-action='review-forward']");
  assert.match(window.document.querySelector(".vision-document-page").textContent, /Observable behavior wins/);
  click(window, "[data-action='open-reader-agent']");
  assert.equal(window.document.querySelector(".vision-reader"), null);
  assert.match(window.document.querySelector(".native-chat").textContent, /edit or consolidate Documents/);
  assert.match(window.document.querySelector(".native-chat").textContent, /complete Goal, all three linked Documents/);
  click(window, "[data-action='close-reader-agent']");
  assert.ok(window.document.querySelector(".vision-reader"));
  assert.match(window.document.querySelector(".vision-document-page").textContent, /Observable behavior wins/);

  dom.window.close();
});
