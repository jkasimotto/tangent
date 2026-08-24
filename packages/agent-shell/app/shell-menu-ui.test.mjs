import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { browserBundle } from "./test-browser-bundle.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const shellBundle = await browserBundle();
/** Lets queued browser callbacks finish. */
const settle = async (window) => { await new Promise((resolve) => window.setTimeout(resolve, 0)); await new Promise((resolve) => window.setTimeout(resolve, 0)); };
/** Clicks one required browser element. */
const click = (window, selector) => { const element = window.document.querySelector(selector); assert.ok(element, `Expected ${selector}`); element.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); };
/** Creates one JSON-shaped fetch response. */
const jsonResponse = (payload) => ({
  ok: true,
  status: 200,
  /** Returns the payload. */
  async json() { return payload; },
});

test("the Shell menu owns recovery while offline refresh preserves the screen", async () => {
  const html = await readFile(path.join(here, "public", "shell.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  let boot = "boot-1";
  let sourceChanged = false;
  const pendingCommits = [{ hash: "abc", shortHash: "abc1234", subject: "Improve reload", author: "Julian" }];
  let offline = false;
  const posts = [];
  window.fetch = async (url, options = {}) => {
    if (offline) throw new Error("connection refused");
    const pathname = new URL(url, window.location.href).pathname;
    if (options.method === "POST") {
      posts.push(pathname);
      return jsonResponse({ ok: true, operation: { id: "rebuild-1", phase: "building", commits: pendingCommits, log: "~/.tangent/agent-shell-rebuild.log" } });
    }
    if (pathname === "/api/sessions") return jsonResponse({ boot, sourceChanged, deployedCommit: "5899d9c123456789", pendingCommits: sourceChanged ? pendingCommits : [], caffeinate: false, sessions: [] });
    if (pathname === "/api/programs") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    return jsonResponse({ areas: [], map: [], documents: [] });
  };
  window.eval(shellBundle);
  await settle(window);
  assert.match(window.document.querySelector("#back-button").textContent, /Agent Shell\[5899d9c\]/);
  click(window, "#back-button");
  assert.equal(window.document.querySelector("#shell-menu").hidden, false);
  click(window, "#menu-refresh");
  await settle(window);
  sourceChanged = true;
  await window.refresh();
  click(window, "#back-button");
  assert.equal(window.document.querySelector("#menu-update").hidden, false);
  click(window, "#menu-update");
  assert.match(window.document.querySelector("#update-panel-copy").textContent, /abc1234  Improve reload — Julian/);
  assert.match(window.document.querySelector("[data-rebuild-start]").textContent, /Rebuild and restart/);
  click(window, "[data-rebuild-dismiss]");
  offline = true;
  await window.refresh();
  assert.ok(window.document.querySelector(".work-page"));
  assert.match(window.document.querySelector("#status-pill").textContent, /Server offline/);
  offline = false;
  await window.refresh();
  assert.equal(window.document.querySelector("#back-button").classList.contains("has-update"), true);
  click(window, "#back-button");
  click(window, "#menu-rebuild");
  click(window, "[data-modal-confirm]");
  await settle(window);
  assert.ok(posts.includes("/api/shell/rebuild"));
  assert.match(window.document.querySelector("#status-pill").textContent, /Building Tangent/);
  assert.equal(window.document.querySelector("#update-panel").hidden, false);
  assert.match(window.document.querySelector("#update-panel-title").textContent, /Building 1 commit/);
  posts.length = 0;
  click(window, "#back-button");
  click(window, "#menu-update");
  click(window, "[data-rebuild-start]");
  await settle(window);
  assert.ok(posts.includes("/api/shell/rebuild"), "the pending-change action rebuilds on its first click");
  dom.window.close();
});
