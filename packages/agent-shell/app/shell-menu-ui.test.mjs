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

test("Map and Work stay primary while Model opens from the Shell menu", async () => {
  const html = await readFile(path.join(here, "public", "shell.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.fetch = async (url) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (pathname === "/api/sessions") return jsonResponse({ boot: "boot-1", sourceChanged: false, deployedCommit: "", pendingCommits: [], caffeinate: false, sessions: [] });
    if (pathname === "/api/operations") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    if (pathname === "/api/prompts/inspect") return jsonResponse({ goals: [], brains: [], agents: [], jobs: [], processes: [] });
    return jsonResponse({ areas: [], map: [], documents: [] });
  };
  window.eval(shellBundle);
  await settle(window);

  const primary = [...window.document.querySelectorAll(".primary-tabs > button:not([hidden])")];
  assert.deepEqual(primary.map((button) => button.textContent.trim()), ["Map", "Work"]);
  const model = window.document.querySelector("#shell-menu > #prompts-tab.shell-menu-item");
  assert.ok(model, "Model belongs to the Shell menu");
  assert.equal(model.getAttribute("role"), "menuitem");

  const menu = window.document.querySelector("#shell-menu");
  menu.hidden = false;
  click(window, "#prompts-tab");
  await settle(window);
  assert.equal(menu.hidden, true);
  assert.ok(window.document.querySelector(".prompt-bestiary"), "Model keeps its existing route");
  assert.equal(model.getAttribute("aria-current"), "page");
  dom.window.close();
});

test("the Shell menu owns recovery while offline refresh preserves the screen", async () => {
  const html = await readFile(path.join(here, "public", "shell.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  let boot = "boot-1";
  let sourceChanged = false;
  let backpressured = false;
  let controllerDown = false;
  let controllerBoot = "controller-1";
  const pendingCommits = [{ hash: "abc", shortHash: "abc1234", subject: "Improve reload", author: "Julian" }];
  let offline = false;
  const posts = [];
  window.fetch = async (url, options = {}) => {
    if (offline) throw new Error("connection refused");
    const pathname = new URL(url, window.location.href).pathname;
    if (pathname === "/api/health") return jsonResponse({ ok: true, boot: "gateway-1", controller: { state: controllerDown ? "restarting" : "ready", boot: controllerBoot } });
    if (backpressured && pathname.startsWith("/api/")) return {
      ok: false,
      status: 429,
      headers: new Headers({ "retry-after": "1", "x-tangent-operation-id": "duplicate-1" }),
      /** Returns the admission error. */
      async json() { return { error: "duplicate read" }; },
    };
    if (controllerDown && pathname.startsWith("/api/")) return {
      ok: false,
      status: 503,
      headers: new Headers({ "retry-after": "1", "x-tangent-operation-id": "controller-1" }),
      /** Returns the controller error. */
      async json() { return { error: "controller restarting" }; },
    };
    if (options.method === "POST") {
      posts.push(pathname);
      return jsonResponse({ ok: true, operation: { id: "rebuild-1", phase: "building", commits: pendingCommits, log: "~/.tangent/agent-shell-rebuild.log" } });
    }
    if (pathname === "/api/sessions") return jsonResponse({ boot, runtime: { gateway: { boot: "gateway-1", controller: { state: "ready", boot: controllerBoot } } }, sourceChanged, deployedCommit: "5899d9c123456789", pendingCommits: sourceChanged ? pendingCommits : [], caffeinate: false, sessions: [] });
    if (pathname === "/api/operations") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
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
  const commitRows = [...window.document.querySelectorAll("#update-panel-commits .update-commit")];
  assert.equal(commitRows.length, 1, "each pending commit gets its own row");
  assert.equal(commitRows[0].querySelector("code").textContent, "abc1234");
  assert.equal(commitRows[0].querySelector(".update-commit-subject").textContent, "Improve reload");
  assert.equal(commitRows[0].querySelector(".update-commit-author").textContent, "Julian");
  assert.doesNotMatch(window.document.querySelector("#update-panel-copy").textContent, /abc1234/, "the copy paragraph never runs the commits together");
  assert.match(window.document.querySelector("[data-rebuild-start]").textContent, /Rebuild and restart/);
  click(window, "[data-rebuild-dismiss]");
  offline = true;
  await window.refresh();
  assert.ok(window.document.querySelector(".work-page"));
  assert.match(window.document.querySelector("#status-pill").textContent, /Connection lost/);
  offline = false;
  await window.refresh();
  backpressured = true;
  await window.refresh();
  assert.equal(window.document.querySelector("#status-pill").hidden, true, "gateway backpressure keeps the current screen online");
  backpressured = false;
  await window.refresh();
  controllerDown = true;
  await window.refresh();
  assert.match(window.document.querySelector("#status-pill").textContent, /Work data delayed/);
  controllerDown = false;
  controllerBoot = "controller-2";
  await window.refresh();
  assert.equal(window.document.querySelector("#status-pill").hidden, true, "a controller replacement recovers without an offline state");
  assert.equal(window.document.querySelector("#back-button").classList.contains("has-update"), true);
  click(window, "#back-button");
  click(window, "#menu-rebuild");
  const modalRows = [...window.document.querySelectorAll("#modal-copy .update-commit")];
  assert.equal(modalRows.length, 1, "the rebuild confirmation lists each commit as its own row");
  assert.equal(modalRows[0].querySelector("code").textContent, "abc1234");
  assert.equal(modalRows[0].querySelector(".update-commit-subject").textContent, "Improve reload");
  assert.equal(modalRows[0].querySelector(".update-commit-author").textContent, "Julian");
  assert.doesNotMatch(window.document.querySelector("#modal-copy").firstChild.textContent, /abc1234/, "the confirmation sentence never runs the commits together");
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
