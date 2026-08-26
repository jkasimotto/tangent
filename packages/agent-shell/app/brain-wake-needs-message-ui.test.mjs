// A brain that is not live wakes for Julian's words, never for a keystroke.
//
// The Work key used to post a canned instruction, so pressing it on a quiet
// Area started a brain that nobody had asked anything, and resuming an
// inactive one woke it with no reason. Both routes now open the message box
// first, and the message travels with the send.

import test from "node:test";
import { assert, readFile, path, JSDOM, shellBundle, here, settle, click, jsonResponse } from "./focus-shell-ui-fixture.mjs";

/** Boots the shell with one Area, one Goal, and the supplied brain record. */
async function bootShell(brainRecord) {
  const html = await readFile(path.join(here, "public", "shell.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.HTMLCanvasElement.prototype.getContext = () => null;
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
      harnesses: [{ id: "codex", label: "Codex", command: "codex", models: [{ id: "sol", label: "Sol", args: "--model sol", efforts: [] }] }],
      workDefault: { harness: "codex", model: "sol", command: "codex --model sol", label: "Codex · Sol", source: "otto" },
      brainDefault: { harness: "codex", model: "sol", command: "codex --model sol", label: "Codex · Sol", source: "otto" },
      declarations: { work: { mode: "inherit" }, brain: { mode: "work" } },
    });
    if (pathname === "/api/sessions") return jsonResponse({ boot: "boot-1", caffeinate: false, sessions: [], pipelines: [], brains: brainRecord ? [brainRecord] : [] });
    if (pathname === "/api/operations") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    if (pathname === "/api/map-state") return jsonResponse({ state: {} });
    return jsonResponse({
      areas: [{ path: "otto", name: "otto", goals: [] }, { path: "otto/tangent", name: "tangent", goals: [goal], documents: [] }],
      map: [{ path: "otto/tangent", name: "tangent", goals: [goal] }],
      documents: [],
    });
  };
  window.eval(shellBundle);
  await settle(window);
  // The one Goal is unstarted, so it lives on Planned.
  click(window, '[data-work-filter="inactive"]');
  await settle(window);
  return { dom, window, posts };
}

test("the Work brain key opens the message box instead of starting a brain", async () => {
  const { dom, window, posts } = await bootShell(null);

  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "j", bubbles: true }));
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "b", bubbles: true }));
  await settle(window);

  assert.equal(posts.filter((item) => item.path === "/api/brains/start").length, 0, "the key never starts a brain by itself");
  const box = window.document.querySelector("#brain-instruction");
  assert.ok(box, "the key opens the message box");
  assert.equal(box.value, "", "the box starts empty, so no old order becomes today's");

  // An empty send is refused. Nothing reaches the server.
  click(window, "[data-launch-start]");
  await settle(window);
  assert.equal(posts.filter((item) => item.path === "/api/brains/start").length, 0);

  window.document.querySelector("#brain-instruction").value = "Plan the migration.";
  click(window, "[data-launch-start]");
  await settle(window);
  const started = posts.filter((item) => item.path === "/api/brains/start");
  assert.equal(started.length, 1);
  assert.equal(started[0].body.instruction, "Plan the migration.", "the brain starts from Julian's own words");
  assert.equal(started[0].body.resume, false);
  dom.window.close();
});

test("an inactive brain resumes only with a message, and Work names no generation", async () => {
  const inactive = {
    area: "otto/tangent", session: "tangent-brain-g7", status: "inactive", live: false,
    state: "shell", generation: 7, foundingInstruction: { text: "Run this Area." }, requests: [],
  };
  const { dom, window, posts } = await bootShell(inactive);

  const shellText = window.document.querySelector("#screen").innerHTML;
  assert.doesNotMatch(shellText, /generation/i, "Work never names a brain generation");

  click(window, "[data-open-area-brain='otto/tangent']");
  await settle(window);
  assert.equal(posts.filter((item) => item.path === "/api/brains/start").length, 0, "an inactive brain does not resume on a click");
  assert.ok(window.document.querySelector("#brain-instruction"));
  assert.match(window.document.querySelector(".launch-popover")?.textContent ?? "", /wake/i, "the box says the message is what wakes it");

  click(window, "[data-launch-start]");
  await settle(window);
  assert.equal(posts.filter((item) => item.path === "/api/brains/start").length, 0, "an empty message wakes nothing");

  window.document.querySelector("#brain-instruction").value = "Pick the branch up again.";
  click(window, "[data-launch-start]");
  await settle(window);
  const resumed = posts.filter((item) => item.path === "/api/brains/start");
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0].body.resume, true);
  assert.equal(resumed[0].body.instruction, "Pick the branch up again.", "the wake message travels with the resume");
  dom.window.close();
});
