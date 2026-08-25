import test from "node:test";
import { assert, readFile, path, JSDOM, documentComments, areaMapView, shellBundle, here, goToCore, goalCardCore, askCore, settle, click, submit, openDocumentViaGoTo, jsonResponse } from "./focus-shell-ui-fixture.mjs";

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
  const brainRequests = [{ id: "request-1", kind: "decision", subject: "Audit scope", question: "Approve the proposed audit scope?", proposal: "Audit Agent Shell and Usage UI.", detail: "The full proposal can be several paragraphs.\nIt belongs on the opened Request surface.", status: "open" }];
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
          ? [{ area: liveEditGoal.area, session: "live-edit-brain", status: brainLive ? "running" : "stopped", live: brainLive, generation: 1, state: brainLive ? "waiting" : null, stateDetail: brainLive ? "decision" : null, stateQuestion: "Do you want the audit to start now?", forJulian: brainRowsForJulian, requests: brainRequests }]
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
  assert.equal(window.document.querySelectorAll(".work-table tbody").length, 2);
  assert.match(window.document.querySelector(".attention-queue h2").textContent, /For you/, "the surface is named For you");
  const fallbackRows = [...window.document.querySelectorAll(".ask-table .ask-row")];
  assert.equal(fallbackRows.length, 2, "with no brain, only the two Areas that ask something row");
  assert.equal(window.document.querySelector(".ask-group:not(.fallback)"), null, "no brain, no brain group");
  assert.equal(window.document.querySelectorAll(".ask-table").length, 1, "one question table, above the work table");
  for (const row of fallbackRows) {
    assert.ok(row.querySelector(".ask-question"), "every row states the interaction it asks for");
    assert.match(row.querySelector(".ask-question").textContent, /\?$/);
  }
  const questions = fallbackRows.map((row) => row.querySelector(".ask-question").textContent);
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
  const group = window.document.querySelector(".ask-table .ask-group:not(.fallback)");
  assert.ok(group, "the brain's Area gets its own row group");
  assert.doesNotMatch(group.textContent, /Reply to brain/, "the group has no second answer lane");
  const rows = [...group.querySelectorAll(".ask-row")];
  assert.equal(rows.length, 1, "only the durable Request appears");
  assert.equal(rows[0].querySelector(".ask-question").textContent, "Approve the proposed audit scope?");
  assert.deepEqual([...rows[0].querySelectorAll("[data-verdict]")].map((button) => button.textContent), ["Approve", "I want these changes"]);
  assert.ok(rows[0].querySelector("[data-open-request-id]"), "Open enters the full Request surface");
  assert.doesNotMatch(rows[0].textContent, /opened Request surface/, "the compact row does not contain full detail");

  click(window, "[data-verdict='changes']");
  const changesInput = window.document.querySelector("[data-modal-input]");
  changesInput.value = "Use one copy-paste command.";
  assert.match(window.document.querySelector("[data-modal-confirm]").textContent, /Send changes.*⌘↵/, "the send action shows its shortcut");
  changesInput.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
  await settle(window);
  assert.deepEqual(posts.at(-1), { path: "/api/brains/requests/answer", body: { area: liveEditGoal.area, id: "request-1", answer: "changes", note: "Use one copy-paste command." } });

  assert.equal(window.forYouItems().length, 2, "the durable Request plus the one fallback ask left");
  assert.equal(window.document.querySelector(".attention-queue > header > span").textContent, "2", "the card's number is that one list");
  const brainGoalCard = window.document.querySelector(`[data-goal-anchor="${liveEditGoal.file}"]`);
  assert.ok(brainGoalCard, "the brain's Area still shows its Goal");
  assert.equal(brainGoalCard.classList.contains("waiting"), false, "a brain-run Goal keeps no amber");
  assert.match(brainGoalCard.className, /\bready\b/, "with no agent on it, the Goal is simply ready");

  // The same rows, with the same actions, sit right on the Area's own panel:
  // Julian decides there without the desk-wide card
  // (goal-decisions-show-on-the-area-view-not-just-a-count).
  const areaGroup = window.document.querySelector(`.work-table tbody[data-work-group="${liveEditGoal.area}"]`);
  assert.ok(areaGroup, "the Live Edit Area has its own row group");
  const askTable = window.document.querySelector(".ask-table");
  assert.equal(window.document.querySelectorAll(".work-table .ask-row").length, 0, "no question repeats inside the work table");
  assert.ok(askTable.compareDocumentPosition(window.document.querySelector(".work-table")) & window.Node.DOCUMENT_POSITION_FOLLOWING,
    "the one question table sits above the work table");
  assert.equal(window.document.querySelectorAll(`.ask-table .ask-row[data-ask-id^="request:"]`).length, 1, "the durable Request rows once");

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
  assert.equal(dockBadges.at(-1), 2, "the Dock badge counts the Request too");

  // Stopping a brain removes its asks. Resume remains on the Area card; a dead
  // brain cannot keep asking Julian for an answer.
  brainLive = false;
  await window.refresh();
  await settle(window);
  const stoppedGroup = window.document.querySelector(".ask-table .ask-group.stopped");
  assert.ok(stoppedGroup, "a durable Request remains visible while its brain is stopped");
  brainLive = true;

  liveEditBrainStarted = false;
  await window.refresh();
  await settle(window);
  const tangentRoot = window.document.querySelector('[data-work-group="otto/tangent"]');
  const tangentBrainAction = tangentRoot.querySelector('[data-open-area-brain="otto/tangent"]');
  assert.equal(tangentBrainAction.querySelector(".work-group-brain-long").textContent, "Start brain", "a group header can start its exact Area brain");
  assert.equal(tangentBrainAction.getAttribute("aria-label"), "Start brain for Otto / Tangent");

  window.__agentShellNativeDockBadge = true;
  notificationPermission = "denied";
  dockBadges.length = 0;
  await window.enableDockBadge();
  await settle(window);
  assert.deepEqual(dockBadges, [2]);
  assert.match(window.document.querySelectorAll(".work-table tbody")[1].textContent, /Tangent/);
  assert.equal(window.document.querySelector(".area-desk-section.documents"), null, "the Documents section left the work tab");
  assert.equal(window.document.querySelectorAll(".desk-goal.subgoal").length, 1);
  assert.equal(window.document.querySelector("[data-work-filter='active']").getAttribute("aria-pressed"), "true");
  click(window, "[data-work-filter='active']");
  assert.equal(window.localStorage.getItem("agent-shell.work-filter"), "active");
  assert.equal(window.document.querySelectorAll(".work-table tbody").length, 2, "Current includes live work and reviewed work awaiting acceptance");
  assert.match(window.document.querySelector("#screen").textContent, /UX Product Vision/);
  assert.match(window.document.querySelector("#screen").textContent, /Waiting/, "the pill is one word now; the duration is on the facts line");
  assert.equal(window.document.querySelectorAll(".desk-goal.subgoal").length, 1);
  assert.match(window.document.querySelector("#screen").textContent, /Define Live Edit collaboration/, "Current keeps reviewed work that awaits acceptance");
  click(window, "[data-work-filter='inactive']");
  assert.equal(window.document.querySelectorAll(".work-table tbody").length, 0);
  assert.match(window.document.querySelector("#screen").textContent, /No unstarted Goals/);
  assert.doesNotMatch(window.document.querySelector("#screen").textContent, /UX Product Vision/);
  click(window, "[data-work-filter='active']");
  // The Area square on the desk carries the Area's Programs beside its Goals and Documents.
  const deskProgram = window.document.querySelector('.work-programs [data-program-area="otto/tangent"] .desk-program');
  assert.match(deskProgram.textContent, /Agent Shell/);
  assert.match(deskProgram.textContent, /Running/);
  assert.ok(deskProgram.classList.contains("live"));
  click(window, "[data-program-action='stop'][data-program-id='process:otto/tangent:shell']");
  assert.match(window.document.querySelector("#modal-title").textContent, /Stop Agent Shell/);
  click(window, "[data-modal-confirm]");
  await settle(window);
  assert.ok(posts.some((entry) => entry.path === "/api/programs/control" && entry.body.id === "process:otto/tangent:shell" && entry.body.action === "stop"));
  assert.equal(window.document.querySelector("#work-tab").getAttribute("aria-current"), "page");
  assert.equal(window.document.querySelector("#areas-tab").hidden, true);
  // Programs live inside the Area card now: the top bar carries no Programs tab.
  assert.equal(window.document.querySelector("#programs-button"), null);

  click(window, `[data-open-goal-run='${goalFile}']`);
  assert.ok(window.document.querySelector(".agent-page"));
  assert.equal(window.document.querySelector("#back-button").textContent, "Work");
  click(window, "#back-button");
  assert.ok(window.document.querySelector(".work-page"), "the desk shows the Work page");

  // The Goal row carries only decision-relevant facts and one action menu.
  const goalRow = window.document.querySelector(`[data-goal-anchor='${goalFile}']`);
  assert.doesNotMatch(goalRow.textContent, /One calm surface/, "the done condition left the card");
  assert.equal(goalRow.querySelector(".desk-docs-chip"), null, "the Docs chip left the card");
  assert.match(goalRow.querySelector("[data-stop-goal]").textContent, /^End work$/);
  const handoffRow = window.document.querySelector(`[data-goal-anchor='${liveEditGoal.file}']`);
  assert.equal(handoffRow.querySelector(".desk-goal-handoff"), null, "the handoff line left the card");
  assert.match(handoffRow.querySelector(".desk-state").textContent, /Waiting/, "the state pill says the Goal waits for Julian; the duration moved off the card");
  assert.equal(handoffRow.querySelector("[data-stop-goal]"), null);
  assert.equal(handoffRow.querySelector("[data-stop-goal]"), null, "invalid actions are omitted instead of disabled");
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
  assert.equal(window.document.querySelectorAll(".work-table tbody").length, 2);
  assert.match(window.document.querySelector("#screen").textContent, /Define Live Edit collaboration/);
  assert.match(window.document.querySelector("#screen").textContent, /Waiting/, "the desk still says a Goal waits for Julian");
  assert.doesNotMatch(window.document.querySelector("#screen").textContent, /Already complete/);
  assert.match(window.document.querySelector("[data-toggle-subgoals]").getAttribute("aria-label"), /Hide 1 Subgoal of/);

  const search = window.document.querySelector("#work-search");
  search.value = "tangent";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(window.document.querySelectorAll(".work-table tbody").length, 1, "typing filters the existing work table");
  assert.match(window.document.querySelector(".work-table tbody").textContent, /Tangent/);
  assert.equal(window.document.querySelector(".document-result"), null, "work filtering never switches to Document results");
  assert.ok(window.document.querySelector(".work-filter"), "Current and Planned remain visible while filtering");
  const joinedAreaSearch = window.document.querySelector("#work-search");
  joinedAreaSearch.value = "liveedit";
  joinedAreaSearch.dispatchEvent(new window.Event("input", { bubbles: true }));
  const matchingAreaPanel = window.document.querySelector(".work-table tbody");
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
  assert.match(workDefinition.closest("tbody").textContent, /D&D/);
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
  assert.match(programSection.textContent, /Programs/);
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
  assert.equal(window.document.querySelector("#areas-tab").hidden, true);
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
