// Starting or waking a brain asks Julian for nothing upfront (2026-08-28).
// The Work key opens the chooser so he can see and change the launch, and
// Start posts with no instruction: the brain reads its Area note and waits
// for his message. The old message box is gone.

import test from "node:test";
import { assert, readFile, path, JSDOM, shellBundle, here, settle, click, jsonResponse } from "./focus-shell-ui-fixture.mjs";

/** Boots the shell with one Area, one Goal, and the supplied brain record. */
async function bootShell(brainRecord) {
  const html = await readFile(path.join(here, "public", "shell.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.Terminal = class {
    constructor() {
      this.cols = 80; this.rows = 24; this.loadAddon = () => {};
      /** Mounts a focusable stand-in for xterm. */
      this.open = (host) => { this.element = host.appendChild(window.document.createElement("textarea")); };
      this.focus = () => this.element.focus(); this.onData = () => {};
      this.onSelectionChange = () => ({
        /** Test helper for dispose. */
        dispose() {} });
      this.hasSelection = () => false; this.getSelection = () => ""; this.getSelectionPosition = () => null;
      this.attachCustomKeyEventHandler = () => {}; this.write = () => {}; this.dispose = () => {};
    }
  };
  window.FitAddon = { FitAddon: class { constructor() { this.fit = () => {}; } } };
  window.ResizeObserver = class { constructor() { this.observe = () => {}; this.disconnect = () => {}; } };
  window.WebSocket = class { static OPEN = 1; constructor() { this.readyState = 0; this.close = () => {}; this.send = () => {}; } };
  const now = Date.now();
  const goal = {
    mtime: now, area: "otto/tangent", slug: "wake-it", file: "otto/tangent/goal-wake-it.md",
    title: "Wake it", status: "open", doneWhen: "The brain wakes for a message.", stateText: "Not started.",
    currentBrief: "", storyText: "", documents: [], why: [], subgoalItems: [], subgoals: [], depth: 0,
  };
  const posts = [];
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (options.method === "POST") posts.push({ path: pathname, body: JSON.parse(options.body ?? "{}") });
    if (options.method === "POST" && pathname === "/api/brains/start") {
      return jsonResponse({ session: "tangent-brain", generation: 1, brain: { ...brainRecord, area: "otto/tangent", live: true, session: "tangent-brain" } });
    }
    if (pathname === "/api/launch/options") return jsonResponse({
      area: "otto/tangent",
      harnesses: [
        { id: "codex", label: "Codex", command: "codex", models: [{ id: "sol", label: "Sol", args: "--model sol", efforts: [] }] },
        { id: "claude", label: "Claude", command: "claude", models: [{ id: "opus", label: "Opus", args: "--model opus", efforts: [{ id: "high", label: "High", args: "--effort high" }] }] },
      ],
      default: { harness: "codex", model: "sol", command: "codex --model sol", label: "Codex · Sol", source: "otto" },
      workDefault: { harness: "codex", model: "sol", command: "codex --model sol", label: "Codex · Sol", source: "otto" },
      brainDefault: { harness: "codex", model: "sol", command: "codex --model sol", label: "Codex · Sol", source: "otto" },
      declarations: { work: { mode: "inherit" }, brain: { mode: "work" } },
    });
    if (pathname === "/api/sessions") return jsonResponse({
      boot: "boot-1",
      caffeinate: false,
      sessions: brainRecord?.live ? [{ name: brainRecord.session, area: brainRecord.area, kind: "brain", state: brainRecord.state, command: "codex" }] : [],
      pipelines: [],
      brains: brainRecord ? [brainRecord] : [],
    });
    if (pathname === "/api/operations") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    if (pathname === "/api/map-state") return jsonResponse({ state: {} });
    return jsonResponse({
      areas: [
        { path: "otto", name: "otto", goals: [] },
        { path: "otto/empty", name: "empty", goals: [], documents: [] },
        { path: "otto/tangent", name: "tangent", goals: [goal], documents: [] },
      ],
      map: [{ path: "otto/tangent", name: "tangent", goals: [goal] }],
      documents: [],
    });
  };
  window.eval(shellBundle);
  await settle(window);
  // Work is one projection, so the unstarted Goal is already present.
  return { dom, window, posts };
}

/** Chooses one Area's brain through the global finder. */
async function chooseBrain(window, areaName = "tangent") {
  click(window, "#go-to-button");
  const input = window.document.querySelector("#go-to-input");
  input.value = `brain ${areaName}`;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await settle(window);
  assert.equal(window.document.querySelectorAll("[data-go-to-row]").length, 1);
  click(window, "[data-go-to-row='0']");
  await settle(window);
}

test("Work has no toolbar: the search and keys entries live on the caption line", async () => {
  const css = await readFile(path.join(here, "public", "shell.css"), "utf8");

  assert.doesNotMatch(css, /\.work-tools\b/, "the 46 px toolbar is gone (work-screen-refresh D7)");
  assert.match(css, /\.work-caption-key \{/, "the caption key entries are pointer targets");
  assert.doesNotMatch(css, /\.work-filter/);
  assert.doesNotMatch(css, /\.work-area-browser|\.work-describe/);
});

test("Go to offers an unstarted Area brain and Work has no Browse or Describe toolbar buttons", async () => {
  const { dom, window, posts } = await bootShell(null);

  assert.equal(window.document.querySelector("[data-show-areas]"), null);
  assert.equal(window.document.querySelector("[data-describe-work]"), null);
  assert.equal(window.document.querySelector("[data-work-commands]"), null, "Commands and Keys are one ? sheet");
  assert.ok(window.document.querySelector(".work-caption [data-work-keys]"), "the keys entry is on the caption line");
  assert.match(window.document.querySelector("[data-work-keys]").textContent, /\?\s*all/);
  assert.equal(window.document.querySelector("[data-work-filter]"), null, "Current and Planned controls are retired");
  assert.ok(window.document.querySelector("[data-open-area-brain='otto/empty']"), "the empty Area keeps its Work row, so its brain stays reachable (every Area has a row)");
  await chooseBrain(window, "empty");

  assert.equal(posts.filter((item) => item.path === "/api/brains/start").length, 0);
  assert.equal(window.document.querySelector("#go-to-layer").hidden, true);
  assert.ok(window.document.querySelector("[data-launch-popover] [data-launch-start]"), "the missing brain destination opens its chooser");
  assert.equal(window.document.querySelector("#brain-instruction"), null);
  dom.window.close();
});

test("the Work brain key opens the chooser, and Start needs no instruction", async () => {
  const { dom, window, posts } = await bootShell(null);

  // j walks the Otto header, the quiet Empty sub-header, then the Tangent sub-header (every Area has a row).
  for (let step = 0; step < 3; step += 1) window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "j", bubbles: true }));
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "b", bubbles: true }));
  await settle(window);

  assert.equal(posts.filter((item) => item.path === "/api/brains/start").length, 0, "the key opens the chooser first");
  assert.equal(window.document.querySelector("#brain-instruction"), null, "no instruction box: the brain reads its Area note");
  const launch = window.document.querySelector(".brain-launch-summary");
  assert.match(launch.textContent, /codex\/sol/);
  assert.match(launch.textContent, /Codex · Sol/);
  assert.match(launch.textContent, /codex --model sol/);
  assert.match(launch.textContent, /Inherited from Otto/);
  assert.ok(launch.querySelector("[data-default-agents-area='otto/tangent']"), "the disclosed launch links to the Area default editor");

  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await settle(window);
  const started = posts.filter((item) => item.path === "/api/brains/start");
  assert.equal(started.length, 1, "b then Enter starts the brain: two keys");
  assert.equal(started[0].body.instruction, "", "no upfront instruction travels");
  assert.equal(started[0].body.resume, false);
  assert.equal(started[0].body.expectedLaunch, "codex/sol", "the request carries the launch that the control disclosed");
  assert.equal("choice" in started[0].body, false, "an untouched picker leaves durable default resolution to the server");
  dom.window.close();
});

test("a brain picker sends a typed one-launch override and preserves the Area default", async () => {
  const { dom, window, posts } = await bootShell(null);
  // j walks the Otto header, the quiet Empty sub-header, then the Tangent sub-header (every Area has a row).
  for (let step = 0; step < 3; step += 1) window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "j", bubbles: true }));
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "b", bubbles: true }));
  await settle(window);

  assert.equal(window.document.querySelectorAll("[data-launch-harness]").length, 2, "brain launch exposes the registry choices");
  click(window, "[data-launch-harness='claude']");
  click(window, "[data-launch-effort='high']");
  const summary = window.document.querySelector(".brain-launch-summary");
  assert.match(summary.textContent, /claude\/opus\/high/);
  assert.match(summary.textContent, /One launch only · Area default unchanged/);
  assert.ok(summary.querySelector("[data-default-agents-area='otto/tangent']"), "the durable default stays one click away");

  click(window, "[data-launch-start]");
  await settle(window);
  const started = posts.find((item) => item.path === "/api/brains/start");
  assert.deepEqual(started.body.choice, { harness: "claude", model: "opus", effort: "high" });
  assert.equal(started.body.expectedLaunch, "claude/opus/high");
  assert.equal("command" in started.body, false, "brain launch never sends an editable raw command");
  dom.window.close();
});

test("a live brain has a direct Area stop control", async () => {
  const live = {
    area: "otto/tangent", session: "tangent-brain-g7", currentAttemptId: "tangent-brain-g7", status: "active", live: true,
    state: "working", generation: 7, foundingInstruction: { text: "Run this Area." }, requests: [],
  };
  const { dom, window, posts } = await bootShell(live);
  click(window, "[data-work-sub-area='otto/tangent'] [data-work-object-actions]");
  await settle(window);
  const stop = window.document.querySelector("[data-modal-action='stopBrain']");
  assert.ok(stop, "stop lives in the related Area action surface");
  assert.equal(stop.dataset.modalKey, "s", "the pointer teaches the stop shortcut");
  const menuText = stop.closest("[role='menu']").textContent;
  for (const taught of ["Open brain", "Defaults", "Message brain", "Star Area", "Review questions", "Capture note"]) assert.match(menuText, new RegExp(taught));
  assert.equal(window.document.querySelector("[data-modal-action='describeArea']"), null, "the removed Describe-work route is not renamed as New task");
  stop.click();
  assert.match(window.document.querySelector("#modal-title").textContent, /Stop the Tangent brain/);
  assert.match(window.document.querySelector("#modal-copy").textContent, /Goals, queues, and worker agents continue/);
  click(window, "[data-modal-confirm]");
  await settle(window);
  const stopped = posts.find((item) => item.path === "/api/brains/stop");
  assert.equal(stopped.body.area, "otto/tangent");
  assert.equal(stopped.body.expectedAttemptId, "tangent-brain-g7");
  assert.ok(stopped.body.operationId);
  dom.window.close();
});

test("Go to opens a live Area brain in the shared session layer", async () => {
  const live = {
    area: "otto/tangent", session: "tangent-brain-g7", currentAttemptId: "tangent-brain-g7", status: "active", live: true,
    state: "working", generation: 7, foundingInstruction: { text: "Run this Area." }, requests: [],
  };
  const { dom, window, posts } = await bootShell(live);

  await chooseBrain(window);

  assert.equal(window.document.querySelector("#session-layer").hidden, false);
  assert.equal(window.document.querySelector("#session-layer-terminal").dataset.session, "tangent-brain-g7");
  assert.equal(posts.filter((item) => item.path === "/api/brains/start").length, 0);
  dom.window.close();
});

test("an inactive brain wakes without a message, and Work names no generation", async () => {
  const inactive = {
    area: "otto/tangent", session: "tangent-brain-g7", status: "inactive", live: false,
    state: "shell", generation: 7, foundingInstruction: { text: "Run this Area." }, requests: [],
  };
  const { dom, window, posts } = await bootShell(inactive);

  const shellText = window.document.querySelector("#screen").innerHTML;
  assert.doesNotMatch(shellText, /generation/i, "Work never names a brain generation");

  await chooseBrain(window);
  assert.equal(posts.filter((item) => item.path === "/api/brains/start").length, 0, "an inactive brain shows its chooser first");
  assert.equal(window.document.querySelector("#brain-instruction"), null, "no message box");
  assert.match(window.document.querySelector("[data-launch-start]")?.textContent ?? "", /Wake brain/, "the button says Wake");
  const startOver = window.document.querySelector("[data-brain-start-over]");
  assert.equal(startOver?.dataset.launchKey, "n", "Start over prints its key");
  assert.match(window.document.querySelector("[data-launch-popover] header").textContent, /↵ wake · n start over/);

  click(window, "[data-launch-start]");
  await settle(window);
  const resumed = posts.filter((item) => item.path === "/api/brains/start");
  assert.equal(resumed.length, 1, "Wake posts at once, with no message");
  assert.equal(resumed[0].body.resume, true);
  assert.equal(resumed[0].body.instruction, "");

  await chooseBrain(window);
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "n", bubbles: true }));
  await settle(window);
  const fresh = posts.filter((item) => item.path === "/api/brains/start").at(-1);
  assert.equal(fresh.body.resume, false, "n starts over with a new brain");
  dom.window.close();
});
