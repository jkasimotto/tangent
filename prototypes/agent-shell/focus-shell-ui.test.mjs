import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));

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
  const [html, script] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
  ]);
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
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
          { name: "tangent-vision", goal: goalFile, state: tangentSessionState, command: "codex" },
          { name: "stale-completed-run", goal: staleCompletedGoal.file, state: "waiting", command: "codex" },
          ...describeSessions,
          ...(reviewAgentStarted ? [{ name: "live-edit-collaboration", goal: liveEditGoal.file, state: "waiting", phase: "collaborate", command: "codex" }] : []),
        ],
      });
    }
    if (pathname === "/api/programs") {
      return jsonResponse({
        programs: [{ id: "process:otto/dnd:hmr", type: "process", area: "otto/dnd", name: "hmr", label: "HMR", command: "npm run dev:hmr", cwd: "/tmp", sessionName: "process-dnd--hmr-test", session: null, available: true }],
        errors: [],
        areas: [{ path: "otto/dnd", cwd: "/tmp" }],
        liveCount: 0,
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

  window.eval(script);
  await settle(window);

  assert.match(window.document.querySelector("#screen").textContent, /Work by Area/);
  assert.equal(window.document.querySelectorAll(".area-desk-panel").length, 2);
  assert.match(window.document.querySelector(".attention-queue").textContent, /Needs you now/);
  assert.deepEqual(dockBadges, []);
  click(window, "[data-enable-dock-badge]");
  await settle(window);
  assert.deepEqual(dockBadges, [2]);
  assert.equal(window.document.querySelector("[data-enable-dock-badge]"), null);

  window.__agentShellNativeDockBadge = true;
  notificationPermission = "denied";
  dockBadges.length = 0;
  await window.enableDockBadge();
  await settle(window);
  assert.deepEqual(dockBadges, [2]);
  assert.match(window.document.querySelector(".area-desk-panel:nth-child(2)").textContent, /Tangent/);
  assert.match(window.document.querySelector(".area-desk-panel:nth-child(2) .desk-documents").textContent, /Tangent product design/);
  assert.equal(window.document.querySelectorAll(".desk-goal.subgoal").length, 1);
  assert.equal(window.document.querySelector("[data-work-filter='all']").getAttribute("aria-pressed"), "true");
  click(window, "[data-work-filter='active']");
  assert.equal(window.localStorage.getItem("agent-shell.work-filter"), "active");
  assert.equal(window.document.querySelectorAll(".area-desk-panel").length, 1);
  assert.match(window.document.querySelector(".area-desk-panel").textContent, /UX Product Vision/);
  assert.match(window.document.querySelector(".area-desk-panel").textContent, /Waiting for you/);
  assert.equal(window.document.querySelectorAll(".desk-goal.subgoal").length, 1);
  assert.doesNotMatch(window.document.querySelector("#screen").textContent, /Define Live Edit collaboration/);
  click(window, "[data-work-filter='inactive']");
  assert.equal(window.document.querySelectorAll(".area-desk-panel").length, 1);
  assert.match(window.document.querySelector(".area-desk-section.goals h3").textContent, /Inactive work/);
  assert.match(window.document.querySelector(".area-desk-panel").textContent, /Define Live Edit collaboration/);
  assert.doesNotMatch(window.document.querySelector("#screen").textContent, /UX Product Vision/);
  click(window, "[data-work-filter='all']");
  assert.equal(window.document.querySelector("#work-tab").getAttribute("aria-current"), "page");
  assert.equal(window.document.querySelector("#areas-tab").hidden, false);
  // Programs live inside the Area card now: the top bar carries no Programs tab.
  assert.equal(window.document.querySelector("#programs-button"), null);

  click(window, `[data-open-goal-run='${goalFile}']`);
  assert.ok(window.document.querySelector(".agent-page"));
  assert.equal(window.document.querySelector("#back-button").textContent, "Work");
  click(window, "#back-button");
  assert.match(window.document.querySelector("#screen").textContent, /Work by Area/);

  // The Goal row carries the details itself: brief, Documents, and handoff.
  const goalRow = window.document.querySelector(`[data-goal-anchor='${goalFile}']`);
  assert.match(goalRow.textContent, /One calm surface/);
  assert.match(goalRow.querySelector(".desk-goal-docs").textContent, /Tangent product design/);
  assert.match(goalRow.querySelector("[data-stop-goal]").textContent, /End agent/);
  const handoffRow = window.document.querySelector(`[data-goal-anchor='${liveEditGoal.file}']`);
  assert.match(handoffRow.querySelector(".desk-goal-handoff").textContent, /Handoff: Julian/);
  assert.equal(handoffRow.querySelector("[data-stop-goal]"), null);
  assert.equal(window.document.querySelector("[data-view-goal]"), null);

  click(window, `[data-stop-goal='${goalFile}']`);
  assert.match(window.document.querySelector("#modal-title").textContent, /Stop Codex/);
  assert.match(window.document.querySelector("#modal-copy").textContent, /work and its notes stay here/);
  click(window, "[data-modal-confirm]");
  await settle(window);
  assert.ok(posts.some((entry) => entry.path === "/api/kill/tangent-vision"));

  click(window, `[data-goal-anchor='${goalFile}'] [data-open-document]`);
  await settle(window);
  assert.match(window.document.querySelector("#screen").textContent, /Document/);
  assert.match(window.document.querySelector("#screen").textContent, /Native chat stays complete/);

  click(window, "#back-button");
  assert.equal(window.document.querySelector("[data-new-goal]"), null);
  assert.equal(window.document.querySelectorAll(".area-desk-panel").length, 2);
  assert.match(window.document.querySelector("#screen").textContent, /Define Live Edit collaboration/);
  assert.match(window.document.querySelector("#screen").textContent, /Waiting for you/);
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

  click(window, "[data-describe-work]");
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
  assert.equal(window.document.querySelector("[data-describe-work]").textContent.trim(), "Describe work");
  const workDefinition = window.document.querySelector(".desk-definition");
  assert.ok(workDefinition, window.document.querySelector("#screen").textContent);
  assert.match(workDefinition.closest(".area-desk-panel").textContent, /D&D/);
  assert.match(workDefinition.textContent, /Defining work/);
  assert.match(workDefinition.textContent, /Make the scene flow reliable/);
  assert.match(workDefinition.textContent, /Waiting for you/);
  click(window, "[data-select-work-definition='dnd--describe-scene-flow']");
  assert.ok(window.document.querySelector(".agent-page"));
  click(window, "#back-button");
  click(window, "[data-describe-work]");
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
  click(window, "[data-describe-work]");
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
  assert.match(window.document.querySelector("#screen").textContent, /Live Edit use cases/);
  assert.match(window.document.querySelector(".area-goal-brief").textContent, /A clear design for Live Edit collaboration/);
  click(window, `[data-open-document='${liveEditDocument.file}']`);
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
  assert.equal(window.document.querySelector("#back-button").textContent, "Areas");
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
  assert.match(window.document.querySelector("#screen").textContent, /Work by Area/);

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
  const [html, script] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
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

  window.eval(script);
  await settle(window);
  assert.match(window.document.querySelector("#screen").textContent, /Work by Area/);
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
  assert.match(window.document.querySelector("#screen").textContent, /Work by Area/);
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
  const [html, script] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
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

  window.eval(script);
  await settle(window);
  assert.match(window.document.querySelector("#screen").textContent, /Work by Area/);

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
  const [html, script] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
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

  window.eval(script);
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
  assert.match(row.querySelector(".desk-state").textContent, /Step 1 of 2 · Codex · Sol · High · working/);
  assert.equal(row.querySelectorAll(".desk-step").length, 2);
  assert.equal(row.querySelector("[data-check-goal]"), null);
  assert.equal(row.querySelector("[data-pipeline-control]"), null);
  assert.match(row.querySelector("[data-stop-goal]").textContent, /End agent/);

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
  assert.equal(grownRow.querySelectorAll(".desk-step").length, 3);
  assert.match(grownRow.querySelector(".desk-state").textContent, /Step 1 of 3/);

  // The step session dies: the row offers Restart and Skip; Skip advances the line
  // and the latest handover shows under the chips.
  sessions = [];
  pipeline.steps[0].live = false;
  click(window, "#menu-refresh");
  await settle(window);
  await settle(window);
  const stoppedRow = window.document.querySelector(`[data-goal-anchor='${goal.file}']`);
  assert.match(stoppedRow.querySelector(".desk-state").textContent, /Step 1 of 3 · Codex · Sol · High · stopped/);
  assert.equal(stoppedRow.querySelector("[data-stop-goal]"), null);
  assert.ok(stoppedRow.querySelector("[data-pipeline-control='restart']"));
  click(window, `[data-goal-anchor='${goal.file}'] [data-pipeline-control='skip']`);
  await settle(window);
  await settle(window);
  const control = posts.find((entry) => entry.path === "/api/pipelines/control");
  assert.deepEqual(control.body, { goal: goal.file, action: "skip", step: 1 });
  const afterRow = window.document.querySelector(`[data-goal-anchor='${goal.file}']`);
  assert.match(afterRow.querySelector(".desk-handover").textContent, /Step 1: Design written: design-map\.md\./);

  // Step 2 died too. Stop work ends the run: the row settles back to a plain
  // open Goal, no Restart lingers, and the handovers stay visible.
  assert.match(afterRow.querySelector(".desk-state").textContent, /Step 2 of 3 · .* · stopped/);
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
  assert.equal(endedRow.querySelectorAll(".desk-step.ended").length, 2);
  assert.match(endedRow.querySelector(".desk-handover").textContent, /Step 1: Design written/);

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

test("background polls never rebuild the screen under an editing surface or a reader", async () => {
  const [html, script] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
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

  window.eval(script);
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
  click(window, "[data-describe-work]");
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
  click(window, `[data-open-document='${doc.file}']`);
  await settle(window);
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
