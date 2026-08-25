// Boots the browser shell against one Work fixture. The table's DOM, keyboard,
// focus, and state tests share this harness so every proof reads the same page.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { browserBundle } from "./test-browser-bundle.mjs";
import { AREA_FOCUS_KEY, AREA_FOCUS_SCHEMA } from "./public/area-focus-core.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = await browserBundle();

/** Creates the small JSON response shape the browser API helper reads. */
function jsonResponse(payload) {
  /** Returns the configured response payload. */
  async function json() { return payload; }
  return { ok: true, status: 200, json };
}

/** Lets promise callbacks scheduled by the evaluated browser script finish. */
export async function settle(window, turns = 3) {
  for (let turn = 0; turn < turns; turn += 1) await new Promise((resolve) => window.setTimeout(resolve, 0));
}

/**
 * Renders the Work screen for one fixture and returns its window. `posts`
 * collects every mutation the page sends, so an action proof needs no server.
 */
export async function bootWorkTable(fixture, { workFilter = "active", width = 1440, areaFocus = [] } = {}) {
  const html = await readFile(path.join(here, "public", "shell.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.localStorage.setItem("agent-shell.work-filter", workFilter);
  if (areaFocus.length) window.localStorage.setItem(AREA_FOCUS_KEY, JSON.stringify({ schema: AREA_FOCUS_SCHEMA, areas: areaFocus }));
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  const posts = [];
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (options.method === "POST") {
      posts.push({ path: pathname, body: JSON.parse(options.body ?? "{}") });
      return jsonResponse({ ok: true });
    }
    if (pathname === "/api/sessions") {
      return jsonResponse({ boot: "boot-1", caffeinate: false, pipelines: fixture.pipelines, sessions: fixture.sessions, brains: fixture.brains });
    }
    if (pathname === "/api/programs") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    return jsonResponse(fixture.vault);
  };
  window.eval(bundle);
  await settle(window);
  return { window, document: window.document, posts };
}

/** Presses one key on the focused element, as a browser does. */
export function press(window, key, options = {}) {
  const target = window.document.activeElement ?? window.document.body;
  const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}
