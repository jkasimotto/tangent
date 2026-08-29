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
export async function bootWorkTable(fixture, { workFilter = "active", width = 1440, areaFocus = [], areaFocusOnly = false, launchOptions = null, harnessRegistry = null, goalDetail = null, documentRecord = null, postHandler = null } = {}) {
  const html = await readFile(path.join(here, "public", "shell.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.structuredClone = globalThis.structuredClone;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.localStorage.setItem("agent-shell.work-filter", workFilter);
  if (areaFocus.length) window.localStorage.setItem(AREA_FOCUS_KEY, JSON.stringify({ schema: AREA_FOCUS_SCHEMA, areas: areaFocus, ...(areaFocusOnly ? { only: true } : {}) }));
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  const posts = [];
  const gets = [];
  window.fetch = async (url, options = {}) => {
    const requestUrl = new URL(url, window.location.href);
    const pathname = requestUrl.pathname;
    if (options.method === "POST") {
      const body = JSON.parse(options.body ?? "{}");
      posts.push({ path: pathname, body });
      if (postHandler) {
        const response = await postHandler({ path: pathname, body, requestUrl, fixture, posts });
        if (response?.ok === false || typeof response?.json === "function") return response;
        return jsonResponse(response ?? { ok: true });
      }
      return jsonResponse({ ok: true });
    }
    gets.push(requestUrl.href);
    if (pathname === "/api/sessions") {
      return jsonResponse({ boot: "boot-1", caffeinate: false, pipelines: fixture.pipelines, sessions: fixture.sessions, brains: fixture.brains });
    }
    if (pathname === "/api/operations") return jsonResponse(fixture.programs ?? { operations: [], processes: [], problems: [], areas: [], liveCount: 0 });
    if (pathname === "/api/launch/options" && launchOptions) {
      return jsonResponse(typeof launchOptions === "function" ? launchOptions(requestUrl) : launchOptions);
    }
    if (pathname === "/api/harnesses" && harnessRegistry) return jsonResponse({ registry: harnessRegistry });
    if (pathname === "/api/goals/detail" && goalDetail) return jsonResponse(typeof goalDetail === "function" ? goalDetail(requestUrl) : goalDetail);
    if (pathname === "/api/document" && documentRecord) return jsonResponse(typeof documentRecord === "function" ? documentRecord(requestUrl) : documentRecord);
    // Real Response.json() returns a fresh object for each endpoint. Keep the
    // fixture faithful when /api/work and /api/vault are read in one refresh.
    return jsonResponse(structuredClone(fixture.vault));
  };
  window.eval(bundle);
  await settle(window);
  return { window, document: window.document, posts, gets };
}

/** Presses one key on the focused element, as a browser does. */
export function press(window, key, options = {}) {
  const target = window.document.activeElement ?? window.document.body;
  const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}
