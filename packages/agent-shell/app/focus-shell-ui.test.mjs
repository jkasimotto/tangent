import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import documentComments from "./public/document-comments.js";
import areaMapView from "./public/area-map.js";
import { browserBundle } from "./test-browser-bundle.mjs";

const shellBundle = await browserBundle();

const here = path.dirname(fileURLToPath(import.meta.url));
// shell.js reads its search normalizer from this script, as the page does.
const goToCore = await readFile(path.join(here, "public", "go-to-core.js"), "utf8");
// The Goal card reads its counts and durations from this script, as the page does.
const goalCardCore = await readFile(path.join(here, "public", "goal-card-core.js"), "utf8");
// Every row of the For you card is built by this script, as the page does it.
const askCore = await readFile(path.join(here, "public", "ask-core.js"), "utf8");

/** Lets promise callbacks scheduled by the evaluated browser script finish. */
async function settle(window) {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

/** Clicks one required element in the test document. */
function click(window, selector) {
  const element = window.document.querySelector(selector);
  assert.ok(element, `Expected ${selector}`);
  element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}

/** Submits one required form in the test document. */
function submit(window, selector) {
  const form = window.document.querySelector(selector);
  assert.ok(form, `Expected ${selector}`);
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
}

/**
 * Opens a Document by title through Go to (⌘K): the work desk no longer
 * opens a Document from a Goal card or a Documents section
 * (design-compact-work-desk), so tests that only need a Document open reach
 * it through the finder, one of the routes that stayed.
 */
async function openDocumentViaGoTo(window, title) {
  click(window, "#go-to-button");
  const input = window.document.querySelector("#go-to-input");
  input.value = title;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await settle(window);
  click(window, "[data-go-to-row='0']");
  await settle(window);
}

/** Creates the small JSON response shape used by the browser API helper. */
function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    /** Returns the configured response payload. */
    async json() { return payload; },
  };
}

test("the live shell restores context, defines work with an agent, and organizes areas", async () => {
  const [html, script, mapCore, mapView] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
    readFile(path.join(here, "public", "area-map-core.js"), "utf8"),
    readFile(path.join(here, "public", "area-map.js"), "utf8"),
  ]);
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  // jsdom has no 2d canvas; the Area map renders its outline without one.
  window.HTMLCanvasElement.prototype.getContext = () => null;
  const goalFile = "otto/tangent/goal-ux-product-vision.md";
  const goal = {
    mtime: 1,
    area: "otto/tangent",
    slug: "ux-product-vision",
    file: goalFile,
    title: "UX Product Vision",
    status: "active",
    doneWhen: "Agent Shell is calm to understand, direct, and resume.",
    stateText: "The context-first shell works.\n\n### Open questions\n\n- Which moments need a checkpoint?",
    myUnderstanding: "Keep native chat central and prepare context around it.",
    currentBrief: "- You wanted: One calm surface.",
    storyText: "### The first shell failed\n\nIt showed controls before context.\n\n### Native chat stayed\n\nThe shell now augments the complete chat.",
    documents: [{ file: "otto/tangent/design-tangent.md", title: "Tangent product design", kind: "document" }],
    why: [],
    subgoalItems: [{ file: "otto/tangent/goal-use-cases.md", title: "Use cases", doneWhen: "The important use cases are documented.", status: "open" }],
    subgoals: ["use-cases"],
    depth: 0,
  };
  const subgoal = {
    ...goal,
    mtime: 2,
    slug: "use-cases",
    file: "otto/tangent/goal-use-cases.md",
    title: "Use cases",
    doneWhen: "The important use cases are documented.",
    currentBrief: "- You wanted: The important use cases are documented.",
    storyText: "",
    documents: [],
    why: [{ file: goalFile, title: "UX Product Vision", doneWhen: goal.doneWhen, status: "active" }],
    subgoalItems: [],
    subgoals: [],
    session: null,
    depth: 1,
  };
  const liveEditDocument = {
    file: "neara/hackathon/live-edit/use-case-documentation.md",
    area: "neara/hackathon/live-edit",
    kind: "document",
    title: "Live Edit use cases",
    searchText: "live edit collaboration use cases",
    goalHistory: [{ file: "neara/hackathon/live-edit/goal-define-live-edit-collaboration.md", title: "Define Live Edit collaboration", doneWhen: "The Live Edit design is ready to review." }],
  };
  const liveEditPrinciples = {
    ...liveEditDocument,
    file: "neara/hackathon/live-edit/principles-of-a-good-solution.md",
    title: "Principles of a good solution",
    searchText: "live edit collaboration principles shared boundaries",
  };
  const liveEditDesign = {
    ...liveEditDocument,
    file: "neara/hackathon/live-edit/design-live-edit-collaboration.md",
    title: "Live Edit collaboration design",
    searchText: "live edit collaboration complete design operations",
  };
  const liveEditGoal = {
    mtime: 3,
    area: "neara/hackathon/live-edit",
    slug: "define-live-edit-collaboration",
    file: "neara/hackathon/live-edit/goal-define-live-edit-collaboration.md",
    title: "Define Live Edit collaboration",
    status: "open",
    doneWhen: "The Live Edit design is ready to review.",
    stateText: "Five Documents are ready for review.",
    currentBrief: "- You wanted: A clear design for Live Edit collaboration.",
    storyText: "### Documents became the review surface\n\nFive linked Documents now carry the complete design.\n\n### Review found the next question\n\nThe operation serializer needs a separate explanation.",
    documents: [liveEditDocument, liveEditPrinciples, liveEditDesign],
    waitingOn: "Julian",
    why: [],
    subgoalItems: [],
    subgoals: [],
    depth: 0,
  };
  const staleCompletedGoal = {
    ...liveEditGoal,
    area: "otto/closed",
    slug: "already-complete",
    file: "otto/closed/goal-already-complete.md",
    title: "Already complete",
    status: "done",
    session: "stale-completed-run",
    waitingOn: "Julian",
    documents: [],
  };
  const vault = {
    areas: [
      { path: "neara", name: "neara", goals: [] },
      { path: "neara/hackathon", name: "hackathon", goals: [] },
      { path: "neara/hackathon/live-edit", name: "live-edit", goals: [liveEditGoal], documents: [liveEditDocument, liveEditPrinciples, liveEditDesign] },
      { path: "otto", name: "otto", goals: [] },
      { path: "otto/closed", name: "closed", goals: [staleCompletedGoal] },
      { path: "otto/dnd", name: "dnd", goals: [] },
      { path: "otto/tangent", name: "tangent", goals: [goal, subgoal] },
    ],
    map: [
      { path: "neara/hackathon/live-edit", name: "live-edit", goals: [liveEditGoal] },
      { path: "otto/closed", name: "closed", goals: [staleCompletedGoal] },
      { path: "otto/tangent", name: "tangent", goals: [goal, subgoal] },
    ],
    documents: [
      liveEditDocument,
      liveEditPrinciples,
      liveEditDesign,
      {
        file: "otto/tangent/design-tangent.md",
        area: "otto/tangent",
        kind: "document",
        title: "Tangent product design",
        searchText: "tangent product design neara pgande land the pgande megabranch land viz input",
        goalHistory: [
          { file: "neara/pgande/goal-land-megabranch.md", title: "Land the PG&E megabranch", doneWhen: "The megabranch is landed." },
          { file: "neara/pgande/goal-land-viz-input.md", title: "Land Viz Input", doneWhen: "Viz Input is landed." },
        ],
      },
    ],
  };
  const posts = [];
  const dockBadges = [];
  let dockBadgeClears = 0;
  let notificationPermission = "default";
  let reviewAgentStarted = false;
  let tangentSessionState = "waiting";
  let liveEditBrainStarted = false;
  // What the brain wrote in its plan's `## For Julian` section, as the server
  // parses and resolves it: a targeted Decide, a Test, and a Decide that
  // names no Document.
  const decideLine = "- Decide [[design-live-edit]]: which of the 3 questions first? Unblocks: the audit.";
  const testLine = "- Test [[goal-live-edit-collaboration]]: press Cmd+K, type a title, press Enter.";
  const freeDecideLine = "- Decide: should the audit cover the Usage UI too?";
  let brainRowsForJulian = [
    { kind: "decide", target: "design-live-edit", text: "which of the 3 questions first?", unblocks: "the audit", line: decideLine, index: 1, file: liveEditDesign.file, title: "Live Edit collaboration design", commentCount: 2, missing: false, goalStatus: null },
    { kind: "test", target: "live-edit-collaboration", text: "press Cmd+K, type a title, press Enter.", unblocks: null, line: testLine, index: 2, file: liveEditGoal.file, title: "Live Edit collaboration", commentCount: 0, missing: false, goalStatus: "done" },
    { kind: "decide", target: null, text: "should the audit cover the Usage UI too?", unblocks: null, line: freeDecideLine, index: 3, file: null, title: "should the audit cover the Usage UI too?", commentCount: 0, missing: false, goalStatus: null },
  ];
  let brainLive = true;
  const describeSessions = [];

  window.localStorage.setItem("agent-shell.current-goal", goalFile);
  window.setInterval = () => 0;
  Object.defineProperty(window.navigator, "clipboard", {
    value: {
      /** Records copied context without using the host clipboard. */
      async writeText(text) { posts.push({ path: "clipboard", body: text }); },
    },
  });
  Object.defineProperties(window.navigator, {
    setAppBadge: {
      /** Records the numeric Dock badge requested by Agent Shell. */
      value: async (count) => { dockBadges.push(count); },
    },
    clearAppBadge: {
      /** Records that Agent Shell explicitly cleared its Dock badge. */
      value: async () => { dockBadgeClears += 1; },
    },
  });
  Object.defineProperty(window, "Notification", {
    value: {
      /** Reports the notification permission the shell reads before badging. */
      get permission() { return notificationPermission; },
      /** Grants the permission that WebKit requires before displaying a Dock badge. */
      async requestPermission() { notificationPermission = "granted"; return notificationPermission; },
    },
  });
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (options.method === "POST") {
      const body = JSON.parse(options.body);
      posts.push({ path: pathname, body });
      if (pathname === "/api/goals/agent") reviewAgentStarted = true;
      if (pathname === "/api/brains/verdict") {
        brainRowsForJulian = brainRowsForJulian.filter((row) => row.line !== body.line);
        return jsonResponse({ ok: true, line: body.line, index: 2, target: "live-edit-collaboration", verdict: body.verdict });
      }
      if (pathname === "/api/work/describe") {
        const first = describeSessions.length === 0;
        const session = {
          name: first ? "dnd--describe-scene-flow" : "dnd--describe-ladder-authoring",
          area: "otto/dnd",
          kind: "work-definition",
          state: first ? "waiting" : "working",
          phase: "define",
          command: "codex",
          workTitle: first ? "Make the scene flow reliable" : "Define ladder authoring",
        };
        describeSessions.push(session);
        return jsonResponse({ session: session.name });
      }
      return jsonResponse({ file: goalFile, files: [goalFile] });
    }
    if (pathname === "/api/launch/options") {
      return jsonResponse({
        harnesses: [
          { id: "claude", label: "Claude", command: "claude", provider: "claude", models: [{ id: "fable-5", label: "Fable 5", args: "--model claude-fable-5" }, { id: "opus-5", label: "Opus 5", args: "--model claude-opus-5" }] },
          { id: "codex", label: "Codex", command: "codex", provider: "codex", models: [{ id: "sol", label: "Sol", args: "--model gpt-5.6-sol" }] },
          { id: "pi-code", label: "Pi Code", command: "pi-code", provider: null, models: [] },
        ],
        default: { command: "claude", label: "Claude", harness: "claude", model: null, source: null },
      });
    }
    if (pathname === "/api/sessions") {
      return jsonResponse({
        boot: "boot-1",
        caffeinate: false,
        sessions: [
          { name: "tangent-vision", goal: goalFile, state: tangentSessionState, stateDetail: tangentSessionState === "waiting" ? "decision" : null, stateQuestion: "Do you want to rewrite the vision section?", command: "codex" },
          { name: "stale-completed-run", goal: staleCompletedGoal.file, state: "waiting", command: "codex" },
          ...describeSessions,
          ...(reviewAgentStarted ? [{ name: "live-edit-collaboration", goal: liveEditGoal.file, state: "waiting", phase: "collaborate", command: "codex" }] : []),
          ...(liveEditBrainStarted ? [{ name: "live-edit-brain", area: liveEditGoal.area, kind: "brain", state: "waiting", command: "claude" }] : []),
        ],
        brains: liveEditBrainStarted
          ? [{ area: liveEditGoal.area, session: "live-edit-brain", status: brainLive ? "running" : "stopped", live: brainLive, generation: 1, state: brainLive ? "waiting" : null, stateDetail: brainLive ? "decision" : null, stateQuestion: "Do you want the audit to start now?", forJulian: brainRowsForJulian }]
          : [],
      });
    }
    if (pathname === "/api/programs") {
      return jsonResponse({
        programs: [
          { id: "process:otto/dnd:hmr", type: "process", area: "otto/dnd", name: "hmr", label: "HMR", command: "npm run dev:hmr", cwd: "/tmp", sessionName: "process-dnd--hmr-test", session: null, available: true },
          { id: "process:otto/tangent:shell", type: "process", area: "otto/tangent", name: "shell", label: "Agent Shell", command: "npm start", cwd: "/tmp", sessionName: "process-tangent--shell-test", session: { name: "process-tangent--shell-test", state: "running" }, available: true },
        ],
        errors: [],
        areas: [{ path: "otto/dnd", cwd: "/tmp" }],
        liveCount: 1,
        timezone: "Europe/Athens",
        scheduler: { installed: true, intervalMinutes: 30, lastExitCode: 0 },
      });
    }
    if (pathname === "/api/document") {
      const file = new URL(url, window.location.href).searchParams.get("file");
      if (file === liveEditDocument.file) {
        return jsonResponse({
          ...liveEditDocument,
          text: "---\ntype: document\nstatus: draft\n---\n\n# Live Edit use cases\n\nPeople can work together in one design. Read [[principles-of-a-good-solution]] or [open the design](design-live-edit-collaboration.md#Operations).\n\n## Collaboration shapes\n\nThe session has three shapes.\n\n### Observe\n\nOne participant can observe another.\n\n| State | Scope | Note |\n|---|:---:|---:|\n| Cursor | Presence | Never saved |",
          hash: "live-edit",
        });
      }
      if (file === liveEditPrinciples.file) {
        return jsonResponse({
          ...liveEditPrinciples,
          text: "# Principles of a good solution\n\n## Shared boundaries stay explicit\n\nThe shared state stays small. Return to [[use-case-documentation|the use cases]].",
          hash: "principles",
        });
      }
      if (file === liveEditDesign.file) {
        return jsonResponse({
          ...liveEditDesign,
          text: "# Live Edit collaboration design\n\n## Operations\n\nOperations serialize shared edits.",
          hash: "design-live-edit",
        });
      }
      return jsonResponse({ file, area: "otto/tangent", kind: "document", title: "Tangent product design", text: "# Tangent product design\n\nNative chat stays complete.", hash: "design" });
    }
    return jsonResponse(vault);
  };

  window.eval(shellBundle);
  await settle(window);

  assert.ok(window.document.querySelector(".work-page"), "the desk shows the Work page");
  assert.equal(window.document.querySelectorAll(".area-desk-panel").length, 2);
  assert.match(window.document.querySelector(".attention-queue h2").textContent, /For you/, "the card is named For you");
  const fallbackRows = [...window.document.querySelectorAll(".attention-queue .attention-items > *")];
  assert.equal(fallbackRows.length, 2, "with no brain, only the two Areas that ask something row");
  assert.equal(window.document.querySelector(".for-you-group:not(.fallback)"), null, "no brain, no brain group");
  assert.equal(window.document.querySelector(".area-for-you"), null, "no brain, no rows on any Area panel either");
  for (const row of fallbackRows) {
    assert.ok(row.querySelector(".attention-question"), "every row states the interaction it asks for");
    assert.match(row.querySelector(".attention-question").textContent, /\?$/);
  }
  const questions = fallbackRows.map((row) => row.querySelector(".attention-question").textContent);
  assert.ok(questions.includes("Accept the result?"), "a finished Goal that waits on Julian asks him to accept it");
  assert.ok(questions.includes("Do you want to rewrite the vision section?"), "a session stopped at a dialog asks the dialog's own question");
  assert.ok(
    !window.forYouItems().some((ask) => ask.subject === "Already complete"),
    "a done Goal never rows, however its handover reads"
  );
  assert.deepEqual(dockBadges, []);
  await window.enableDockBadge();
  await settle(window);
  assert.deepEqual(dockBadges, [2], "the Dock badge follows the For you count");

  // An idle session asks nothing at all: machine state on its own can never
  // make a row, with or without a brain.
  tangentSessionState = "working";
  await window.refresh();
  await settle(window);
  assert.equal(window.forYouItems().length, 1, "a working session is not an ask");
  assert.ok(!window.forYouItems().some((ask) => ask.source === "dialog"), "and no dialog row is left behind");
  tangentSessionState = "waiting";
  await window.refresh();
  await settle(window);

  // A brain on the Live Edit Area takes over as Julian's touchpoint: its Goal
  // drops out of the fallback, because the brain raises what that Area needs.
  assert.ok(window.fallbackAsks().some((ask) => ask.area === liveEditGoal.area), "before the brain, the Live Edit handover still needs Julian");
  liveEditBrainStarted = true;
  await window.refresh();
  await settle(window);
  assert.ok(!window.fallbackAsks().some((ask) => ask.area === liveEditGoal.area), "an Area with a brain never feeds the fallback");

  // Under the brain, its own rows lead the card, and the count is one number:
  // the brain's asks plus the fallback asks of the Areas without a brain.
  const group = window.document.querySelector(".attention-queue .for-you-group:not(.fallback)");
  assert.ok(group, "the brain's Area gets its own group");
  assert.match(group.querySelector("header").textContent, /Reply to brain/, "the group header answers the brain in one press");
  assert.equal(group.querySelector("[data-open-brain]").dataset.openBrain, "live-edit-brain");
  const rows = [...group.querySelectorAll(".attention-items > *")];
  assert.equal(rows.length, 4, "the brain's own dialog, then its three plan rows");
  assert.match(rows[0].textContent, /Do you want the audit to start now\?/, "a brain stuck at its own dialog is an ask");

  assert.match(rows[1].textContent, /design-live-edit-collaboration/, "the Decide row leads with the Document's file name");
  assert.match(rows[1].textContent, /Unblocks: the audit · 2 comments left/);
  assert.equal(rows[1].querySelector(".attention-question").textContent, "which of the 3 questions first?", "the brain's own question is the question");
  assert.equal(rows[1].querySelector("[data-open-document]").dataset.openDocument, liveEditDesign.file, "Read opens the Document Julian answers in");
  assert.match(rows[1].textContent, /Accept/);
  assert.match(rows[1].textContent, /Reject/);
  assert.match(rows[1].textContent, /Reply/, "a Decide row carries a reply affordance");

  assert.equal(rows[2].querySelector(".attention-question").textContent, "Accept it?", "Tangent asks the Test row's question, not the brain");
  assert.match(rows[2].textContent, /press Cmd\+K, type a title, press Enter\./);
  assert.match(rows[2].textContent, /Reply/, "a Test row carries a reply affordance too");

  assert.match(rows[3].textContent, /Brain asks/);
  assert.equal(rows[3].querySelector(".attention-question").textContent, "should the audit cover the Usage UI too?");
  assert.match(rows[3].textContent, /Answer/, "a question with no Document is answered in the brain's terminal");
  assert.equal(rows[3].querySelector("[data-reply-subject]").dataset.replySubject, "should the audit cover the Usage UI too?");

  assert.equal(window.forYouItems().length, 5, "the brain's four asks plus the one fallback ask left");
  assert.equal(window.document.querySelector(".attention-queue > header > span").textContent, "5", "the card's number is that one list");
  const brainGoalCard = window.document.querySelector(`[data-goal-anchor="${liveEditGoal.file}"]`);
  assert.ok(brainGoalCard, "the brain's Area still shows its Goal");
  assert.equal(brainGoalCard.classList.contains("waiting"), false, "a brain-run Goal keeps no amber");
  assert.match(brainGoalCard.className, /\bready\b/, "with no agent on it, the Goal is simply ready");

  // The same rows, with the same actions, sit right on the Area's own panel:
  // Julian decides there without the desk-wide card
  // (goal-decisions-show-on-the-area-view-not-just-a-count).
  const areaPanel = window.document.querySelector(`.area-desk-panel[data-desk-area="${liveEditGoal.area}"]`);
  assert.ok(areaPanel, "the Live Edit Area has its own panel");
  const areaGroup = areaPanel.querySelector(".area-for-you .for-you-group");
  assert.ok(areaGroup, "the Area panel gets the brain's group directly under its header");
  assert.equal(areaPanel.querySelector(".area-desk-header + .area-for-you"), areaPanel.querySelector(".area-for-you"), "the group sits right after the header, before Goal work");
  const areaRows = [...areaGroup.querySelectorAll(".attention-items > *")];
  assert.equal(areaRows.length, 4, "the Area panel shows the same rows as the desk card");
  assert.equal(areaRows[1].querySelector("[data-open-document]").dataset.openDocument, liveEditDesign.file, "Read on the Area panel opens the same Document");
  assert.equal(areaGroup.querySelector("[data-open-brain]").dataset.openBrain, "live-edit-brain", "Reply to brain also works from the Area panel");

  // With an agent on it, the pane is static because the brain has not read it
  // yet: the row states the fact and keeps the amber that means "you" off.
  const beforeAgent = reviewAgentStarted;
  reviewAgentStarted = true;
  await window.refresh();
  await settle(window);
  const runningGoalCard = window.document.querySelector(`[data-goal-anchor="${liveEditGoal.file}"]`);
  assert.ok(runningGoalCard.classList.contains("fact"), "under a brain it is a fact, not a call on Julian");
  assert.equal(runningGoalCard.classList.contains("waiting"), false, "and it keeps no amber");
  assert.match(runningGoalCard.querySelector(".desk-state.fact").textContent, /Waiting/, "the state word stays");
  reviewAgentStarted = beforeAgent;
  await window.refresh();
  await settle(window);
  assert.equal(dockBadges.at(-1), 5, "the Dock badge counts what the brain asked too");

  // A Test row stops asking the moment its Goal is no longer done: nothing
  // Julian already answered can go stale on the card.
  brainRowsForJulian = brainRowsForJulian.map((row) => (row.kind === "test" ? { ...row, goalStatus: "open" } : row));
  await window.refresh();
  await settle(window);
  assert.equal(window.forYouItems().length, 4, "a Test row whose Goal reopened is not shown");
  brainRowsForJulian = brainRowsForJulian.map((row) => (row.kind === "test" ? { ...row, goalStatus: "done" } : row));
  await window.refresh();
  await settle(window);

  // Accept answers the Test row: it goes now, the plan follows, and the brain
  // hears the verdict.
  click(window, "[data-verdict='accept']");
  await settle(window);
  assert.equal(posts.at(-1).path, "/api/brains/verdict");
  assert.equal(posts.at(-1).body.line, decideLine, "the first Accept on the card answers the first row");
  assert.equal(posts.at(-1).body.verdict, "accept");
  assert.equal(window.document.querySelectorAll(".attention-queue .for-you-group:not(.fallback) .attention-items > *").length, 3, "the row goes at once on the desk card");
  assert.equal(window.document.querySelectorAll(".area-for-you .for-you-group .attention-items > *").length, 3, "and on the Area panel too");
  await window.refresh();
  await settle(window);
  assert.equal(window.document.querySelectorAll(".attention-queue .for-you-group:not(.fallback) .attention-items > *").length, 3, "and stays gone after the poll");

  // Reject is an answer too, and it travels the same way.
  click(window, "[data-verdict='reject']");
  await settle(window);
  assert.equal(posts.at(-1).path, "/api/brains/verdict");
  assert.equal(posts.at(-1).body.verdict, "reject");
  assert.equal(posts.at(-1).body.line, testLine);

  // A stopped brain keeps the rows it already wrote, offers Resume, and still
  // does not hand its Area back to the fallback.
  brainLive = false;
  await window.refresh();
  await settle(window);
  const stoppedGroup = window.document.querySelector(".attention-queue .for-you-group.stopped");
  assert.ok(stoppedGroup, "the stopped brain keeps its group");
  assert.match(stoppedGroup.querySelector("header").textContent, /Brain stopped/);
  assert.equal(stoppedGroup.querySelector("[data-brain-area]").dataset.brainArea, liveEditGoal.area, "the header offers Resume");
  assert.ok(!window.forYouItems().some((ask) => ask.question === "Accept the result?"), "a stopped brain's Area does not feed the fallback as well");
  assert.ok(!stoppedGroup.textContent.includes("Reply"), "a stopped brain has no terminal to reply into");
  brainLive = true;

  liveEditBrainStarted = false;
  await window.refresh();
  await settle(window);

  window.__agentShellNativeDockBadge = true;
  notificationPermission = "denied";
  dockBadges.length = 0;
  await window.enableDockBadge();
  await settle(window);
  assert.deepEqual(dockBadges, [2]);
  assert.match(window.document.querySelector(".area-desk-panel:nth-child(2)").textContent, /Tangent/);
  assert.equal(window.document.querySelector(".area-desk-panel:nth-child(2) .area-desk-section.documents"), null, "the Documents section left the work tab");
  assert.equal(window.document.querySelectorAll(".desk-goal.subgoal").length, 1);
  assert.equal(window.document.querySelector("[data-work-filter='all']").getAttribute("aria-pressed"), "true");
  click(window, "[data-work-filter='active']");
  assert.equal(window.localStorage.getItem("agent-shell.work-filter"), "active");
  assert.equal(window.document.querySelectorAll(".area-desk-panel").length, 1);
  assert.match(window.document.querySelector(".area-desk-panel").textContent, /UX Product Vision/);
  assert.match(window.document.querySelector(".area-desk-panel").textContent, /Waiting/, "the pill is one word now; the duration is on the facts line");
  assert.equal(window.document.querySelectorAll(".desk-goal.subgoal").length, 1);
  assert.doesNotMatch(window.document.querySelector("#screen").textContent, /Define Live Edit collaboration/);
  click(window, "[data-work-filter='inactive']");
  assert.equal(window.document.querySelectorAll(".area-desk-panel").length, 1);
  assert.match(window.document.querySelector(".area-desk-section.goals h3").textContent, /Inactive work/);
  assert.match(window.document.querySelector(".area-desk-panel").textContent, /Define Live Edit collaboration/);
  assert.doesNotMatch(window.document.querySelector("#screen").textContent, /UX Product Vision/);
  click(window, "[data-work-filter='all']");
  // The Area square on the desk carries the Area's Programs beside its Goals and Documents.
  const tangentPanel = [...window.document.querySelectorAll(".area-desk-panel")].find((panel) => panel.textContent.includes("Tangent"));
  const deskProgram = tangentPanel.querySelector(".desk-program");
  assert.match(deskProgram.textContent, /Agent Shell/);
  assert.match(deskProgram.textContent, /Running/);
  assert.ok(deskProgram.classList.contains("live"));
  click(window, "[data-program-action='stop'][data-program-id='process:otto/tangent:shell']");
  assert.match(window.document.querySelector("#modal-title").textContent, /Stop Agent Shell/);
  click(window, "[data-modal-confirm]");
  await settle(window);
  assert.ok(posts.some((entry) => entry.path === "/api/programs/control" && entry.body.id === "process:otto/tangent:shell" && entry.body.action === "stop"));
  assert.equal(window.document.querySelector("#work-tab").getAttribute("aria-current"), "page");
  assert.equal(window.document.querySelector("#areas-tab").hidden, false);
  // Programs live inside the Area card now: the top bar carries no Programs tab.
  assert.equal(window.document.querySelector("#programs-button"), null);

  click(window, `[data-open-goal-run='${goalFile}']`);
  assert.ok(window.document.querySelector(".agent-page"));
  assert.equal(window.document.querySelector("#back-button").textContent, "Work");
  click(window, "#back-button");
  assert.ok(window.document.querySelector(".work-page"), "the desk shows the Work page");

  // The Goal row carries facts, not prose: no done condition, no Docs chip,
  // and the three secondary actions always in the same place.
  const goalRow = window.document.querySelector(`[data-goal-anchor='${goalFile}']`);
  assert.doesNotMatch(goalRow.textContent, /One calm surface/, "the done condition left the card");
  assert.equal(goalRow.querySelector(".desk-docs-chip"), null, "the Docs chip left the card");
  assert.match(goalRow.querySelector("[data-stop-goal]").textContent, /^End$/);
  const handoffRow = window.document.querySelector(`[data-goal-anchor='${liveEditGoal.file}']`);
  assert.equal(handoffRow.querySelector(".desk-goal-handoff"), null, "the handoff line left the card");
  assert.match(handoffRow.querySelector(".desk-state").textContent, /Waiting/, "the state pill says the Goal waits for Julian; the duration moved off the card");
  assert.equal(handoffRow.querySelector("[data-stop-goal]"), null);
  assert.equal(handoffRow.querySelector(".desk-secondary-actions button:disabled").textContent, "End", "a Goal with no agent still shows End, disabled");
  assert.equal(window.document.querySelector("[data-view-goal]"), null);

  click(window, `[data-stop-goal='${goalFile}']`);
  assert.match(window.document.querySelector("#modal-title").textContent, /Stop Codex/);
  assert.match(window.document.querySelector("#modal-copy").textContent, /work and its notes stay here/);
  click(window, "[data-modal-confirm]");
  await settle(window);
  assert.ok(posts.some((entry) => entry.path === "/api/kill/tangent-vision"));

  await openDocumentViaGoTo(window, "Tangent product design");
  assert.match(window.document.querySelector("#screen").textContent, /Document/);
  assert.match(window.document.querySelector("#screen").textContent, /Native chat stays complete/);

  click(window, "#back-button");
  assert.equal(window.document.querySelector("[data-new-goal]"), null);
  assert.equal(window.document.querySelectorAll(".area-desk-panel").length, 2);
  assert.match(window.document.querySelector("#screen").textContent, /Define Live Edit collaboration/);
  assert.match(window.document.querySelector("#screen").textContent, /Waiting/, "the desk still says a Goal waits for Julian");
  assert.doesNotMatch(window.document.querySelector("#screen").textContent, /Already complete/);
  assert.match(window.document.querySelector(".desk-subgoal-disclosure > summary").textContent, /To do that1 Subgoal/);

  const search = window.document.querySelector("#work-search");
  search.value = "when we landed the pgande megabranch we built the viz input thing";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.match(window.document.querySelector("#screen").textContent, /Tangent product design/);
  assert.match(window.document.querySelector("#screen").textContent, /Land the PG&E megabranch → Land Viz Input/);
  const joinedAreaSearch = window.document.querySelector("#work-search");
  joinedAreaSearch.value = "liveedit";
  joinedAreaSearch.dispatchEvent(new window.Event("input", { bubbles: true }));
  const matchingAreaPanel = window.document.querySelector(".search-area-results .area-desk-panel");
  assert.ok(matchingAreaPanel);
  assert.match(matchingAreaPanel.textContent, /Live Edit/);
  assert.match(matchingAreaPanel.textContent, /Define Live Edit collaboration/);
  const clearedSearch = window.document.querySelector("#work-search");
  clearedSearch.value = "";
  clearedSearch.dispatchEvent(new window.Event("input", { bubbles: true }));

  click(window, "[data-describe-area]");
  const describeArea = window.document.querySelector("#describe-area");
  describeArea.value = "otto/dnd";
  describeArea.dispatchEvent(new window.Event("input", { bubbles: true }));
  const description = window.document.querySelector("#describe-work");
  description.value = "Make the scene flow reliable. Terrain generation fits the view. Sprite cutouts keep the asset.";
  description.dispatchEvent(new window.Event("input", { bubbles: true }));
  click(window, "[data-launch-for='__describe__']");
  await settle(window);
  await settle(window);
  const describeAgentPicker = window.document.querySelector("[data-launch-popover]");
  assert.ok(describeAgentPicker, "the Describe work agent picker opens");
  assert.match(describeAgentPicker.textContent, /Claude/);
  assert.match(describeAgentPicker.textContent, /Codex/);
  assert.match(describeAgentPicker.textContent, /Pi Code/);
  assert.equal(window.document.querySelector("#describe-work").value, description.value);
  click(window, "[data-launch-for='__describe__']");
  submit(window, "[data-describe-work-form]");
  await settle(window);
  const described = posts.find((entry) => entry.path === "/api/work/describe");
  assert.equal(described.body.area, "otto/dnd");
  assert.equal(described.body.description, description.value);
  assert.equal(described.body.launch, true);
  assert.equal(described.body.session, undefined);
  assert.ok(window.document.querySelector(".agent-page"));
  assert.match(window.document.querySelector("#bar-context").textContent, /D&D · Defining work · Waiting for you/);
  assert.equal(window.localStorage.getItem("agent-shell.describe-draft"), null);
  assert.equal(window.localStorage.getItem("agent-shell.describe-session"), "dnd--describe-scene-flow");

  click(window, "#back-button");
  assert.equal(window.document.querySelector("[data-describe-area]").textContent.trim(), "Describe work here");
  const workDefinition = window.document.querySelector(".desk-definition");
  assert.ok(workDefinition, window.document.querySelector("#screen").textContent);
  assert.match(workDefinition.closest(".area-desk-panel").textContent, /D&D/);
  assert.match(workDefinition.textContent, /Defining work/);
  assert.match(workDefinition.textContent, /Make the scene flow reliable/);
  assert.match(workDefinition.textContent, /Waiting for you/);
  click(window, "[data-select-work-definition='dnd--describe-scene-flow']");
  assert.ok(window.document.querySelector(".agent-page"));
  click(window, "#back-button");
  click(window, "[data-describe-area]");
  assert.ok(window.document.querySelector("[data-describe-work-form]"));
  assert.equal(window.document.querySelector("#describe-work").value, "");
  const secondDescription = window.document.querySelector("#describe-work");
  secondDescription.value = "Define ladder authoring.";
  secondDescription.dispatchEvent(new window.Event("input", { bubbles: true }));
  submit(window, "[data-describe-work-form]");
  await settle(window);
  assert.ok(window.document.querySelector(".agent-page"));
  click(window, "#back-button");
  assert.equal(window.document.querySelectorAll(".desk-definition").length, 2);
  assert.match(window.document.querySelector("#screen").textContent, /Make the scene flow reliable/);
  assert.match(window.document.querySelector("#screen").textContent, /Define ladder authoring/);
  assert.match(window.document.querySelector("#screen").textContent, /Agent working/);
  click(window, "[data-describe-area]");
  const manualArea = window.document.querySelector("#describe-area");
  manualArea.value = "neara/hackathon/live-edit";
  manualArea.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(window.document.querySelector("[data-create-manually]").textContent.trim(), "Create Goal manually");
  click(window, "[data-create-manually]");
  await settle(window);
  assert.equal(window.document.querySelector("#new-goal-area").value, "neara/hackathon/live-edit");
  assert.equal(window.document.querySelector("#new-goal-title"), window.document.activeElement);
  click(window, "[data-cancel-create]");
  assert.ok(window.document.querySelector("[data-describe-work-form]"));
  assert.equal(window.document.querySelector("#describe-area").value, "neara/hackathon/live-edit");
  click(window, "[data-create-manually]");
  window.document.querySelector("#new-goal-title").value = "Share a scene safely";
  window.document.querySelector("#new-goal-result").value = "A collaborator can join without losing scene edits.";
  submit(window, "[data-create-form]");
  await settle(window);
  const manualGoal = posts.find((entry) => entry.path === "/api/goals/new");
  assert.deepEqual(manualGoal.body, {
    area: "neara/hackathon/live-edit",
    title: "Share a scene safely",
    doneWhen: "A collaborator can join without losing scene edits.",
    state: "",
  });
  assert.equal(posts.some((entry) => entry.path === "/api/goals/agent" && entry.body.file === goalFile), false);
  click(window, "#back-button");
  click(window, "#areas-tab");
  click(window, "[data-toggle-area='neara']");
  click(window, "[data-toggle-area='neara/hackathon']");
  click(window, "[data-select-area='neara/hackathon/live-edit']");
  await settle(window);
  assert.ok(window.document.querySelector(".area-map-screen"), "the selected Area shows its map screen");
  assert.match(window.document.querySelector(".area-map-outline").textContent, /Live Edit use cases/);
  assert.equal(window.document.querySelectorAll(".area-map-row").length, 3, "the three Live Edit Documents are outline rows");
  assert.ok(window.document.querySelector("[data-mark-area-done='neara/hackathon/live-edit']"), "Mark done is offered");
  const useCasesRow = [...window.document.querySelectorAll(".area-map-row")].find((row) => /Live Edit use cases/.test(row.textContent));
  useCasesRow.click();
  await settle(window);
  assert.match(window.document.querySelector(".area-map-card").textContent, /Live Edit use cases/);
  click(window, `.area-map-card [data-open-document='${liveEditDocument.file}']`);
  await settle(window);
  assert.match(window.document.querySelector("#screen").textContent, /People can work together/);
  assert.equal(window.document.querySelector(".work-review-nav"), null);
  assert.ok(window.document.querySelector(".document-reader"));
  assert.equal(window.document.querySelector("#bar-context").textContent, "");
  assert.equal(window.document.querySelectorAll(".document-picker [data-open-document]").length, 3);
  assert.equal(window.document.querySelectorAll(".document-outline a").length, 2);
  assert.match(window.document.querySelector(".document-outline").textContent, /Collaboration shapes/);
  assert.doesNotMatch(window.document.querySelector(".document-content").textContent, /type: document|status: draft/);
  assert.equal(window.document.querySelectorAll(".document-content table").length, 1);
  assert.equal(window.document.querySelectorAll(".document-content th").length, 3);
  assert.match(window.document.querySelector(".document-content td.align-center").textContent, /Presence/);
  assert.doesNotMatch(window.document.querySelector(".document-content").textContent, /---/);
  // The reader names the screen it returns to and prints the key that leaves it.
  assert.equal(window.document.querySelector("#back-button").textContent, "Areas esc");
  assert.match(window.document.querySelector(".markdown-vault-link").textContent, /Principles of a good solution/);
  assert.match(window.document.querySelector(".markdown-vault-link + .markdown-vault-link").textContent, /open the design/);
  assert.equal(window.document.querySelector("[data-document-history='back']").disabled, true);

  const readingPane = window.document.querySelector(".document-reader-scroll");
  readingPane.scrollTop = 180;
  readingPane.dispatchEvent(new window.Event("scroll"));
  tangentSessionState = "working";
  await window.refresh();
  assert.equal(window.document.querySelector(".document-reader-scroll"), readingPane);
  assert.equal(readingPane.scrollTop, 180);

  click(window, ".markdown-vault-link");
  await settle(window);
  assert.match(window.document.querySelector(".document-content").textContent, /Shared boundaries stay explicit/);
  assert.match(window.document.querySelector(".document-picker button.selected").textContent, /Principles/);
  assert.equal(window.document.querySelector("[data-document-history='back']").disabled, false);

  click(window, "[data-document-history='back']");
  await settle(window);
  assert.match(window.document.querySelector(".document-content").textContent, /Collaboration shapes/);
  assert.equal(window.document.querySelector("[data-document-history='forward']").disabled, false);
  click(window, "[data-document-history='forward']");
  await settle(window);
  assert.match(window.document.querySelector(".document-content").textContent, /Shared boundaries stay explicit/);

  click(window, `[data-open-document='${liveEditDocument.file}']`);
  await settle(window);
  click(window, "[data-open-area='neara/hackathon/live-edit']");
  assert.match(window.document.querySelector(".area-contents-heading").textContent, /Live Edit/);
  click(window, `[data-open-document='${liveEditDocument.file}']`);
  await settle(window);

  click(window, "[data-open-reader-agent]");
  await settle(window);
  const collaboration = posts.find((entry) => entry.path === "/api/goals/agent");
  assert.equal(collaboration.body.file, liveEditGoal.file);
  assert.equal(collaboration.body.document, liveEditDocument.file);
  assert.ok(window.document.querySelector(".agent-page"));
  assert.equal(window.document.querySelector(".document-reader"), null);
  assert.equal(window.document.querySelector("#back-button").textContent, "Document");
  click(window, "#back-button");
  await settle(window);
  assert.ok(window.document.querySelector(".document-reader"));
  assert.match(window.document.querySelector(".document-content").textContent, /Cursor/);
  click(window, "#back-button");
  assert.match(window.document.querySelector("#screen").textContent, /Live Edit use cases/);
  click(window, "[data-toggle-area='neara']");
  assert.equal(window.document.querySelector("[data-select-area='neara/hackathon']"), null);
  click(window, "[data-toggle-area='neara']");
  assert.ok(window.document.querySelector("[data-select-area='neara/hackathon']"));
  click(window, "#back-button");
  // The Area card carries the Programs of the selected Area.
  click(window, "[data-select-area='otto/dnd']");
  const programSection = [...window.document.querySelectorAll(".area-content-section")].at(-1);
  assert.match(programSection.textContent, /1 Program/);
  assert.match(programSection.textContent, /npm run dev:hmr/);
  assert.match(programSection.querySelector(".program-state").textContent, /Not running/);
  click(window, "[data-new-program]");
  assert.equal(window.document.querySelector("[data-program-draft='area']").value, "otto/dnd");
  click(window, "[data-cancel-program-create]");
  assert.ok(window.document.querySelector("[data-select-program]"));
  click(window, "[data-program-action='start']");
  await settle(window);
  assert.ok(posts.some((entry) => entry.path === "/api/programs/control" && entry.body.id === "process:otto/dnd:hmr" && entry.body.action === "start"));
  click(window, "[data-select-program]");
  assert.match(window.document.querySelector("#screen").textContent, /npm run dev:hmr/);
  assert.match(window.document.querySelector("#screen").textContent, /Start/);
  assert.equal(window.document.querySelector("#back-button").textContent, "Areas");
  assert.equal(window.document.querySelector("#areas-tab").getAttribute("aria-current"), "page");
  click(window, "#back-button");
  assert.ok(window.document.querySelector("[data-select-program]"));

  click(window, "#work-tab");
  click(window, `[data-wont-do-goal='${goal.file}']`);
  assert.match(window.document.querySelector("#modal-title").textContent, /Mark “UX Product Vision” won't do/);
  click(window, "[data-modal-confirm]");
  await settle(window);
  assert.equal(posts.some((entry) => entry.body.status === "dropped"), false);
  assert.equal(window.document.querySelector("#modal-layer").hidden, false);
  window.document.querySelector("[data-modal-input]").value = "A smaller goal replaced this work.";
  click(window, "[data-modal-confirm]");
  await settle(window);
  assert.ok(posts.some((entry) => entry.path === "/api/goals/edit" && entry.body.file === goal.file && entry.body.status === "dropped" && entry.body.reason === "A smaller goal replaced this work."));

  click(window, `[data-complete-goal='${subgoal.file}']`);
  assert.match(window.document.querySelector("#modal-title").textContent, /Mark “Use cases” complete/);
  click(window, "[data-modal-confirm]");
  await settle(window);
  assert.ok(posts.some((entry) => entry.path === "/api/goals/edit" && entry.body.file === subgoal.file && entry.body.status === "done"));
  assert.ok(window.document.querySelector(".work-page"), "the desk shows the Work page");

  goal.status = "done";
  subgoal.status = "done";
  liveEditGoal.status = "done";
  for (const session of describeSessions) session.state = "working";
  await window.refresh();
  await settle(window);
  assert.equal(dockBadgeClears, 1);

  dom.window.close();
});

test("the Agent Shell menu owns refresh, reload, and rebuild, and a dead server never wipes the screen", async () => {
  const [html, script, mapCore] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
    readFile(path.join(here, "public", "area-map-core.js"), "utf8"),
  ]);
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  let boot = "boot-1";
  let sourceChanged = false;
  let offline = false;
  const posts = [];
  window.fetch = async (url, options = {}) => {
    if (offline) throw new Error("connection refused");
    const pathname = new URL(url, window.location.href).pathname;
    if (options.method === "POST") {
      posts.push({ path: pathname, body: options.body ? JSON.parse(options.body) : {} });
      return jsonResponse({ ok: true });
    }
    if (pathname === "/api/sessions") return jsonResponse({ boot, sourceChanged, caffeinate: false, sessions: [] });
    if (pathname === "/api/programs") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    return jsonResponse({ areas: [], map: [], documents: [] });
  };
  window.eval(shellBundle);
  await settle(window);
  assert.ok(window.document.querySelector(".work-page"), "the desk shows the Work page");
  assert.equal(window.document.querySelector("#shell-menu").hidden, true);

  // The top-left title opens the menu on a top-level view.
  click(window, "#back-button");
  assert.equal(window.document.querySelector("#shell-menu").hidden, false);
  assert.equal(window.document.querySelector("#menu-update").hidden, true);
  click(window, "#menu-refresh");
  await settle(window);
  assert.equal(window.document.querySelector("#shell-menu").hidden, true);

  sourceChanged = true;
  await window.refresh();
  click(window, "#back-button");
  assert.equal(window.document.querySelector("#menu-update").hidden, false);
  assert.match(window.document.querySelector("#menu-update").textContent, /Changes · Reload Tangent/);
  click(window, "#menu-update");
  assert.match(window.document.querySelector("#modal-title").textContent, /Rebuild and restart Agent Shell/);
  click(window, "[data-modal-cancel]");

  // A failing poll keeps the rendered desk and shows one quiet pill.
  offline = true;
  await window.refresh();
  await settle(window);
  assert.ok(window.document.querySelector(".work-page"), "the desk shows the Work page");
  assert.equal(window.document.querySelector("#status-pill").hidden, false);
  assert.match(window.document.querySelector("#status-pill").textContent, /Server offline/);

  // A rebuilt server announces itself; the app offers a reload, never forces one.
  offline = false;
  boot = "boot-2";
  await window.refresh();
  await settle(window);
  assert.equal(window.document.querySelector("#status-pill").hidden, true);
  assert.equal(window.document.querySelector("#back-button").classList.contains("has-update"), true);
  click(window, "#back-button");
  assert.equal(window.document.querySelector("#menu-update").hidden, false);

  // Rebuild asks first, then reports progress in the pill.
  click(window, "#menu-rebuild");
  await settle(window);
  assert.match(window.document.querySelector("#modal-title").textContent, /Rebuild and restart Agent Shell/);
  click(window, "[data-modal-confirm]");
  await settle(window);
  assert.ok(posts.some((entry) => entry.path === "/api/shell/rebuild"));
  assert.match(window.document.querySelector("#status-pill").textContent, /Rebuilding/);

  dom.window.close();
});

test("checked Goals start one shared agent that owns them in checked order", async () => {
  const [html, script, mapCore] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
    readFile(path.join(here, "public", "area-map-core.js"), "utf8"),
  ]);
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  /** One startable root Goal for the selection desk. */
  const makeGoal = (slug, title, mtime) => ({
    mtime,
    area: "otto/dnd",
    slug,
    file: `otto/dnd/goal-${slug}.md`,
    title,
    status: "open",
    doneWhen: `${title} is done.`,
    stateText: "",
    currentBrief: `- You wanted: ${title}.`,
    storyText: "",
    documents: [],
    why: [],
    subgoalItems: [],
    subgoals: [],
    depth: 0,
  });
  const first = makeGoal("fix-the-flicker", "Fix the flicker", 1);
  const second = makeGoal("name-the-panes", "Name the panes", 2);
  const posts = [];
  let started = false;
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (options.method === "POST") {
      posts.push({ path: pathname, body: options.body ? JSON.parse(options.body) : {} });
      if (pathname === "/api/goals/agent") started = true;
      return jsonResponse({ ok: true, session: "dnd--name-the-panes" });
    }
    if (pathname === "/api/sessions") {
      return jsonResponse({
        boot: "boot-1",
        caffeinate: false,
        sessions: started ? [{ name: "dnd--name-the-panes", goal: second.file, state: "waiting", phase: "collaborate", command: "codex" }] : [],
      });
    }
    if (pathname === "/api/programs") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    return jsonResponse({
      areas: [
        { path: "otto", name: "otto", goals: [] },
        { path: "otto/dnd", name: "dnd", goals: [first, second], documents: [] },
      ],
      map: [{ path: "otto/dnd", name: "dnd", goals: [first, second] }],
      documents: [],
    });
  };
  window.eval(shellBundle);
  await settle(window);
  assert.ok(window.document.querySelector(".work-page"), "the desk shows the Work page");

  // Both startable rows carry a checkbox; nothing is checked, so no action bar.
  assert.equal(window.document.querySelectorAll("[data-check-goal]").length, 2);
  assert.equal(window.document.querySelector("[data-start-selected]"), null);

  // Checking is free: the bar appears, nothing starts.
  click(window, `[data-check-goal='${second.file}']`);
  assert.match(window.document.querySelector("[data-start-selected]").textContent, /Start agent on 1 Goal/);
  click(window, `[data-check-goal='${first.file}']`);
  assert.match(window.document.querySelector("[data-start-selected]").textContent, /Start agent on 2 Goals/);
  assert.equal(posts.length, 0);

  // Escape clears the selection.
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(window.document.querySelector("[data-start-selected]"), null);
  assert.equal(window.document.querySelectorAll("[data-check-goal]:checked").length, 0);

  // Checked order decides the primary: the first checked Goal leads the session.
  click(window, `[data-check-goal='${second.file}']`);
  click(window, `[data-check-goal='${first.file}']`);
  click(window, "[data-start-selected]");
  await settle(window);
  const start = posts.find((entry) => entry.path === "/api/goals/agent");
  assert.equal(start.body.file, second.file);
  assert.deepEqual(start.body.extraFiles, [first.file]);
  assert.equal(start.body.launch, true);

  // The selection is spent: returning to the desk shows clean checkboxes.
  click(window, "#work-tab");
  await settle(window);
  assert.equal(window.document.querySelector("[data-start-selected]"), null);
  assert.equal(window.document.querySelectorAll("[data-check-goal]:checked").length, 0);

  dom.window.close();
});

test("the launch popover composes a pipeline of steps and the desk shows its progress", async () => {
  const [html, script, mapCore] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
    readFile(path.join(here, "public", "area-map-core.js"), "utf8"),
  ]);
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  const goal = {
    mtime: 1,
    area: "otto/dnd",
    slug: "ship-the-map",
    file: "otto/dnd/goal-ship-the-map.md",
    title: "Ship the map",
    status: "open",
    doneWhen: "The map ships.",
    stateText: "",
    currentBrief: "- You wanted: Ship the map.",
    storyText: "",
    documents: [],
    why: [],
    subgoalItems: [],
    subgoals: [],
    depth: 0,
  };
  const posts = [];
  let pipeline = null;
  let sessions = [];
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (options.method === "POST") {
      const body = options.body ? JSON.parse(options.body) : {};
      posts.push({ path: pathname, body });
      if (pathname === "/api/goals/start" && body.steps) {
        pipeline = {
          goal: goal.file, area: goal.area, slug: goal.slug, status: "running", updatedAt: "t1", extraFiles: [],
          steps: body.steps.map((step, index) => ({
            index: index + 1, instruction: step.instruction, launch: step.launch ?? null, command: step.command ?? "",
            label: index === 0 ? "Codex · Sol · High" : "Claude · Fable 5", continueFrom: step.continueFrom ?? null,
            status: index === 0 ? "running" : "pending", session: index === 0 ? "dnd-ship-the-map" : null,
            handover: null, handoverSource: null, live: index === 0, state: index === 0 ? "working" : null, stateDetail: null, idleSince: null,
          })),
        };
        sessions = [{ name: "dnd-ship-the-map", goal: goal.file, state: "working", phase: "execute", command: "codex", pipeline: goal.file, step: 1 }];
        return jsonResponse({ session: "dnd-ship-the-map", pipeline });
      }
      if (pathname === "/api/pipelines/append") {
        const added = body.steps.map((step, offset) => ({
          index: pipeline.steps.length + offset + 1, instruction: step.instruction, launch: step.launch ?? null, command: step.command ?? "",
          label: "Claude · Fable 5", continueFrom: step.continueFrom ?? null, status: "pending", session: null,
          handover: null, handoverSource: null, live: false, state: null, stateDetail: null, idleSince: null,
        }));
        pipeline.steps.push(...added);
        pipeline.updatedAt = `t${pipeline.steps.length}`;
        return jsonResponse({ status: "queued", after: 1, added: added.map((step) => step.index), pipeline });
      }
      if (pathname === "/api/pipelines/control" && body.action === "end") {
        for (const step of pipeline.steps) if (!["complete", "skipped"].includes(step.status)) { step.status = "ended"; step.live = false; }
        pipeline.status = "complete";
        pipeline.updatedAt = "t-ended";
        return jsonResponse({ status: "ended", next: null, ended: [2, 3], pipeline });
      }
      if (pathname === "/api/pipelines/control") {
        pipeline.steps[0].status = "complete";
        pipeline.steps[0].handover = "Design written: design-map.md.\nUnresolved: none.";
        pipeline.steps[1].status = "running";
        pipeline.steps[1].session = "dnd-ship-the-map-s2";
        pipeline.steps[1].live = false;
        return jsonResponse({ status: "started", next: { index: 2, session: "dnd-ship-the-map-s2" }, pipeline });
      }
      return jsonResponse({ ok: true, session: "dnd-ship-the-map" });
    }
    if (pathname === "/api/sessions") return jsonResponse({ boot: "boot-1", caffeinate: false, sessions, pipelines: pipeline ? [pipeline] : [] });
    if (pathname === "/api/programs") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    if (pathname === "/api/launch/options") {
      return jsonResponse({
        harnesses: [
          { id: "codex", label: "Codex", command: "codex", models: [{ id: "sol", label: "Sol", args: "--model sol" }], efforts: [{ id: "high", label: "High", args: "-c effort=high" }] },
          { id: "claude", label: "Claude", command: "claude", models: [{ id: "fable-5", label: "Fable 5", args: "--model claude-fable-5" }], efforts: [] },
        ],
        default: { harness: "claude", model: "fable-5", effort: null, command: "claude --model claude-fable-5", label: "Claude · Fable 5" },
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
  click(window, `[data-launch-for='${goal.file}']`);
  await settle(window);
  await settle(window);
  /** Reads the launch popover, which the shell redraws on every paint. */
  const popover = () => window.document.querySelector("[data-launch-popover]");
  assert.ok(popover(), "the popover opened");
  // One step, no instruction: a plain start with the Area default.
  assert.equal(window.document.querySelectorAll("[data-launch-step-select]").length, 1);
  assert.match(window.document.querySelector("[data-launch-start]").textContent, /Start Claude · Fable 5/);

  // Step 1: Codex Sol at High effort, with an instruction that survives repaints.
  click(window, "[data-launch-harness='codex']");
  assert.ok(window.document.querySelector("[data-launch-effort='high']"), "the Effort column shows for a harness with efforts");
  click(window, "[data-launch-effort='high']");
  assert.match(window.document.querySelector(".launch-command code").textContent, /codex --model sol -c effort=high/);
  window.document.querySelector("#launch-instruction").value = "/design the map";
  click(window, "[data-launch-step-add]");
  assert.equal(window.document.querySelectorAll("[data-launch-step-select]").length, 2);
  assert.match(window.document.querySelector("[data-launch-step-select='0']").textContent, /Codex · Sol · High/);
  assert.match(window.document.querySelector("[data-launch-step-select='0']").textContent, /design the map/);
  assert.match(window.document.querySelector("[data-launch-start]").textContent, /Start 2 steps/);
  // Step 2 keeps the Area default and continues step 1's session.
  window.document.querySelector("#launch-instruction").value = "Review the design and update it";
  const continueSelect = window.document.querySelector("[data-launch-continue]");
  assert.ok(continueSelect, "a later step can continue an earlier one");
  continueSelect.value = "1";
  continueSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
  // Switching rows keeps both drafts.
  click(window, "[data-launch-step-select='0']");
  assert.equal(window.document.querySelector("#launch-instruction").value, "/design the map");
  click(window, "[data-launch-step-select='1']");
  assert.equal(window.document.querySelector("#launch-instruction").value, "Review the design and update it");

  click(window, "[data-launch-start]");
  await settle(window);
  await settle(window);
  const start = posts.find((entry) => entry.path === "/api/goals/start");
  assert.equal(start.body.file, goal.file);
  assert.deepEqual(start.body.steps, [
    { instruction: "/design the map", continueFrom: null, launch: { harness: "codex", model: "sol", effort: "high" } },
    { instruction: "Review the design and update it", continueFrom: 1, launch: { harness: "claude", model: "fable-5", effort: null } },
  ]);

  // The desk shows step 1 of 2 with a chip per step; step 2 is not startable by hand.
  click(window, "#work-tab");
  await settle(window);
  const row = window.document.querySelector(`[data-goal-anchor='${goal.file}']`);
  assert.match(row.querySelector(".desk-state").textContent, /^Working$/);
  assert.equal(row.querySelector(".desk-step-line").textContent, "Step 1 of 2");
  assert.match(row.querySelector(".desk-step-line").title, /Codex · Sol · High/);
  assert.equal(row.querySelector(".desk-step"), null, "the step chips left the card");
  assert.equal(row.querySelector(".desk-goal-facts").textContent, "1 agent", "the step session counts as one agent");
  assert.equal(row.querySelector("[data-check-goal]"), null);
  assert.equal(row.querySelector("[data-pipeline-control]"), null);
  assert.match(row.querySelector("[data-stop-goal]").textContent, /^End$/);

  // The running pipeline row keeps a ▾ that opens the step list: history is
  // fixed, the pending step edits in place, and a draft row appends.
  const stepsToggle = row.querySelector("[data-launch-for]");
  assert.ok(stepsToggle, "a running pipeline row offers its steps");
  assert.equal(stepsToggle.title, "Add or edit steps");
  click(window, `[data-goal-anchor='${goal.file}'] [data-launch-for]`);
  await settle(window);
  await settle(window);
  assert.ok(popover(), "the popover opened on the running pipeline");
  assert.equal(window.document.querySelectorAll(".launch-step-fixed").length, 1, "the running step is history");
  assert.equal(window.document.querySelectorAll("[data-launch-step-select]").length, 1, "only the pending step is editable");
  assert.equal(window.document.querySelector("#launch-instruction").value, "Review the design and update it");
  assert.match(window.document.querySelector("[data-launch-start]").textContent, /Save step 2/);
  click(window, "[data-launch-step-add]");
  assert.equal(window.document.querySelectorAll("[data-launch-step-select]").length, 2);
  assert.match(window.document.querySelector("[data-launch-start]").textContent, /Add step 3/);
  window.document.querySelector("#launch-instruction").value = "Prove it";
  click(window, "[data-launch-harness='codex']");
  click(window, "[data-launch-start]");
  await settle(window);
  await settle(window);
  const append = posts.find((entry) => entry.path === "/api/pipelines/append");
  assert.deepEqual(append.body, { goal: goal.file, steps: [{ instruction: "Prove it", continueFrom: null, launch: { harness: "codex", model: "sol", effort: null } }] });
  assert.equal(popover(), null, "the popover closed after the append");
  assert.equal(posts.filter((entry) => entry.path === "/api/goals/start").length, 1, "an append never restarts the pipeline");
  const grownRow = window.document.querySelector(`[data-goal-anchor='${goal.file}']`);
  assert.equal(grownRow.querySelector(".desk-step-line").textContent, "Step 1 of 3");

  // The step session dies: the row offers Restart and Skip; Skip advances the line
  // and the latest handover shows under the chips.
  sessions = [];
  pipeline.steps[0].live = false;
  click(window, "#menu-refresh");
  await settle(window);
  await settle(window);
  const stoppedRow = window.document.querySelector(`[data-goal-anchor='${goal.file}']`);
  assert.match(stoppedRow.querySelector(".desk-state").textContent, /^Stopped$/);
  assert.equal(stoppedRow.querySelector(".desk-step-line").textContent, "Step 1 of 3");
  assert.equal(stoppedRow.querySelector("[data-stop-goal]"), null);
  assert.ok(stoppedRow.querySelector("[data-pipeline-control='restart']"));
  click(window, `[data-goal-anchor='${goal.file}'] [data-pipeline-control='skip']`);
  await settle(window);
  await settle(window);
  const control = posts.find((entry) => entry.path === "/api/pipelines/control");
  assert.deepEqual(control.body, { goal: goal.file, action: "skip", step: 1 });
  const afterRow = window.document.querySelector(`[data-goal-anchor='${goal.file}']`);
  assert.equal(afterRow.querySelector(".desk-handover"), null, "the handover line left the card");

  // Step 2 died too. Stop work ends the run: the row settles back to a plain
  // open Goal and no Restart lingers.
  assert.match(afterRow.querySelector(".desk-state").textContent, /^Stopped$/);
  assert.equal(afterRow.querySelector(".desk-step-line").textContent, "Step 2 of 3");
  const stopWork = afterRow.querySelector("[data-pipeline-control='end']");
  assert.ok(stopWork, "a stopped step offers Stop work");
  assert.equal(stopWork.textContent, "Stop work");
  click(window, `[data-goal-anchor='${goal.file}'] [data-pipeline-control='end']`);
  await settle(window);
  await settle(window);
  const endPost = posts.filter((entry) => entry.path === "/api/pipelines/control").at(-1);
  assert.deepEqual(endPost.body, { goal: goal.file, action: "end", step: 2 });
  const endedRow = window.document.querySelector(`[data-goal-anchor='${goal.file}']`);
  assert.match(endedRow.querySelector(".desk-state").textContent, /Ready/);
  assert.equal(endedRow.querySelector("[data-pipeline-control]"), null, "nothing offers Restart after Stop work");

  // A finished pipeline: the row is a plain Goal row again, and its ▾ opens
  // the finished steps with a draft row ready to append, never a fresh start.
  for (const step of pipeline.steps) { step.status = "complete"; step.live = false; }
  pipeline.status = "complete";
  pipeline.updatedAt = "t-complete";
  click(window, "#menu-refresh");
  await settle(window);
  await settle(window);
  const finishedRow = window.document.querySelector(`[data-goal-anchor='${goal.file}']`);
  assert.match(finishedRow.querySelector(".desk-state").textContent, /Ready/);
  assert.equal(finishedRow.querySelector("[data-launch-for]").title, "Add or edit steps");
  click(window, `[data-goal-anchor='${goal.file}'] [data-launch-for]`);
  await settle(window);
  await settle(window);
  assert.equal(window.document.querySelectorAll(".launch-step-fixed").length, 3, "finished steps stay as history");
  assert.equal(window.document.querySelectorAll("[data-launch-step-select]").length, 1, "one draft row waits to be appended");
  assert.equal(window.document.querySelector("[data-launch-step-remove]"), null, "the only draft row cannot be removed");
  assert.match(window.document.querySelector("[data-launch-start]").textContent, /Add step 4/);
  click(window, "[data-launch-step-add]");
  assert.match(window.document.querySelector("[data-launch-start]").textContent, /Add 2 steps/);
  click(window, "[data-launch-step-remove='4']");
  assert.match(window.document.querySelector("[data-launch-start]").textContent, /Add step 4/);

  dom.window.close();
});

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
  click(window, "#back-button");
  await settle(window);
  // The brain stopped: the icon is dim again, and the popover offers Resume with the old instruction.
  brain = { ...brain, status: "stopped", live: false, state: null, latestHandover: "Wave 1 dispatched.\nNext: review.", updatedAt: "t-stopped" };
  sessions = [];
  click(window, "#menu-refresh");
  await settle(window);
  await settle(window);
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

test("background polls never rebuild the screen under an editing surface or a reader", async () => {
  const [html, script, mapCore] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
    readFile(path.join(here, "public", "area-map-core.js"), "utf8"),
  ]);
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  let poll = null;
  window.setInterval = (callback) => { poll = callback; return 0; };
  const goal = {
    mtime: 1,
    area: "otto/dnd",
    slug: "ship-the-map",
    file: "otto/dnd/goal-ship-the-map.md",
    title: "Ship the map",
    status: "open",
    doneWhen: "The map ships.",
    stateText: "",
    currentBrief: "- You wanted: Ship the map.",
    storyText: "",
    documents: [],
    why: [],
    subgoalItems: [],
    subgoals: [],
    depth: 0,
  };
  const doc = { file: "otto/dnd/design-map.md", area: "otto/dnd", kind: "document", title: "Map design", searchText: "map", goalHistory: [] };
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (options.method === "POST") return jsonResponse({ ok: true });
    if (pathname === "/api/sessions") return jsonResponse({ boot: "boot-1", caffeinate: false, sessions: [], pipelines: [] });
    if (pathname === "/api/programs") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    if (pathname === "/api/document") return jsonResponse({ ...doc, text: "# Map design\n\nA long design.\n\n## Part two\n\nMore.", hash: "map-1" });
    if (pathname === "/api/launch/options") {
      return jsonResponse({
        harnesses: [{ id: "claude", label: "Claude", command: "claude", models: [{ id: "fable-5", label: "Fable 5", args: "--model claude-fable-5" }], efforts: [] }],
        default: { harness: "claude", model: "fable-5", effort: null, command: "claude --model claude-fable-5", label: "Claude · Fable 5" },
      });
    }
    return jsonResponse({
      areas: [{ path: "otto", name: "otto", goals: [] }, { path: "otto/dnd", name: "dnd", goals: [goal], documents: [doc] }],
      map: [{ path: "otto/dnd", name: "dnd", goals: [goal] }],
      documents: [doc],
    });
  };
  /** Another agent commits to the vault, then the shell polls. */
  const vaultChangesAndPolls = async () => {
    goal.mtime += 1;
    goal.storyText += "\n### Another agent wrote\n\nSomething.";
    await poll();
    await settle(window);
  };
  window.eval(shellBundle);
  await settle(window);
  assert.ok(poll, "the shell polls the server");

  // Defining a pipeline: the typed instruction and the popover survive a poll, focused or not.
  click(window, `[data-launch-for='${goal.file}']`);
  await settle(window);
  await settle(window);
  const popover = window.document.querySelector("[data-launch-popover]");
  assert.ok(popover, "the popover opened");
  const instruction = window.document.querySelector("#launch-instruction");
  instruction.value = "/design the map";
  instruction.dispatchEvent(new window.Event("input", { bubbles: true }));
  instruction.blur();
  await vaultChangesAndPolls();
  assert.equal(window.document.querySelector("[data-launch-popover]"), popover, "the poll did not rebuild the popover");
  assert.equal(window.document.querySelector("#launch-instruction").value, "/design the map");
  // Julian's own action may repaint, and the typed instruction is still there.
  click(window, "[data-launch-step-add]");
  assert.match(window.document.querySelector("[data-launch-step-select='0']").textContent, /design the map/);
  click(window, "[data-launch-close]");
  await settle(window);
  assert.equal(window.document.querySelector("[data-launch-popover]"), null);
  // With the popover closed, the deferred vault change reaches the desk.
  const deskBefore = window.document.querySelector(`[data-goal-anchor='${goal.file}']`);
  await vaultChangesAndPolls();
  assert.notEqual(window.document.querySelector(`[data-goal-anchor='${goal.file}']`), deskBefore, "the desk repaints once nothing is being edited");

  // Describing work: the form survives a poll while Julian reads elsewhere on the page.
  click(window, "[data-describe-area]");
  const form = window.document.querySelector("[data-describe-work-form]");
  assert.ok(form);
  const description = window.document.querySelector("#describe-work");
  description.value = "The scroll must never jump.";
  description.dispatchEvent(new window.Event("input", { bubbles: true }));
  description.blur();
  await vaultChangesAndPolls();
  assert.equal(window.document.querySelector("[data-describe-work-form]"), form, "the poll did not rebuild the describe form");
  assert.equal(window.document.querySelector("#describe-work").value, "The scroll must never jump.");
  click(window, "[data-cancel-describe]");
  await settle(window);

  // Reading a Document: the reader survives a poll and a forced repaint keeps the reading position.
  await openDocumentViaGoTo(window, doc.title);
  await settle(window);
  const reader = window.document.querySelector(".document-reader-scroll");
  assert.ok(reader, "the Document opened");
  reader.scrollTop = 320;
  reader.dispatchEvent(new window.Event("scroll"));
  await vaultChangesAndPolls();
  assert.equal(window.document.querySelector(".document-reader-scroll"), reader, "the poll did not rebuild the reader");
  click(window, "#menu-refresh");
  await settle(window);
  await settle(window);
  const repainted = window.document.querySelector(".document-reader-scroll");
  assert.notEqual(repainted, reader, "an explicit refresh repaints the reader");
  assert.equal(repainted.scrollTop, 320, "the reading position survives the repaint");
});

test("comments render as red blocks, save through the base-hash path with re-anchoring, and remove with undo", async () => {
  const [html, script, commentsScript, mapCore] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
    readFile(path.join(here, "public", "area-map-core.js"), "utf8"),
    readFile(path.join(here, "public", "document-comments.js"), "utf8"),
  ]);
  await import("./public/document-comments.js");
  const helper = documentComments;
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() { this.dataset.scrolledTo = "1"; };
  const doc = { file: "otto/dnd/design-map.md", area: "otto/dnd", kind: "document", title: "Map design", searchText: "map", goalHistory: [] };
  let text = "# Map design\n\nA long design with {==clear words==}{>>Julian: Say why.<<} here.\n\n## Part two\n\nMore prose.\n";
  let hash = 1;
  const saves = [];
  let conflictOnce = false;
  /** The document as the server would return it: text, hash, and parsed comments. */
  const served = () => ({ ...doc, text, hash: `map-${hash}`, comments: helper.parseComments(text) });
  /** The server's 409 reply, which carries the current Document for re-anchoring. */
  const conflictResponse = () => ({
    ok: false,
    status: 409,
    /** Returns the conflict body. */
    async json() { return { error: "document changed since it was opened", current: served() }; },
  });
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (pathname === "/api/document" && options.method === "POST") {
      const body = JSON.parse(options.body);
      if (conflictOnce) {
        conflictOnce = false;
        text = text.replace("More prose.", "More prose, edited by an agent.");
        hash += 1;
        return conflictResponse();
      }
      if (body.baseHash !== `map-${hash}`) return conflictResponse();
      saves.push(body);
      text = body.text;
      hash += 1;
      return jsonResponse(served());
    }
    if (options.method === "POST") return jsonResponse({ ok: true });
    if (pathname === "/api/sessions") return jsonResponse({ boot: "boot-1", caffeinate: false, sessions: [], pipelines: [] });
    if (pathname === "/api/programs") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    if (pathname === "/api/document") return jsonResponse(served());
    return jsonResponse({
      areas: [{ path: "otto", name: "otto", goals: [] }, { path: "otto/dnd", name: "dnd", goals: [], documents: [doc] }],
      map: [],
      documents: [doc],
    });
  };
  window.eval(shellBundle);
  await settle(window);
  await openDocumentViaGoTo(window, doc.title);
  await settle(window);

  // The existing comment is a red-ruled block under its paragraph, its words are marked, and the toolbar counts it.
  const aside = window.document.querySelector(".document-comment");
  assert.ok(aside, "the comment renders");
  assert.equal(aside.getAttribute("role"), "note");
  assert.match(aside.getAttribute("aria-label"), /Comment from Julian/);
  assert.match(aside.textContent, /Say why\./);
  assert.equal(aside.previousElementSibling.tagName, "P");
  assert.equal(window.document.querySelector(".document-comment-mark").textContent, "clear words");
  assert.doesNotMatch(window.document.querySelector(".document-content").textContent, /\{>>|<<\}|\{==/);
  assert.match(window.document.querySelector(".document-comment-nav").textContent, /1 comment/);
  assert.ok(window.document.querySelector(".document-comment-remove"), "the remove control is always drawn");
  assert.ok(window.document.querySelector("[data-comment-new]"), "the Comment action is visible");

  // Next comment scrolls to and focuses the comment block.
  click(window, "[data-comment-step='1']");
  assert.equal(window.document.querySelector(".document-comment").dataset.scrolledTo, "1");

  // Comment without a selection: the composer opens under the section in view and can switch to the whole Document.
  click(window, ".reader-comment-action");
  await settle(window);
  let composer = window.document.querySelector("[data-comment-composer]");
  assert.ok(composer, "the composer opened");
  assert.equal(window.document.activeElement.id, "comment-text");
  const field = window.document.querySelector("#comment-text");
  field.value = "Overall: shorter.";
  field.dispatchEvent(new window.Event("input", { bubbles: true }));
  click(window, "[data-comment-scope='document']");
  await settle(window);
  composer = window.document.querySelector("[data-comment-composer]");
  assert.equal(window.document.querySelector("#comment-text").value, "Overall: shorter.", "the draft survives the scope switch");
  assert.equal(window.document.querySelector("[data-comment-scope='document']").getAttribute("aria-pressed"), "true");
  // An agent edits the file first: the save gets a 409, re-anchors, and saves again without losing the agent's edit.
  conflictOnce = true;
  submit(window, "[data-comment-composer]");
  await settle(window);
  await settle(window);
  await settle(window);
  assert.equal(saves.length, 1, "one save landed after the conflict");
  assert.match(saves[0].text, /# Map design\n\n\{>>Julian: Overall: shorter\.<<\}\n/);
  assert.match(saves[0].text, /edited by an agent/);
  assert.equal(saves[0].summary, "added a comment");
  assert.equal(window.document.querySelector("[data-comment-composer]"), null, "the composer closed");
  assert.equal(window.document.querySelectorAll(".document-comment").length, 2);
  assert.match(window.document.querySelector("#toast").textContent, /Comment added/);
  assert.ok(window.document.querySelector("#toast .toast-action"), "the toast offers Undo");

  // Escape cancels a fresh composer and keeps nothing.
  click(window, ".reader-comment-action");
  await settle(window);
  assert.ok(window.document.querySelector("[data-comment-composer]"));
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle(window);
  assert.equal(window.document.querySelector("[data-comment-composer]"), null);
  assert.equal(saves.length, 1);

  // Remove goes through the same save with Undo, and Undo puts the words back.
  click(window, "[data-remove-comment='1']");
  await settle(window);
  await settle(window);
  assert.equal(saves.length, 2);
  assert.equal(saves[1].summary, "removed a comment");
  assert.doesNotMatch(saves[1].text, /Say why/);
  assert.match(saves[1].text, /A long design with clear words here\./);
  assert.equal(window.document.querySelectorAll(".document-comment").length, 1);
  click(window, "#toast .toast-action");
  await settle(window);
  await settle(window);
  assert.equal(saves.length, 3);
  assert.match(saves[2].text, /\{==clear words==\}\{>>Julian: Say why\.<<\}/);
  assert.equal(window.document.querySelectorAll(".document-comment").length, 2);
});

test("comments render as red blocks, save through the base-hash path with re-anchoring, and remove with undo", async () => {
  const [html, script, commentsScript, mapCore] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
    readFile(path.join(here, "public", "area-map-core.js"), "utf8"),
    readFile(path.join(here, "public", "document-comments.js"), "utf8"),
  ]);
  await import("./public/document-comments.js");
  const helper = documentComments;
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() { this.dataset.scrolledTo = "1"; };
  const doc = { file: "otto/dnd/design-map.md", area: "otto/dnd", kind: "document", title: "Map design", searchText: "map", goalHistory: [] };
  let text = "# Map design\n\nA long design with {==clear words==}{>>Julian: Say why.<<} here.\n\n## Part two\n\nMore prose.\n";
  let hash = 1;
  const saves = [];
  let conflictOnce = false;
  /** The document as the server would return it: text, hash, and parsed comments. */
  const served = () => ({ ...doc, text, hash: `map-${hash}`, comments: helper.parseComments(text) });
  /** The server's 409 reply, which carries the current Document for re-anchoring. */
  const conflictResponse = () => ({
    ok: false,
    status: 409,
    /** Returns the conflict body. */
    async json() { return { error: "document changed since it was opened", current: served() }; },
  });
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (pathname === "/api/document" && options.method === "POST") {
      const body = JSON.parse(options.body);
      if (conflictOnce) {
        conflictOnce = false;
        text = text.replace("More prose.", "More prose, edited by an agent.");
        hash += 1;
        return conflictResponse();
      }
      if (body.baseHash !== `map-${hash}`) return conflictResponse();
      saves.push(body);
      text = body.text;
      hash += 1;
      return jsonResponse(served());
    }
    if (options.method === "POST") return jsonResponse({ ok: true });
    if (pathname === "/api/sessions") return jsonResponse({ boot: "boot-1", caffeinate: false, sessions: [], pipelines: [] });
    if (pathname === "/api/programs") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    if (pathname === "/api/document") return jsonResponse(served());
    return jsonResponse({
      areas: [{ path: "otto", name: "otto", goals: [] }, { path: "otto/dnd", name: "dnd", goals: [], documents: [doc] }],
      map: [],
      documents: [doc],
    });
  };
  window.eval(shellBundle);
  await settle(window);
  await openDocumentViaGoTo(window, doc.title);
  await settle(window);

  // The existing comment is a red-ruled block under its paragraph, its words are marked, and the toolbar counts it.
  const aside = window.document.querySelector(".document-comment");
  assert.ok(aside, "the comment renders");
  assert.equal(aside.getAttribute("role"), "note");
  assert.match(aside.getAttribute("aria-label"), /Comment from Julian/);
  assert.match(aside.textContent, /Say why\./);
  assert.equal(aside.previousElementSibling.tagName, "P");
  assert.equal(window.document.querySelector(".document-comment-mark").textContent, "clear words");
  assert.doesNotMatch(window.document.querySelector(".document-content").textContent, /\{>>|<<\}|\{==/);
  assert.match(window.document.querySelector(".document-comment-nav").textContent, /1 comment/);
  assert.ok(window.document.querySelector(".document-comment-remove"), "the remove control is always drawn");
  assert.ok(window.document.querySelector("[data-comment-new]"), "the Comment action is visible");

  // Next comment scrolls to and focuses the comment block.
  click(window, "[data-comment-step='1']");
  assert.equal(window.document.querySelector(".document-comment").dataset.scrolledTo, "1");

  // Comment without a selection: the composer opens under the section in view and can switch to the whole Document.
  click(window, ".reader-comment-action");
  await settle(window);
  let composer = window.document.querySelector("[data-comment-composer]");
  assert.ok(composer, "the composer opened");
  assert.equal(window.document.activeElement.id, "comment-text");
  const field = window.document.querySelector("#comment-text");
  field.value = "Overall: shorter.";
  field.dispatchEvent(new window.Event("input", { bubbles: true }));
  click(window, "[data-comment-scope='document']");
  await settle(window);
  composer = window.document.querySelector("[data-comment-composer]");
  assert.equal(window.document.querySelector("#comment-text").value, "Overall: shorter.", "the draft survives the scope switch");
  assert.equal(window.document.querySelector("[data-comment-scope='document']").getAttribute("aria-pressed"), "true");
  // An agent edits the file first: the save gets a 409, re-anchors, and saves again without losing the agent's edit.
  conflictOnce = true;
  submit(window, "[data-comment-composer]");
  await settle(window);
  await settle(window);
  await settle(window);
  assert.equal(saves.length, 1, "one save landed after the conflict");
  assert.match(saves[0].text, /# Map design\n\n\{>>Julian: Overall: shorter\.<<\}\n/);
  assert.match(saves[0].text, /edited by an agent/);
  assert.equal(saves[0].summary, "added a comment");
  assert.equal(window.document.querySelector("[data-comment-composer]"), null, "the composer closed");
  assert.equal(window.document.querySelectorAll(".document-comment").length, 2);
  assert.match(window.document.querySelector("#toast").textContent, /Comment added/);
  assert.ok(window.document.querySelector("#toast .toast-action"), "the toast offers Undo");

  // Escape cancels a fresh composer and keeps nothing.
  click(window, ".reader-comment-action");
  await settle(window);
  assert.ok(window.document.querySelector("[data-comment-composer]"));
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle(window);
  assert.equal(window.document.querySelector("[data-comment-composer]"), null);
  assert.equal(saves.length, 1);

  // Remove goes through the same save with Undo, and Undo puts the words back.
  click(window, "[data-remove-comment='1']");
  await settle(window);
  await settle(window);
  assert.equal(saves.length, 2);
  assert.equal(saves[1].summary, "removed a comment");
  assert.doesNotMatch(saves[1].text, /Say why/);
  assert.match(saves[1].text, /A long design with clear words here\./);
  assert.equal(window.document.querySelectorAll(".document-comment").length, 1);
  click(window, "#toast .toast-action");
  await settle(window);
  await settle(window);
  assert.equal(saves.length, 3);
  assert.match(saves[2].text, /\{==clear words==\}\{>>Julian: Say why\.<<\}/);
  assert.equal(window.document.querySelectorAll(".document-comment").length, 2);
});

test("a sub-Area with open work nests as a section of its ancestor's desk panel, and Goals order needs-you, working, ready by latest change", async () => {
  const [html, script, mapCore, mapView] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
    readFile(path.join(here, "public", "area-map-core.js"), "utf8"),
    readFile(path.join(here, "public", "area-map.js"), "utf8"),
  ]);
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  const DAY = 86_400_000;
  const now = Date.now();
  // Authored (creation) order puts the oldest ready Goal first, the bug design-area-map Decision 2 fixes.
  const readyGoal = {
    mtime: 1, area: "neara/hackathon/embedded-js/storm-response", slug: "old-ready", file: "neara/hackathon/embedded-js/storm-response/goal-old-ready.md",
    title: "Old ready goal", status: "open", doneWhen: "Ready.", changedAt: now - 30 * DAY, waitingOn: "", depth: 0,
  };
  const workingGoal = {
    mtime: 2, area: "neara/hackathon/embedded-js/storm-response", slug: "working-goal", file: "neara/hackathon/embedded-js/storm-response/goal-working.md",
    title: "Working goal", status: "open", doneWhen: "Working.", changedAt: now - 10 * DAY, waitingOn: "", session: "storm--working", depth: 0,
  };
  const needsYouGoal = {
    mtime: 3, area: "neara/hackathon/embedded-js/storm-response", slug: "needs-you", file: "neara/hackathon/embedded-js/storm-response/goal-needs-you.md",
    title: "Needs you goal", status: "open", doneWhen: "Needs you.", changedAt: now - 2 * DAY, waitingOn: "Julian", depth: 0,
  };
  const embeddedGoal = {
    mtime: 4, area: "neara/hackathon/embedded-js", slug: "release-deploy", file: "neara/hackathon/embedded-js/goal-release-deploy.md",
    title: "Release and deploy", status: "open", doneWhen: "Deployed.", changedAt: now - 100 * DAY, waitingOn: "", depth: 0,
  };
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (options.method === "POST") return jsonResponse({ ok: true });
    if (pathname === "/api/sessions") {
      return jsonResponse({ boot: "boot-1", caffeinate: false, pipelines: [], sessions: [{ name: "storm--working", goal: workingGoal.file, state: "working", command: "codex" }] });
    }
    if (pathname === "/api/programs") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    return jsonResponse({
      areas: [
        { path: "neara", name: "neara", goals: [] },
        { path: "neara/hackathon", name: "hackathon", goals: [] },
        { path: "neara/hackathon/embedded-js", name: "embedded-js", goals: [embeddedGoal], documents: [] },
        { path: "neara/hackathon/embedded-js/storm-response", name: "storm-response", goals: [readyGoal, workingGoal, needsYouGoal], documents: [] },
      ],
      map: [
        { path: "neara/hackathon/embedded-js", name: "embedded-js", goals: [embeddedGoal] },
        { path: "neara/hackathon/embedded-js/storm-response", name: "storm-response", goals: [readyGoal, workingGoal, needsYouGoal] },
      ],
      documents: [],
    });
  };
  window.eval(shellBundle);
  await settle(window);

  assert.equal(window.document.querySelectorAll(".area-desk-panel").length, 1, "embedded-js and storm-response fold into one panel");
  const panel = window.document.querySelector(".area-desk-panel");
  assert.match(panel.querySelector(".area-desk-header h2").textContent, /Embedded/);
  assert.match(panel.querySelector(".area-desk-section.goals").textContent, /Release and deploy/);

  const section = panel.querySelector(".desk-subarea");
  assert.ok(section, "storm-response renders as a nested section");
  assert.match(section.querySelector(".desk-subarea-toggle strong").textContent, /Storm Response/);

  const titles = [...section.querySelectorAll(".desk-goal-main strong")].map((node) => node.textContent);
  assert.deepEqual(titles, ["Needs you goal", "Working goal", "Old ready goal"], "needs-you, then working, then ready by latest change, not authored order");
});

test("desk panels order by recent work, not path: working now first, then most recent Goal or vault activity", async () => {
  const [html, script, mapCore, mapView] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
    readFile(path.join(here, "public", "area-map-core.js"), "utf8"),
    readFile(path.join(here, "public", "area-map.js"), "utf8"),
  ]);
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  const DAY = 86_400_000;
  const now = Date.now();
  // Alphabetically these would read Megabranch, Standards, D&D, Tangent; recent work must override that.
  const megabranchGoal = {
    mtime: 1, area: "otto/megabranch", slug: "old-goal", file: "otto/megabranch/goal-old.md",
    title: "Old megabranch goal", status: "open", doneWhen: "Done.", changedAt: now - 60 * DAY, waitingOn: "", depth: 0,
  };
  const standardsGoal = {
    mtime: 2, area: "otto/standards", slug: "old-standards-goal", file: "otto/standards/goal-old.md",
    title: "Old standards goal", status: "open", doneWhen: "Done.", changedAt: now - 45 * DAY, waitingOn: "", depth: 0,
  };
  const dndGoal = {
    mtime: 3, area: "otto/dnd", slug: "working-goal", file: "otto/dnd/goal-working.md",
    title: "D&D goal in progress", status: "open", doneWhen: "Done.", changedAt: now - 1 * DAY, waitingOn: "", session: "dnd--working", depth: 0,
  };
  const tangentGoal = {
    mtime: 4, area: "otto/tangent", slug: "recent-goal", file: "otto/tangent/goal-recent.md",
    title: "Tangent goal recently touched", status: "open", doneWhen: "Done.", changedAt: now - 2 * DAY, waitingOn: "", depth: 0,
  };
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (options.method === "POST") return jsonResponse({ ok: true });
    if (pathname === "/api/sessions") {
      return jsonResponse({ boot: "boot-1", caffeinate: false, pipelines: [], sessions: [{ name: "dnd--working", goal: dndGoal.file, state: "working", command: "codex" }] });
    }
    if (pathname === "/api/programs") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    return jsonResponse({
      areas: [
        { path: "otto", name: "otto", goals: [] },
        { path: "otto/megabranch", name: "megabranch", goals: [megabranchGoal], documents: [] },
        { path: "otto/standards", name: "standards", goals: [standardsGoal], documents: [] },
        { path: "otto/dnd", name: "dnd", goals: [dndGoal], documents: [] },
        { path: "otto/tangent", name: "tangent", goals: [tangentGoal], documents: [] },
      ],
      map: [
        { path: "otto/megabranch", name: "megabranch", goals: [megabranchGoal] },
        { path: "otto/standards", name: "standards", goals: [standardsGoal] },
        { path: "otto/dnd", name: "dnd", goals: [dndGoal] },
        { path: "otto/tangent", name: "tangent", goals: [tangentGoal] },
      ],
      documents: [],
    });
  };
  window.eval(shellBundle);
  await settle(window);

  const headers = [...window.document.querySelectorAll(".area-desk-panel .area-desk-header h2")].map((node) => node.textContent);
  assert.deepEqual(headers, ["D&D", "Tangent", "Standards", "Megabranch"], "the working Area sorts first, then most recent activity, alphabetical path order last");
});

 test("a second comment lands on the words Julian selected, and the reader holds its place", async () => {
  const [html, script, commentsScript, mapCore] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
    readFile(path.join(here, "public", "document-comments.js"), "utf8"),
    readFile(path.join(here, "public", "area-map-core.js"), "utf8"),
  ]);
  await import("./public/document-comments.js");
  const helper = documentComments;
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() { this.dataset.scrolledTo = "1"; };
  // jsdom has no layout, and the floating Comment button reads the selection rectangle.
  window.Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, width: 10, height: 10 });
  const doc = { file: "otto/dnd/design-map.md", area: "otto/dnd", kind: "document", title: "Map design", searchText: "map", goalHistory: [] };
  // Two comments already overlap: `first` on "brown fox", `second` crossing it on "fox jumps".
  let text = "# Map design\n\nThe quick {==brown {==fox==}==}{>>Julian: first<<}{== jumps==}{>>Julian: second<<} over the lazy dog.\n\n## Part two\n\nMore prose.\n";
  let hash = 1;
  const saves = [];
  /** The document as the server would return it: text, hash, and parsed comments. */
  const served = () => ({ ...doc, text, hash: `map-${hash}`, comments: helper.parseComments(text) });
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (pathname === "/api/document" && options.method === "POST") {
      const body = JSON.parse(options.body);
      saves.push(body);
      text = body.text;
      hash += 1;
      return jsonResponse(served());
    }
    if (options.method === "POST") return jsonResponse({ ok: true });
    if (pathname === "/api/sessions") return jsonResponse({ boot: "boot-1", caffeinate: false, sessions: [], pipelines: [] });
    if (pathname === "/api/programs") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    if (pathname === "/api/document") return jsonResponse(served());
    return jsonResponse({
      areas: [{ path: "otto", name: "otto", goals: [] }, { path: "otto/dnd", name: "dnd", goals: [], documents: [doc] }],
      map: [],
      documents: [doc],
    });
  };
  window.eval(shellBundle);
  await settle(window);
  await openDocumentViaGoTo(window, doc.title);
  await settle(window);

  // Both comments render: one mark nests inside the other, and no markup leaks into the words.
  const paragraph = window.document.querySelector(".document-content p");
  assert.equal(paragraph.textContent, "The quick brown fox jumps over the lazy dog.");
  const marks = [...paragraph.querySelectorAll(".document-comment-mark")];
  assert.deepEqual(marks.map((mark) => mark.textContent), ["brown fox", "fox", " jumps"]);
  assert.equal(marks[1].parentElement, marks[0], "the second comment's mark nests inside the first");
  assert.deepEqual(marks.map((mark) => mark.dataset.commentIndex), ["0", "1", "1"]);
  assert.equal(window.document.querySelectorAll(".document-comment").length, 2);

  // Julian has read down the page before he comments.
  window.document.querySelector(".document-reader-scroll").scrollTop = 320;
  window.document.querySelector(".document-reader-scroll").dispatchEvent(new window.Event("scroll"));

  // A third selection next to the overlapping pair lands on exactly those words.
  const tail = paragraph.lastChild;
  const range = window.document.createRange();
  range.setStart(tail, tail.textContent.indexOf("over"));
  range.setEnd(tail, tail.textContent.indexOf("over") + "over the".length);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  click(window, ".reader-comment-action");
  await settle(window);
  const field = window.document.querySelector("#comment-text");
  assert.ok(field, "the composer opened on the selection");
  field.value = "Third";
  field.dispatchEvent(new window.Event("input", { bubbles: true }));
  submit(window, "[data-comment-composer]");
  await settle(window);
  await settle(window);
  assert.equal(saves.length, 1, "the comment saved without a re-anchor");
  assert.match(saves[0].text, /\{==over the==\}\{>>Julian: Third<<\}/);
  assert.equal(window.document.querySelector(".document-content p").textContent, "The quick brown fox jumps over the lazy dog.");
  assert.equal(window.document.querySelectorAll(".document-comment").length, 3);
  await settle(window);
  await settle(window);
  assert.equal(window.document.querySelector(".document-reader-scroll").scrollTop, 320, "the reader keeps its place after the save");
});

test("What happened shows an Area's closed work from the last 12 hours, one overlay at a time, and Esc leaves the desk unchanged", async () => {
  const [html, script, mapCore, mapView, whatHappenedCore] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
    readFile(path.join(here, "public", "area-map-core.js"), "utf8"),
    readFile(path.join(here, "public", "area-map.js"), "utf8"),
    readFile(path.join(here, "public", "what-happened-core.js"), "utf8"),
  ]);
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  const HOUR = 3_600_000;
  const now = Date.now();

  const dndGoal = {
    mtime: 1, area: "otto/dnd", slug: "ship-the-map", file: "otto/dnd/goal-ship-the-map.md", title: "Ship the map", status: "open",
    doneWhen: "Shipped.", stateText: "", currentBrief: "", storyText: "", documents: [], why: [], subgoalItems: [], subgoals: [], depth: 0,
  };
  const tangentGoal = {
    mtime: 1, area: "otto/tangent", slug: "write-docs", file: "otto/tangent/goal-write-docs.md", title: "Write the docs", status: "open",
    doneWhen: "Docs exist.", stateText: "", currentBrief: "", storyText: "", documents: [], why: [], subgoalItems: [], subgoals: [], depth: 0,
  };
  const oldThing = {
    mtime: 1, area: "otto/dnd", slug: "old-thing", file: "otto/dnd/goal-old-thing.md", title: "Old thing", status: "done",
    doneWhen: "It works.", stateText: "", currentBrief: "", storyText: "", documents: [], why: [], subgoalItems: [], subgoals: [], depth: 0,
  };
  const childThing = {
    mtime: 1, area: "otto/dnd/maps", slug: "child-thing", file: "otto/dnd/maps/goal-child-thing.md", title: "Child thing", status: "dropped",
    doneWhen: "", stateText: "### Won't do\n\nToo niche for now.", currentBrief: "", storyText: "", documents: [], why: [], subgoalItems: [], subgoals: [], depth: 0,
  };
  const recentCloses = [
    { file: "otto/dnd/goal-old-thing.md", kind: "done", at: now - 2 * HOUR, session: "tangent-brain-g6" },
    { file: "otto/dnd/maps/goal-child-thing.md", kind: "wontdo", at: now - 3 * HOUR, session: null },
    { file: "otto/dnd/goal-ancient.md", kind: "done", at: now - 13 * HOUR, session: null },
  ];

  const calls = [];
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    calls.push({ pathname, method: options.method ?? "GET" });
    if (options.method === "POST") return jsonResponse({ ok: true });
    if (pathname === "/api/sessions") return jsonResponse({ boot: "boot-1", caffeinate: false, sessions: [] });
    if (pathname === "/api/programs") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    if (pathname === "/api/map-state") return jsonResponse({ area: "otto/dnd", state: null });
    if (pathname === "/api/document") return jsonResponse({ file: oldThing.file, kind: "goal", text: "# Old thing\n", hash: "h1", comments: [] });
    return jsonResponse({
      areas: [
        { path: "otto", name: "otto", goals: [], documents: [], children: ["otto/dnd", "otto/tangent"], parent: "" },
        { path: "otto/dnd", name: "dnd", goals: [dndGoal, oldThing], documents: [], children: ["otto/dnd/maps"], parent: "otto" },
        { path: "otto/dnd/maps", name: "maps", goals: [childThing], documents: [], children: [], parent: "otto/dnd" },
        { path: "otto/tangent", name: "tangent", goals: [tangentGoal], documents: [], children: [], parent: "otto" },
      ],
      map: [
        { path: "otto/dnd", name: "dnd", goals: [dndGoal, oldThing] },
        { path: "otto/dnd/maps", name: "maps", goals: [childThing] },
        { path: "otto/tangent", name: "tangent", goals: [tangentGoal] },
      ],
      documents: [],
      recentCloses,
    });
  };
  window.eval(shellBundle);
  await settle(window);

  const panels = [...window.document.querySelectorAll(".area-desk-panel")];
  const dndPanel = panels.find((node) => node.textContent.includes("Ship the map"));
  const tangentPanel = panels.find((node) => node.textContent.includes("Write the docs"));
  assert.ok(dndPanel, "dnd is a desk panel");
  assert.ok(tangentPanel, "tangent is a desk panel");
  const panelTitles = panels.map((panel) => panel.querySelector("h2").textContent);

  const dndButton = dndPanel.querySelector("[data-what-happened-for]");
  assert.equal(dndButton.textContent.trim(), "What happened", "the action is plain text, no count or badge");
  dndButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);

  let overlay = window.document.querySelector("[data-what-happened]");
  assert.ok(overlay, "the overlay opens");
  let rows = [...overlay.querySelectorAll(".what-happened-row")];
  assert.equal(rows.length, 2, "the 13-hour close is absent");
  const doneRow = rows.find((row) => row.dataset.openClose === "otto/dnd/goal-old-thing.md");
  assert.ok(doneRow);
  assert.match(doneRow.querySelector(".what-happened-kind").textContent, /done/);
  assert.equal(doneRow.querySelector(".what-happened-closer").textContent, "brain g6");
  assert.match(doneRow.querySelector(".what-happened-title").textContent, /^Old thing/);
  const childRow = rows.find((row) => row.dataset.openClose === "otto/dnd/maps/goal-child-thing.md");
  assert.ok(childRow);
  assert.match(childRow.querySelector(".what-happened-kind").textContent, /won.?t do/);
  assert.ok(childRow.querySelector(".what-happened-area"), "the child-Area row carries the dim Area suffix");

  // Escape closes the overlay; the desk under it has not moved.
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle(window);
  assert.equal(window.document.querySelector("[data-what-happened]"), null, "Escape closes the overlay");
  const panelsAfterEscape = [...window.document.querySelectorAll(".area-desk-panel")];
  assert.deepEqual(panelsAfterEscape.map((panel) => panel.querySelector("h2").textContent), panelTitles, "the desk still holds the same panels");

  // A click on another panel's button swaps the overlay to that Area; an empty window says so.
  // (A repaint replaces the desk DOM, so panels and buttons must be re-queried live.)
  /** Finds a panel's What happened button by a title that appears in it. */
  const findWhatHappenedButton = (titleText) => {
    const panel = [...window.document.querySelectorAll(".area-desk-panel")].find((node) => node.textContent.includes(titleText));
    return panel.querySelector("[data-what-happened-for]");
  };
  findWhatHappenedButton("Write the docs").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  overlay = window.document.querySelector("[data-what-happened]");
  assert.ok(overlay, "the tangent overlay opens");
  assert.match(overlay.getAttribute("aria-label"), /Tangent/);
  assert.match(overlay.querySelector(".what-happened-empty").textContent, /Nothing was marked done or won't do/);

  // Reopen dnd's overlay and click its done row: it opens the Goal file in the reader.
  findWhatHappenedButton("Ship the map").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  overlay = window.document.querySelector("[data-what-happened]");
  rows = [...overlay.querySelectorAll(".what-happened-row")];
  rows.find((row) => row.dataset.openClose === "otto/dnd/goal-old-thing.md").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  assert.ok(calls.some((call) => call.pathname === "/api/document"), "the row click fetches the Document");
});
