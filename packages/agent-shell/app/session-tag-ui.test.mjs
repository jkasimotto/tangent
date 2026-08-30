import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootWorkTable, press, settle } from "./work-table-harness.mjs";
import { workTableFixture } from "./work-table-fixture.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Opens the fixture's live Goal worker through the shared session-layer route. */
async function openGoalSession() {
  const result = await bootWorkTable(workTableFixture());
  const row = result.document.querySelector("[data-work-cursor='goal:otto/standards/goal-framework-docs.md']");
  row.dispatchEvent(new result.window.MouseEvent("click", { bubbles: true }));
  await settle(result.window);
  press(result.window, "Enter", { metaKey: true, shiftKey: true });
  await settle(result.window);
  return result;
}

test("every shared agent header prints the exact tmux tag in a native copy control", async () => {
  const { document } = await openGoalSession();
  const copy = document.querySelector("#session-layer [data-copy-session-tag]");
  assert.equal(copy.tagName, "BUTTON");
  assert.equal(copy.type, "button");
  assert.equal(copy.dataset.copySessionTag, "standards--docs");
  assert.equal(copy.querySelector("code").textContent, "standards--docs");
  assert.equal(copy.getAttribute("aria-label"), "Copy tmux session tag standards--docs");
  assert.equal(document.querySelectorAll("[data-copy-session-tag]").length, 1);
});

test("pointer or native keyboard activation copies only the exact tag and reports success", async () => {
  const { window, document } = await openGoalSession();
  const copied = [];
  Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: {
    /** Records the exact clipboard payload without touching the host clipboard. */
    async writeText(value) { copied.push(value); },
  } });
  const copy = document.querySelector("[data-copy-session-tag]");
  copy.click();
  await settle(window);
  assert.deepEqual(copied, ["standards--docs"]);
  assert.equal(copy.querySelector("[role='status']").textContent, "Copied");
  assert.match(document.querySelector("#toast").textContent, /Copied standards--docs/);
});

test("clipboard failure stays in the header and gives accessible failure feedback", async () => {
  const { window, document } = await openGoalSession();
  Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: {
    /** Models a browser that denies clipboard access. */
    async writeText() { throw new Error("denied"); },
  } });
  const copy = document.querySelector("[data-copy-session-tag]");
  copy.click();
  await settle(window);
  assert.equal(copy.dataset.copyState, "failure");
  assert.equal(copy.querySelector("[role='status']").textContent, "Could not copy");
  assert.match(document.querySelector("#toast").textContent, /Could not copy standards--docs/);
});

test("the exact tag wraps without truncation in the narrow session header", async () => {
  const css = await readFile(path.join(here, "public", "shell.css"), "utf8");
  assert.match(css, /\.session-tag code \{[^}]*overflow-wrap: anywhere/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.session-tag \{[^}]*max-width: 100%/);
  assert.doesNotMatch(css.match(/\.session-tag code \{[^}]*\}/)?.[0] ?? "", /text-overflow|overflow:\s*hidden/);
});
