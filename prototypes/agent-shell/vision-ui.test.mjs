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

test("the product vision keeps native chat and uses ordinary outcomes for shaped work", async () => {
  const [html, script] = await Promise.all([
    readFile(path.join(here, "public", "vision.html"), "utf8"),
    readFile(path.join(here, "public", "vision.js"), "utf8"),
  ]);
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/vision" });
  const { window } = dom;
  window.eval(script);

  assert.match(window.document.body.textContent, /Reload the thought before the controls/);
  assert.match(window.document.querySelector("#demo-shell").textContent, /Current brief/);
  assert.match(window.document.querySelector("#demo-shell").textContent, /Reply to Codex/);

  click(window, "[data-action='next']");
  assert.match(window.document.querySelector("#demo-shell").textContent, /OpenAI Codex/);
  assert.match(window.document.querySelector("#demo-shell").textContent, /Native agent surface/);
  assert.match(window.document.querySelector("#demo-shell").textContent, /design-tangent\.md/);
  assert.equal(window.document.querySelector("#demo-shell form"), null);
  assert.equal(window.document.querySelector("#demo-shell textarea"), null);

  click(window, "[data-scene='2']");
  submit(window, "[data-shape-form]");
  assert.match(window.document.querySelector("#demo-shell").textContent, /Complete scene loop works end to end/);
  assert.equal(window.document.querySelector("[data-scope]"), null);
  click(window, "[data-action='create-map']");
  click(window, "[data-select-shaped-outcome='parent']");
  assert.match(window.document.querySelector("#demo-shell").textContent, /Parent outcome/);
  assert.match(window.document.querySelector("#demo-shell").textContent, /See what the agent will do/);
  click(window, "[data-select-shaped-outcome='generation']");
  assert.match(window.document.querySelector("#demo-shell").textContent, /Generated terrain fits the current view/);

  click(window, "[data-scene='3']");
  assert.match(window.document.querySelector("#demo-shell").textContent, /Where work belongs/);
  assert.match(window.document.querySelector("#demo-shell").textContent, /Hackathon/);
  assert.match(window.document.querySelector("#demo-shell").textContent, /Live Edit/);
  click(window, "[data-action='new-root-project']");
  assert.match(window.document.querySelector("#demo-shell").textContent, /Add a top-level project/);
  click(window, "[data-action='project-tree']");
  click(window, "[data-action='move-project']");
  assert.match(window.document.querySelector("#demo-shell").textContent, /Path preview/);
  assert.match(window.document.querySelector("#demo-shell").textContent, /neara\/hackathon\/live-edit/);
  click(window, "[data-action='project-tree']");
  click(window, "[data-action='new-child-project']");
  submit(window, "[data-project-create-form]");
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
  assert.match(window.document.querySelector("#demo-shell").textContent, /Two-minute context/);
  assert.match(window.document.querySelector("#demo-shell").textContent, /Open question/);

  dom.window.close();
});
