import test from "node:test";
import { assert, readFile, path, JSDOM, documentComments, areaMapView, shellBundle, here, goToCore, goalCardCore, askCore, settle, click, submit, openDocumentViaGoTo, jsonResponse } from "./focus-shell-ui-fixture.mjs";

test("the Area card brain icon starts, shows, and resumes the Area brain", async () => {
  const [html, script, mapCore] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
    readFile(path.join(here, "public", "area-map-core.js"), "utf8"),
  ]);
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  const goal = {
    mtime: 1, area: "otto/dnd", slug: "ship-the-map", file: "otto/dnd/goal-ship-the-map.md", title: "Ship the map", status: "open",
    doneWhen: "The map ships.", stateText: "", currentBrief: "- You wanted: Ship the map.", storyText: "", documents: [], why: [], subgoalItems: [], subgoals: [], depth: 0,
  };
  const posts = [];
  let brain = null;
  let sessions = [];
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (options.method === "POST") {
      const body = options.body ? JSON.parse(options.body) : {};
      posts.push({ path: pathname, body });
      if (pathname === "/api/brains/start") {
        const generation = (brain?.generation ?? 0) + 1;
        const session = generation === 1 ? "dnd-brain" : `dnd-brain-g${generation}`;
        brain = {
          area: "otto/dnd", instruction: body.resume ? brain.instruction : body.instruction, launch: body.choice ?? null, command: "claude --model claude-fable-5", label: "Claude · Fable 5",
          planFile: "otto/dnd/plan-dnd.md", status: "running", generation, session, updatedAt: `t${generation}`, live: true, state: "working", stateDetail: null, idleSince: null,
          latestHandover: brain?.latestHandover ?? null, generations: [],
        };
        sessions = [{ name: session, area: "otto/dnd", kind: "brain", brain: "otto/dnd", generation, state: "working", phase: "orchestrate", command: "claude" }];
        return jsonResponse({ session, generation, brain });
      }
      if (pathname === "/api/kill/dnd-brain") {
        brain = { ...brain, status: "stopped", live: false, state: null, latestHandover: "Wave 1 dispatched.\nNext: review.", updatedAt: "t-stopped" };
        sessions = [];
        return jsonResponse({ ok: true, brainEnded: true });
      }
      return jsonResponse({ ok: true });
    }
    if (pathname === "/api/sessions") return jsonResponse({ boot: "boot-1", caffeinate: false, sessions, pipelines: [], brains: brain ? [brain] : [] });
    if (pathname === "/api/programs") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    if (pathname === "/api/launch/options") {
      return jsonResponse({
        harnesses: [
          { id: "codex", label: "Codex", command: "codex", models: [{ id: "sol", label: "Sol", args: "--model sol" }], efforts: [] },
          { id: "claude", label: "Claude", command: "claude", models: [{ id: "fable-5", label: "Fable 5", args: "--model claude-fable-5" }, { id: "sonnet-5", label: "Sonnet 5", args: "--model claude-sonnet-5" }], efforts: [] },
        ],
        default: { harness: "codex", model: "sol", effort: null, command: "codex --model sol", label: "Codex · Sol" },
      });
    }
    return jsonResponse({
      areas: [{ path: "otto", name: "otto", goals: [] }, { path: "otto/dnd", name: "dnd", goals: [goal], documents: [] }],
      map: [{ path: "otto/dnd", name: "dnd", goals: [goal] }],
      documents: [],
    });
  };
  window.eval(shellBundle);
  await settle(window);
  // No brain: the icon is dim and clicking it opens the brain popover, seeded with Fable, not the Area default.
  /** Reads the Area card's brain icon, which the shell redraws on every paint. */
  const icon = () => window.document.querySelector("[data-brain-area='otto/dnd']");
  assert.ok(icon(), "the Area card carries a brain icon");
  assert.ok(icon().classList.contains("none"));
  click(window, "[data-brain-area='otto/dnd']");
  await settle(window);
  await settle(window);
  /** Reads the launch popover in brain mode. */
  const popover = () => window.document.querySelector("[data-launch-popover]");
  assert.ok(popover(), "the brain popover opened");
  assert.match(popover().querySelector(".launch-popover-header").textContent, /Brain/);
  assert.ok(popover().querySelector("#brain-instruction"), "the popover has the instruction field");
  assert.equal(popover().querySelector("[data-launch-step-select]"), null, "brain mode shows no step list");
  assert.equal(popover().querySelector("#launch-instruction"), null, "brain mode shows no step instruction");
  assert.match(popover().querySelector("[data-launch-start]").textContent, /Start brain/);
  assert.ok(popover().querySelector("[data-launch-model='fable-5']").classList.contains("selected"), "Fable is preselected");
  // An empty instruction does not start; a typed one posts to /api/brains/start with the choice.
  click(window, "[data-launch-start]");
  await settle(window);
  assert.equal(posts.filter((entry) => entry.path === "/api/brains/start").length, 0);
  popover().querySelector("#brain-instruction").value = "Ship the map and every leaf under it.";
  click(window, "[data-launch-model='sonnet-5']");
  await settle(window);
  popover().querySelector("#brain-instruction").value = "Ship the map and every leaf under it.";
  click(window, "[data-launch-start]");
  await settle(window);
  await settle(window);
  await settle(window);
  const started = posts.find((entry) => entry.path === "/api/brains/start");
  assert.ok(started, "Start brain posts");
  assert.equal(started.body.area, "otto/dnd");
  assert.equal(started.body.instruction, "Ship the map and every leaf under it.");
  assert.deepEqual(started.body.choice, { harness: "claude", model: "sonnet-5" });
  assert.equal(started.body.resume, false);
  // The terminal view opened on the brain session; back on the desk the icon is live.
  assert.ok(window.document.querySelector("#describe-work-terminal[data-session='dnd-brain']"), "the brain terminal opened");
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle(window);
  click(window, "#back-button");
  await settle(window);
  await settle(window);
  assert.ok(icon(), "the desk shows the card again");
  assert.ok(icon().classList.contains("working"), "the icon carries the brain's state");
  // Clicking the icon of a live brain opens its terminal, not the popover.
  click(window, "[data-brain-area='otto/dnd']");
  await settle(window);
  assert.equal(window.document.querySelector("[data-launch-popover]"), null);
  assert.ok(window.document.querySelector("#describe-work-terminal[data-session='dnd-brain']"));
  // A refresh can briefly omit the live row while the selected tmux terminal
  // remains mounted. Stop must still target that terminal's exact session.
  sessions = [];
  window.dispatchEvent(new window.Event("focus"));
  await settle(window);
  assert.ok(window.document.querySelector("#describe-work-terminal[data-session='dnd-brain']"), "the selected terminal survives a transient session gap");
  assert.equal(window.document.querySelector("#secondary-action").hidden, false, "Stop remains available for the mounted terminal");
  click(window, "#secondary-action");
  assert.match(window.document.querySelector("#modal-title").textContent, /Stop .*\?/);
  click(window, "[data-modal-confirm]");
  await settle(window);
  await settle(window);
  assert.ok(posts.some((entry) => entry.path === "/api/kill/dnd-brain"), "Stop agent kills the selected brain session");
  assert.equal(brain.status, "stopped");
  await settle(window);
  // The brain stopped: the icon is dim again, and the popover offers Resume with the old instruction.
  assert.ok(icon().classList.contains("stopped"), `stopped icon, got ${icon().className}`);
  click(window, "[data-brain-area='otto/dnd']");
  await settle(window);
  await settle(window);
  assert.equal(popover().querySelector("#brain-instruction").value, "Ship the map and every leaf under it.");
  assert.match(popover().querySelector("[data-launch-start]").textContent, /Resume brain/);
  assert.ok(popover().querySelector("[data-brain-start-over]"), "Start over is offered");
  click(window, "[data-launch-start]");
  await settle(window);
  await settle(window);
  const resumed = posts.filter((entry) => entry.path === "/api/brains/start").at(-1);
  assert.equal(resumed.body.resume, true);
  assert.equal(brain.generation, 2);
});
