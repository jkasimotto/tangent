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
import { legacyFixtureWork } from "./work-table-harness.mjs";

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
async function shellFixture({ storedDismissals = null, request = null } = {}) {
  const html = await readFile(path.join(here, "public", "shell.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.structuredClone = globalThis.structuredClone;
  window.TextEncoder = globalThis.TextEncoder;
  window.CSS = {
    /** Escapes fixture values for CSS selectors. */
    escape: (value) => String(value).replaceAll(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`),
  };
  window.localStorage.setItem("agent-shell.work-filter", "all");
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
  const brains = request ? [{ area: goal.area, status: "active", state: "working", session: "tangent-brain-g1", generation: 1, live: true, requests: [request] }] : [];
  const projectedWork = legacyFixtureWork({ vault, goals: [goal], sessions: [], pipelines: [pipeline], brains, programs: { processes: [] } });
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (options.method === "POST") {
      const body = JSON.parse(options.body || "{}");
      posts.push({ path: pathname, body });
      if (pathname === "/api/brains/requests/dismiss" && request?.id === body.id) request.status = "closed";
      return jsonResponse({ ok: true });
    }
    if (pathname === "/api/work") return {
      ...jsonResponse(projectedWork),
      headers: {
        /** Returns no optional response header in this fixture. */
        get: () => "",
      },
      /** Returns the production Work body before schema validation. */
      async text() { return JSON.stringify(projectedWork); },
    };
    if (pathname === "/api/brains/show") return jsonResponse({ brain: brains.find((brain) => brain.area === new URL(url, window.location.href).searchParams.get("area")) ?? null });
    if (pathname === "/api/sessions") return jsonResponse({
      boot: "dismiss-boot",
      caffeinate: false,
      sessions: [],
      pipelines: [pipeline],
      brains,
    });
    if (pathname === "/api/operations") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    return jsonResponse(vault);
  };
  window.eval(shellBundle);
  await settle(window);
  click(window, "#work-tab");
  await settle(window);
  return { dom, window, posts, step };
}

test("a stopped pipeline never becomes a question for Julian", async (context) => {
  // Machine state makes no ask. A stopped step is a fact on its Goal row;
  // Julian hears about it from the Area brain, not from Work.
  const { dom, window } = await shellFixture();
  context.after(() => dom.window.close());
  assert.equal(window.document.querySelector(".attention-queue"), null, "Work carries no attention strip");
  assert.equal(window.document.querySelector(".ask-table"), null, "no ask table exists");
  assert.equal(window.document.querySelector("[data-dismiss-ask]"), null, "nothing needs dismissing, because nothing was inferred");
  assert.equal(window.localStorage.getItem(ASK_DISMISSALS_KEY), null, "no browser receipt is written");
});

test("a Request dismissal is durable and tells the brain without using an answer", async (context) => {
  const request = {
    id: "request-one",
    kind: "decision",
    subject: "Choose storage",
    question: "Which storage must Tangent use?",
    options: ["Local", "Server"],
    status: "open",
  };
  const { dom, window, posts } = await shellFixture({ request });
  context.after(() => dom.window.close());
  // The Question reaches Julian through the Area header count and the
  // deliberate review, which is the only route Work now offers.
  const count = window.document.querySelector(`[data-review-questions="${goal.area}"]`);
  assert.ok(count, "the Area whose brain asked shows its question count");
  click(window, `[data-review-questions="${goal.area}"]`);
  await settle(window);
  click(window, "[data-modal-confirm]");
  await settle(window);

  const select = window.document.querySelector("[data-modal-select]");
  select.value = "dismiss";
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  click(window, "[data-modal-confirm]");
  await settle(window);
  assert.deepEqual(posts, [{ path: "/api/brains/requests/dismiss", body: { area: goal.area, id: request.id } }]);
  assert.equal(window.localStorage.getItem(ASK_DISMISSALS_KEY), null, "durable Request dismissal does not need a browser receipt");
});
