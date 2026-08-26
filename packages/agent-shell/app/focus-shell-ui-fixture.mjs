import assert from "node:assert/strict";
export { assert };
export { readFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
export { default as path } from "node:path";
import path from "node:path";
import { fileURLToPath } from "node:url";
export { JSDOM } from "jsdom";
export { default as documentComments } from "./public/document-comments.js";
export { default as areaMapView } from "./public/area-map.js";
import { browserBundle } from "./test-browser-bundle.mjs";

export const shellBundle = await browserBundle();

export const here = path.dirname(fileURLToPath(import.meta.url));
// shell.js reads its search normalizer from this script, as the page does.
export const goToCore = await readFile(path.join(here, "public", "go-to-core.js"), "utf8");
// The Goal card reads its counts and durations from this script, as the page does.
export const goalCardCore = await readFile(path.join(here, "public", "goal-card-core.js"), "utf8");
// Every row of the For you card is built by this script, as the page does it.
export const askCore = await readFile(path.join(here, "public", "ask-core.js"), "utf8");

/** Lets promise callbacks scheduled by the evaluated browser script finish. */
export async function settle(window) {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

/** Clicks one required element in the test document. */
export function click(window, selector) {
  const element = window.document.querySelector(selector);
  assert.ok(element, `Expected ${selector}`);
  element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}

/** Submits one required form in the test document. */
export function submit(window, selector) {
  const form = window.document.querySelector(selector);
  assert.ok(form, `Expected ${selector}`);
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
}

/**
 * Opens a Document by title through Go to (⌘K) in the quick Document layer:
 * the work desk no longer opens a Document from a Goal card or a Documents
 * section (design-compact-work-desk), so tests that only need a Document open
 * reach it through the finder, one of the routes that stayed.
 */
export async function peekDocumentViaGoTo(window, title) {
  click(window, "#go-to-button");
  const input = window.document.querySelector("#go-to-input");
  input.value = title;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await settle(window);
  click(window, "[data-go-to-row='0']");
  await settle(window);
}

/**
 * Opens a Document in the full reader through Go to. The finder's own
 * destination is the quick layer, so the reader needs the one control that
 * leaves the quick path (design-quick-returnable-document-search D1).
 */
export async function openDocumentViaGoTo(window, title) {
  await peekDocumentViaGoTo(window, title);
  click(window, "[data-promote-document-peek]");
  await settle(window);
}

/** Creates the small JSON response shape used by the browser API helper. */
export function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    /** Returns the configured response payload. */
    async json() { return payload; },
  };
}
