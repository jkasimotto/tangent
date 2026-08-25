import test from "node:test";
import {
  assert,
  readFile,
  path,
  JSDOM,
  shellBundle,
  here,
  settle,
  click,
  jsonResponse,
} from "./focus-shell-ui-fixture.mjs";
import { ASK_DISMISSALS_KEY } from "./public/ask-dismissal-core.js";

const goal = {
  mtime: 1,
  area: "otto/tangent",
  slug: "stopped-without-brain",
  file: "otto/tangent/goal-stopped-without-brain.md",
  title: "Stopped without brain",
  status: "active",
  doneWhen: "The pipeline completes.",
  stateText: "",
  currentBrief: "- You wanted: Finish the pipeline.",
  storyText: "",
  documents: [],
  why: [],
  subgoalItems: [],
  subgoals: [],
  depth: 0,
};

/** Starts one shell around the stopped-pipeline screenshot case. */
async function shellFixture({ storedDismissals = null } = {}) {
  const html = await readFile(path.join(here, "public", "shell.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  if (storedDismissals) window.localStorage.setItem(ASK_DISMISSALS_KEY, storedDismissals);
  const posts = [];
  const step = {
    index: 1,
    instruction: "Implement it",
    label: "Codex · Sol",
    status: "stopped",
    session: "stopped-without-brain",
    startedAt: "2026-08-25T01:00:00.000Z",
    endedAt: "2026-08-25T01:05:00.000Z",
    live: false,
    state: null,
    stateDetail: null,
  };
  const pipeline = {
    goal: goal.file,
    area: goal.area,
    slug: goal.slug,
    status: "stopped",
    createdAt: "2026-08-25T01:00:00.000Z",
    updatedAt: "2026-08-25T01:05:00.000Z",
    extraFiles: [],
    steps: [step],
  };
  const vault = {
    areas: [{ path: "otto", name: "otto", goals: [] }, { path: goal.area, name: "tangent", goals: [goal], documents: [] }],
    map: [{ path: goal.area, name: "tangent", goals: [goal] }],
    documents: [],
  };
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (options.method === "POST") {
      posts.push({ path: pathname, body: JSON.parse(options.body || "{}") });
      return jsonResponse({ ok: true });
    }
    if (pathname === "/api/sessions") return jsonResponse({ boot: "dismiss-boot", caffeinate: false, sessions: [], pipelines: [pipeline], brains: [] });
    if (pathname === "/api/programs") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    return jsonResponse(vault);
  };
  window.eval(shellBundle);
  await settle(window);
  return { dom, window, posts, step };
}

test("a stopped pipeline ask has a quiet accessible dismissal with Undo and no work mutation", async () => {
  const { window, posts } = await shellFixture();
  const dismiss = window.document.querySelector("[data-dismiss-ask]");
  assert.ok(dismiss, "the stopped row has a dismissal");
  assert.equal(dismiss.textContent.trim(), "×");
  assert.match(dismiss.getAttribute("aria-label"), /^Dismiss Stopped without brain: Step 1 stopped\. Restart or skip it\? from For you$/);
  dismiss.focus();
  assert.equal(window.document.activeElement, dismiss, "the native button receives keyboard focus");

  dismiss.click();
  assert.equal(window.forYouItems().length, 0, "only the exact ask leaves the projection");
  assert.equal(window.document.querySelector("[data-dismiss-ask]"), null);
  assert.equal(window.document.activeElement, window.document.body, "dismissal does not select another ask");
  assert.ok(window.document.querySelector(`[data-goal-anchor='${goal.file}']`), "the Goal stays on Work");
  assert.ok(window.document.querySelector("[data-pipeline-control='restart']"), "the stopped pipeline stays actionable outside For you");
  assert.deepEqual(posts, [], "dismissal sends no Goal, pipeline, brain, Request, or worker command");
  const stored = JSON.parse(window.localStorage.getItem(ASK_DISMISSALS_KEY));
  assert.equal(stored.ids.length, 1);
  assert.match(window.document.querySelector("#toast").textContent, /Dismissed from For you\.Undo/);

  click(window, "#toast .toast-action");
  assert.equal(window.forYouItems().length, 1, "Undo restores the exact ask");
  assert.equal(window.localStorage.getItem(ASK_DISMISSALS_KEY), null);
  assert.deepEqual(posts, []);
});

test("a dismissal survives reload and a restarted attempt can ask again", async () => {
  const first = await shellFixture();
  click(first.window, "[data-dismiss-ask]");
  const stored = first.window.localStorage.getItem(ASK_DISMISSALS_KEY);
  await first.window.refresh();
  await settle(first.window);
  assert.equal(first.window.forYouItems().length, 0, "polling the same event does not restore it");

  const reloaded = await shellFixture({ storedDismissals: stored });
  assert.equal(reloaded.window.forYouItems().length, 0, "the receipt survives a new shell state");
  reloaded.step.session = "stopped-without-brain-restart";
  reloaded.step.startedAt = "2026-08-25T02:00:00.000Z";
  reloaded.step.endedAt = "2026-08-25T02:05:00.000Z";
  await reloaded.window.refresh();
  await settle(reloaded.window);
  assert.equal(reloaded.window.forYouItems().length, 1, "a new stopped attempt has a new identity");
  assert.ok(reloaded.window.document.querySelector("[data-dismiss-ask]"));
});
