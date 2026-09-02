import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { browserBundle } from "./test-browser-bundle.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const shellBundle = await browserBundle();
const workSnapshot = {
  schema: "agent-shell-work.v3",
  fence: { areas: "test", goals: "test", jobs: "test", agents: "test", brains: "test", processes: "test", presentations: "test" },
  areas: [], goals: [], agents: [], brains: [], processes: [], problems: [], presentations: [],
  epoch: "11111111-1111-4111-8111-111111111111", revision: 1, publishedAt: "2026-09-02T00:00:00.000Z",
};
/** Lets queued browser callbacks finish. */
const settle = async (window) => { await new Promise((resolve) => window.setTimeout(resolve, 0)); await new Promise((resolve) => window.setTimeout(resolve, 0)); };
/** Clicks one required browser element. */
const click = (window, selector) => { const element = window.document.querySelector(selector); assert.ok(element, `Expected ${selector}`); element.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); };
/** Creates one JSON-shaped fetch response. */
const jsonResponse = (payload) => ({
  ok: true,
  status: 200,
  headers: new Headers({ "content-type": "application/json" }),
  /** Returns the payload. */
  async json() { return payload; },
  /** Returns the encoded payload for the Work transport. */
  async text() { return JSON.stringify(payload); },
});

test("Map and Work stay primary while Model opens from the Shell menu", async () => {
  const html = await readFile(path.join(here, "public", "shell.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.TextEncoder = globalThis.TextEncoder;
  window.CSS = {
    /** Escapes one CSS selector token for jsdom. */
    escape: (value) => String(value).replaceAll(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`),
  };
  window.fetch = async (url) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (pathname === "/api/work") return jsonResponse(workSnapshot);
    if (pathname === "/api/shell/status") return jsonResponse({ sourceChanged: false, deployedCommit: "", pendingCommits: [], caffeinate: false });
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

test("a pending controller-owned Shell status does not delay gateway-cached Work", async () => {
  const html = await readFile(path.join(here, "public", "shell.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.TextEncoder = globalThis.TextEncoder;
  window.CSS = {
    /** Escapes one CSS selector token for jsdom. */
    escape: (value) => String(value).replaceAll(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`),
  };
  let releaseShellStatus;
  let shellStatusSettled = false;
  const pendingShellStatus = new Promise((resolve) => { releaseShellStatus = resolve; });
  window.fetch = async (url) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (pathname === "/api/work") return jsonResponse(workSnapshot);
    if (pathname === "/api/shell/status") {
      await pendingShellStatus;
      shellStatusSettled = true;
      return jsonResponse({ sourceChanged: false, deployedCommit: "", pendingCommits: [], caffeinate: false });
    }
    if (pathname === "/api/operations") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    return jsonResponse({ areas: [], map: [], documents: [] });
  };
  try {
    window.eval(shellBundle);
    await settle(window);
    click(window, "#work-tab");
    await settle(window);
    const content = window.document.querySelector("#work-lens-content").textContent;
    assert.match(content, /No open work\./, "Work applies while Shell status is still pending");
    assert.doesNotMatch(content, /Work is unavailable|No Work snapshot has loaded yet/);
    assert.equal(shellStatusSettled, false, "the proof still holds Shell chrome pending");
  } finally {
    releaseShellStatus();
    await settle(window);
    dom.window.close();
  }
});

test("the Shell menu owns recovery while offline refresh preserves the screen", async () => {
  const html = await readFile(path.join(here, "public", "shell.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.TextEncoder = globalThis.TextEncoder;
  window.CSS = {
    /** Escapes one CSS selector token for jsdom. */
    escape: (value) => String(value).replaceAll(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`),
  };
  let boot = "boot-1";
  let sourceChanged = false;
  let backpressured = false;
  let workUnavailable = false;
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
    if (workUnavailable && pathname === "/api/work") return {
      ok: false,
      status: 503,
      headers: new Headers({ "retry-after": "1", "x-tangent-operation-id": "work-not-ready-1" }),
      /** Returns the material Work error while health stays ready. */
      async json() { return { error: "Work is not ready.", code: "work-not-ready" }; },
    };
    if (controllerDown && pathname.startsWith("/api/")) return {
      ok: false,
      status: 503,
      headers: new Headers({ "retry-after": "1", "x-tangent-operation-id": "controller-1" }),
      /** Returns the controller error. */
      async json() { return { error: "controller restarting" }; },
    };
    if (pathname === "/api/work") return jsonResponse(workSnapshot);
    if (options.method === "POST") {
      posts.push(pathname);
      return jsonResponse({ ok: true, operation: { id: "rebuild-1", phase: "building", commits: pendingCommits, log: "~/.tangent/agent-shell-rebuild.log" } });
    }
    if (pathname === "/api/shell/status") return jsonResponse({ sourceChanged, deployedCommit: "5899d9c123456789", currentCommit: sourceChanged ? "abc123456789" : "5899d9c123456789", pendingCommits: sourceChanged ? pendingCommits : [], caffeinate: false });
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
  assert.ok(window.document.querySelector(".map-screen"), "offline refresh preserves the durable Map home");
  assert.match(window.document.querySelector("#status-pill").textContent, /Connection lost/);
  offline = false;
  await window.refresh();
  await settle(window);
  backpressured = true;
  await window.refresh();
  await settle(window);
  assert.equal(window.document.querySelector("#status-pill").hidden, true, "gateway backpressure keeps the current screen online");
  backpressured = false;
  await window.refresh();
  await settle(window);
  workUnavailable = true;
  await window.refresh();
  await settle(window);
  assert.equal(window.document.querySelector("#status-pill").hidden, false, "a material Work failure is globally visible");
  assert.equal(window.document.querySelector("#status-pill").textContent, "Work data delayed · retrying");
  workUnavailable = false;
  await window.refresh();
  await settle(window);
  controllerDown = true;
  await window.refresh();
  await settle(window);
  assert.match(window.document.querySelector("#status-pill").textContent, /Work data delayed/);
  controllerDown = false;
  controllerBoot = "controller-2";
  await window.refresh();
  await settle(window);
  const recoveredPill = window.document.querySelector("#status-pill");
  assert.equal(recoveredPill.hidden, true, `a controller replacement recovers without an offline state; shown=${recoveredPill.textContent}`);
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
