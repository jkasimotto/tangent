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
  const describeSessions = [];
  const reviewedSteps = [
    "Create the design",
    "Review the design",
    "Respond and plan",
    "Review the implementation plan",
    "Respond to the plan review",
    "Implement",
    "Review the implementation",
    "Respond and fix",
  ].map((label, index) => ({
    id: `step-${index + 1}`,
    order: index + 1,
    label,
    instruction: `Do step ${index + 1}.`,
    status: "pending",
    defaultBinding: index % 2 ? "codex" : "claude",
    binding: index % 2
      ? { id: "codex-max", label: "Codex Max", provider: "codex", command: "codex", effort: "max" }
      : { id: "claude-fable", label: "Claude Fable", provider: "claude", command: "claude", model: "fable" },
    session: { mode: "fresh" },
    attempts: [],
  }));
  const reviewedProgram = {
    id: "reviewed-build",
    description: "Design, review, implement, review, and finish.",
    steps: reviewedSteps,
    bindings: Object.fromEntries(reviewedSteps.map((step) => [step.id, step.binding])),
    sessions: Object.fromEntries(reviewedSteps.map((step) => [step.id, step.session])),
  };
  const reviewedRuns = [];

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
      if (pathname === "/api/reviewed-build/runs") {
        const run = {
          id: "reviewed-run-1",
          status: "queued",
          goalPath: body.goalPath,
          goalTitle: goal.title,
          areaPath: goal.area,
          steps: structuredClone(reviewedSteps),
          decisions: [],
        };
        reviewedRuns.unshift(run);
        return jsonResponse({ run });
      }
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
    if (pathname === "/api/sessions") {
      return jsonResponse({
        caffeinate: false,
        sessions: [
          { name: "tangent-vision", goal: goalFile, state: "waiting", command: "codex" },
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
    if (pathname === "/api/reviewed-build/runs") return jsonResponse({ runs: reviewedRuns });
    if (pathname === "/api/reviewed-build/program") return jsonResponse(reviewedProgram);
    if (pathname === "/api/reviewed-build/runs/reviewed-run-1") return jsonResponse({ run: reviewedRuns[0], latestOutput: "" });
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
  reviewedRuns.push({
    id: "reviewed-run-needs-you",
    status: "needs_attention",
    areaPath: "otto/dnd",
    goalPath: "otto/dnd/goal-review-build.md",
    goalTitle: "Review the build",
  });
  await window.refresh();
  await settle(window);
  assert.deepEqual(dockBadges, [2, 3]);
  reviewedRuns.pop();
  await window.refresh();
  await settle(window);
  assert.deepEqual(dockBadges, [2, 3, 2]);

  window.__agentShellNativeDockBadge = true;
  notificationPermission = "denied";
  dockBadges.length = 0;
  await window.enableDockBadge();
  await settle(window);
  assert.deepEqual(dockBadges, [2]);
  assert.match(window.document.querySelector(".area-desk-panel:nth-child(2)").textContent, /Tangent/);
  assert.match(window.document.querySelector(".area-desk-panel:nth-child(2) .desk-documents").textContent, /Tangent product design/);
  assert.equal(window.document.querySelectorAll(".desk-goal.subgoal").length, 1);
  assert.equal(window.document.querySelector("#work-tab").getAttribute("aria-current"), "page");
  assert.equal(window.document.querySelector("#areas-tab").hidden, false);
  assert.equal(window.document.querySelector("#programs-button").hidden, false);

  click(window, `[data-open-goal-run='${goalFile}']`);
  assert.ok(window.document.querySelector(".agent-page"));
  assert.equal(window.document.querySelector("#back-button").textContent, "Work");
  click(window, "#back-button");
  assert.match(window.document.querySelector("#screen").textContent, /Work by Area/);

  click(window, `[data-view-goal='${goalFile}']`);
  assert.match(window.document.querySelector("#screen").textContent, /Goal details/);
  assert.match(window.document.querySelector("#screen").textContent, /Current brief/);
  assert.equal(window.document.querySelector(".goal-history").open, false);
  assert.match(window.document.querySelector("#screen").textContent, /Tangent product design/);
  assert.doesNotMatch(window.document.querySelector("#screen").textContent, /Review execution plan|Read what will happen/);
  assert.match(window.document.querySelector("[data-start-reviewed]").textContent, /Run reviewed build/);
  click(window, "[data-start-reviewed]");
  await settle(window);
  assert.equal(window.document.querySelectorAll(".reviewed-run-step").length, 8);
  assert.match(window.document.querySelector("#screen").textContent, /0 of 8 steps complete/);
  assert.ok(posts.some((entry) => entry.path === "/api/reviewed-build/runs" && entry.body.goalPath === goalFile));
  click(window, "#back-button");

  click(window, "[data-open-document]");
  await settle(window);
  assert.match(window.document.querySelector("#screen").textContent, /Document/);
  assert.match(window.document.querySelector("#screen").textContent, /Native chat stays complete/);

  click(window, "#back-button");
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
  click(window, "#programs-button");
  assert.match(window.document.querySelector("#screen").textContent, /Things that run/);
  assert.match(window.document.querySelector(".reviewed-program-card").textContent, /Reviewed build/);
  assert.equal(window.document.querySelector("#programs-button").getAttribute("aria-current"), "page");
  assert.equal(window.document.querySelector("#work-tab").hidden, false);
  assert.equal(window.document.querySelector("#areas-tab").hidden, false);
  click(window, "[data-open-reviewed-program]");
  await settle(window);
  assert.equal(window.document.querySelectorAll(".reviewed-editor-step").length, 8);
  assert.match(window.document.querySelector("#screen").textContent, /Fresh session/);
  click(window, "#back-button");
  click(window, "[data-toggle-area='otto/dnd']");
  click(window, "[data-select-program]");
  assert.match(window.document.querySelector("#screen").textContent, /npm run dev:hmr/);
  assert.match(window.document.querySelector("#screen").textContent, /Start/);

  click(window, "#work-tab");
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
