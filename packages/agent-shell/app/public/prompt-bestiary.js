/** Reusable message contracts that appear inside lifecycle transitions. */
export const PROMPT_SPECIES = [
  { id: "brain", name: "Brain activation", recipient: "Area brain", trigger: "Activate or recover an Area brain", delivery: "Built, typed, and confirmed", shape: "Founding instruction, current checkpoint, bounded memory, current Documents, Questions, events, command provenance, and mutation fences." },
  { id: "goal", name: "Worker assignment", recipient: "Worker", trigger: "A local caller starts an approved assignment", delivery: "Built, typed, and confirmed", shape: "Done condition, sources, approved context, working directory, and the one send command." },
  { id: "pipeline", name: "Pipeline assignment", recipient: "Worker", trigger: "The brain advances an approved pipeline", delivery: "Built, typed, and confirmed", shape: "Worker assignment, current step, earlier handovers, continuation facts, and exit contract." },
  { id: "brain-notice", name: "Brain notice", recipient: "Controlling Area brain", trigger: "A worker reports, a request is answered, or a Document changes", delivery: "Recorded, queued, typed, and confirmed", shape: "A durable event with its Area, source identity, facts, and time." },
  { id: "brain-request", name: "Brain request", recipient: "Julian", trigger: "The brain needs plan approval, a decision, a test, or explicit approval", delivery: "Durable request record", shape: "Kind, subject, detail, question, named answers, status, and answer." },
  { id: "handover", name: "Worker send", recipient: "Controlling Area brain", trigger: "The worker runs tangent send brain", delivery: "Recorded before delivery", shape: "A note, --done with proof, or --blocked with the real dependency that prevents progress." },
  { id: "context", name: "Context continuation", recipient: "Fresh worker", trigger: "The brain chooses fresh context for the same assignment", delivery: "New prompt confirmed before old session ends", shape: "Original assignment plus every durable continuation handover." },
  { id: "comment", name: "Document comment notice", recipient: "Logical Area inbox", trigger: "Julian presses the Document notification button", delivery: "Durable brain notice", shape: "Document path, open comment count, and the command that reads them." },
];

/** Canonical user concepts. A Subgoal is a Goal relationship. An Ask is a projection. */
export const MODEL_CONCEPTS = [
  concept("area", "Area", "Durable meaning", "A durable subject that contains related Goals, Documents, and Programs.", "Julian", "Created explicitly. It stays until Julian closes it.", ["Goal", "Document", "Program", "Brain"]),
  concept("goal", "Goal", "Durable meaning", "A desired result with a condition for completion.", "Julian or an approved Brain plan", "Open until its completion condition and acceptance rules hold.", ["Area", "Subgoal", "Pipeline", "Run", "Test"]),
  concept("subgoal", "Subgoal", "Durable meaning", "A Goal that contributes to another Goal through a To do that link.", "The parent Goal", "It uses the complete Goal lifecycle.", ["Goal"]),
  concept("document", "Document", "Durable meaning", "Durable knowledge that supports an Area or Goal.", "Its Area", "Comments stay open until their work is complete.", ["Area", "Goal", "Brain"]),
  concept("program", "Program", "Durable meaning", "A repeatable operation attached to an Area.", "Its Area", "Its definition persists when its process stops.", ["Area"]),
  concept("brain", "Brain", "Control", "One logical organizer and inbox for one exact Area. Area identity records provenance; it does not grant command permission.", "One exact Area", "Its lifecycle is active or inactive. Runtime attempts and health remain diagnostic.", ["Area", "Goal", "Queue", "Request"]),
  concept("pipeline", "Goal queue", "Runtime", "The authoritative ordered assignments, attempts, and reports for one Goal.", "Agent Shell", "Workers report. Any local caller can command a valid next transition through the same revision and ownership fences.", ["Goal", "Run", "Brain"]),
  concept("run", "Run", "Runtime", "One agent session that works on a Goal or pipeline step.", "A Goal or pipeline step", "The session can work, wait, stop, or end.", ["Goal", "Pipeline", "Brain"]),
  concept("request", "Request", "Attention", "A durable question from a Brain to Julian.", "The Brain that created it", "It stays open until Julian answers it.", ["Brain", "Test", "Ask"]),
  concept("test", "Test", "Attention", "An observation Question that asks Julian to evaluate visible behavior.", "The exact Area Brain", "Its answer returns to the brain and does not close new queue work.", ["Request", "Goal", "Ask"]),
  concept("ask", "Ask", "Attention", "One actionable row in For you.", "The source request or runtime fact", "An answer, dismissal, or source lifecycle change removes it.", ["Request", "Test", "Run", "View"]),
  concept("view", "View", "Attention", "A projection of durable and runtime facts for one purpose.", "Agent Shell", "Current, Planned, and For you do not change stored object states.", ["Ask", "Goal", "Run"]),
];

/** Builds one canonical user concept. */
function concept(id, name, band, definition, owner, lifecycle, related) { return { id, name, band, definition, owner, lifecycle, related }; }

const TRANSITIONS = {
  work: transition("Brain opening prompt", "Agent Shell", "Area brain", "brain", {
    trigger: "Julian starts or speaks to the brain for an Area.",
    payload: "The exact Area, founding instruction, current checkpoint, bounded memory, selected Documents, Questions, and operating contract.",
    knows: "Agent Shell resolves one logical brain for the exact Area.",
    next: "Agent Shell starts or recovers one runtime attempt.",
    state: "The brain record separates logical lifecycle, health, founding instruction, checkpoint, and attempt diagnostics.",
    delivery: "The prompt is built, typed into the harness composer, and checked before submission.",
    source: "server.mjs: spawnBrainSession types Julian's message; the Area note chain is the instruction",
    layers: ["Identity and command provenance", "Founding instruction", "Current checkpoint", "Bounded Area memory", "Selected Documents and events"],
  }),
  plan: transition("Plan request", "Area brain", "Julian", "brain-request", {
    trigger: "The brain has written the proposed Goals, agents, order, dependencies, and risks.",
    payload: "A short plan request with the answers Approve and I want these changes.",
    knows: "Julian can read the linked plan Document for the full work split.",
    next: "Julian approves the displayed plan version or requests changes.",
    state: "A durable request remains open until Julian answers it.",
    delivery: "The request appears in the same attention surface as every other brain request.",
    source: "brain-requests.mjs: createBrainRequest",
    layers: ["Request kind: plan", "Plan subject", "Goals and agents summary", "Question", "Valid answers"],
  }),
  planAnswer: transition("Plan answer", "Julian", "Area brain", "brain-notice", {
    trigger: "Julian selects Approve or I want these changes.",
    payload: "The named answer and its request identity.",
    knows: "The brain owns the plan Document and proposed work boundary.",
    next: "Approval permits managed Goal creation and launch. A change request returns the brain to planning.",
    state: "The request becomes answered. The answer is appended to the brain inbox.",
    delivery: "The answer is recorded first. The notice waits safely if the brain composer is busy.",
    source: "brain-requests.mjs: answerBrainRequest; brain-inbox.mjs: appendNotice",
    layers: ["Request identity", "Named answer", "Answer time", "Durable notice text"],
  }),
  assignment: transition("Worker assignment", "Area brain", "Worker A", "goal", {
    trigger: "The plan is approved and the brain starts an approved assignment.",
    payload: "The Goal, done condition, sources, step, earlier facts, and worker communication contract.",
    knows: "The brain retains the complete plan. The worker receives only the context for this assignment.",
    next: "The worker performs the assignment and reports through tangent send brain.",
    state: "The Goal and pipeline record identify the running session and step.",
    delivery: "Agent Shell waits for a ready composer, types the prompt, checks its tail, and submits it.",
    source: "server.mjs: goalPrompt and pipelineStepPrompt",
    layers: ["Worker identity and queue contract", "Done condition", "Goal and Area sources", "Current step and prior facts", "One send command"],
  }),
  handover: transition("Worker send", "Worker A", "Area brain", "handover", {
    trigger: "The worker finishes a useful turn or needs the brain to choose what happens next.",
    payload: "A tagged report plus files, commits, checks, results, unresolved facts, and any decision or context need.",
    knows: "Agent Shell adds the worker session, Goal, Area, pipeline step, and event time.",
    next: "Only the brain classifies the report and chooses the next transition.",
    state: "The handover is stored on the assignment. A durable brain notice is appended.",
    delivery: "Recording completes before composer delivery. Delivery is at least once.",
    source: "server.mjs: workerHandover; brain-inbox.mjs",
    layers: ["Worker facts", "Server-owned identity", "Assignment state", "Brain notice"],
  }),
  advance: transition("Advance assignment", "Local caller", "Agent Shell", "pipeline", {
    trigger: "A local caller chooses an approved pending assignment.",
    payload: "The Goal and requested step number through the queue command.",
    knows: "Agent Shell knows the pipeline record, prior handovers, and current step state.",
    next: "Agent Shell builds the next worker prompt and starts Worker B.",
    state: "The selected step changes from pending to starting, then running.",
    delivery: "The command returns an error if the revision is stale, ownership conflicts, or the step cannot start.",
    source: "server.mjs: advanceBrainPipeline",
    layers: ["Actor provenance", "Goal identity", "Requested step", "Revision, ownership, and state checks"],
  }),
  nextAssignment: transition("Next worker assignment", "Agent Shell", "Worker B", "pipeline", {
    trigger: "The brain advances the pipeline after it reads Worker A's report.",
    payload: "The original Goal, Worker B's instruction, and every earlier handover verbatim.",
    knows: "Worker B does not need Worker A's transcript. Durable facts cross the boundary.",
    next: "Worker B performs the next assignment and reports to the brain.",
    state: "The pipeline record binds the active step to Worker B's session.",
    delivery: "The prompt must reach the new composer before the assignment is ready.",
    source: "server.mjs: pipelineStepPrompt and spawnGoalSession",
    layers: ["Worker contract", "Goal context", "Current step", "Earlier handovers", "Exit contract"],
  }),
  decisionRequest: transition("Decision request", "Area brain", "Julian", "brain-request", {
    trigger: "A worker reports a user-facing choice, one-way door, or material scope decision.",
    payload: "The decision, effects, options, recommendation, affected work, and what waits.",
    knows: "Julian can inspect the linked Goal, Document, plan, and originating handover.",
    next: "Julian selects one named option. The answer returns only to the brain.",
    state: "A durable decision request remains open.",
    delivery: "The UI renders the exact valid options from the request record.",
    source: "brain-requests.mjs: createBrainRequest",
    layers: ["Request kind: decision", "Why now", "Options and effects", "Recommendation", "Blocked work"],
  }),
  decisionAnswer: transition("Decision answer", "Julian", "Area brain", "brain-notice", {
    trigger: "Julian selects one decision option.",
    payload: "The exact option value, request identity, and answer time.",
    knows: "The brain knows which worker and Goal wait for the decision.",
    next: "The brain records the decision and commands the appropriate worker.",
    state: "The request becomes answered and a brain notice is appended.",
    delivery: "The UI acknowledges the stored answer before agent delivery finishes.",
    source: "brain-requests.mjs and brain-inbox.mjs",
    layers: ["Request identity", "Selected option", "Answer time", "Brain notice"],
  }),
  testRequest: transition("Test request", "Area brain", "Julian", "brain-request", {
    trigger: "The result needs Julian to verify user-visible behavior.",
    payload: "The visible action, expected result, affected Goal, and the two shared answers.",
    knows: "The brain has rebuilt the visible Agent Shell change when required.",
    next: "Julian tests the result and returns a verdict to the brain.",
    state: "A durable test request remains open.",
    delivery: "The test appears as a direct ask. Idle session state cannot create it by inference.",
    source: "brain-requests.mjs: request kind test",
    layers: ["Request kind: test", "Visible action", "Expected result", "Affected Goal", "Approve or I want these changes"],
  }),
  testAnswer: transition("Test answer", "Julian", "Area brain", "brain-notice", {
    trigger: "Julian selects Approve or I want these changes.",
    payload: "The verdict, optional feedback, request identity, and answer time.",
    knows: "The brain knows the Goal, review state, and work that waits.",
    next: "The answer informs the brain. Only a designated typed review can close routine work.",
    state: "The request becomes answered and the brain receives a durable notice.",
    delivery: "The verdict is durable before the brain composer receives it.",
    source: "brain-requests.mjs and brain-inbox.mjs",
    layers: ["Request identity", "Verdict", "Feedback", "Brain notice"],
  }),
  comment: transition("Document comment notice", "Julian", "Nearest live brain", "comment", {
    trigger: "Julian finishes adding comments and presses Tell brain I added comments.",
    payload: "The Document path, open comment count, and the command that reads the comments.",
    knows: "Saving a comment sends nothing. Agent Shell resolves the closest live brain only when Julian presses the button.",
    next: "The brain answers, edits, or assigns the change to a worker.",
    state: "The comment remains until its work is complete and it is resolved.",
    delivery: "A durable notice survives a busy brain or brain generation handover.",
    source: "document comment routes; brain-inbox.mjs",
    layers: ["Document identity", "Selected text", "Julian's comment", "Area route", "Resolution contract"],
  }),
  close: transition("Close Goal", "Area brain", "Agent Shell", "brain-notice", {
    trigger: "The designated typed review passes every criterion at the current Goal revision.",
    payload: "The Goal identity, revision, criteria, and evidence references.",
    knows: "The queue has the designated review report and current Goal revision.",
    next: "Agent Shell marks the Goal done. The brain starts newly unblocked approved work.",
    state: "The Goal status changes in the vault in the same control loop.",
    delivery: "Closure does not wait for an inferred user acknowledgement.",
    source: "area-goal-queue.v2 typed closure contract",
    layers: ["Goal identity", "Goal revision", "Review criteria", "Evidence references"],
  }),
  stopBrain: transition("Stop Brain session", "Julian", "Agent Shell", "brain", {
    trigger: "Julian stops the Brain agent, or its session ends.", payload: "The Brain session identity.", knows: "Agent Shell owns the Brain record and session state.",
    next: "No Brain agent remains active. Managed attempts can continue.", state: "The Brain record becomes inactive. Its durable records remain.",
    delivery: "Agent Shell ends the tmux session and records the new runtime state.", source: "server.mjs: endBrainForSession", layers: ["Brain identity", "Session state", "Durable Brain record"],
  }),
  retainBrain: transition("Retain Brain records", "Agent Shell", "Durable storage", "brain-notice", {
    trigger: "The Brain session stops.", payload: "The Brain record, plan, inbox, handovers, and open requests.", knows: "These records belong to the Area, not one session.",
    next: "The records wait for an answer or a resumed generation.", state: "No request is answered and no inbox notice is removed.",
    delivery: "No message delivery occurs while the Brain has no live session.", source: "brain-record.mjs; brain-inbox.mjs; brain-requests.mjs", layers: ["Area identity", "Generation history", "Unread notices", "Open requests"],
  }),
  resumeBrain: transition("Resume Brain", "Julian", "Agent Shell", "brain", {
    trigger: "Julian reactivates an inactive Brain.", payload: "The existing Brain record and the resume command.", knows: "Agent Shell reads the founding instruction, current checkpoint, plan, and unread notices.",
    next: "A new Brain generation controls the Area.", state: "The Brain record points to the new live session and generation.",
    delivery: "Agent Shell builds a new opening prompt from the durable records.", source: "server.mjs: spawnBrainSession", layers: ["Prior instruction", "Latest handover", "Unread notices", "New generation identity"],
  }),
};

/** Builds one canonical communication boundary. */
function transition(label, from, to, species, detail) { return { label, from, to, species, ...detail }; }

/** Canonical managed encounters. */
export const LIFECYCLES = [
  lifecycle("plan", "Receive work and approve a plan", "The brain researches and proposes the boundary before any worker starts.", ["Julian", "Agent Shell", "Area brain"], ["work", "plan", "planAnswer"]),
  lifecycle("brain-solo", "One brain and one worker", "One worker performs the assignment. The brain owns every later transition.", ["Julian", "Agent Shell", "Area brain", "Worker A"], ["assignment", "handover", "close"]),
  lifecycle("brain-pipeline", "One brain and a worker sequence", "Workers pass facts through the brain. Only the brain starts the next assignment.", ["Julian", "Agent Shell", "Area brain", "Worker A", "Worker B"], ["assignment", "handover", "advance", "nextAssignment"]),
  lifecycle("decision", "A worker needs a decision", "The worker reports facts. The brain asks Julian and routes the answer back into the work.", ["Julian", "Agent Shell", "Area brain", "Worker A"], ["handover", "decisionRequest", "decisionAnswer", "assignment"]),
  lifecycle("test", "Julian tests the result", "Only the brain creates the test request and interprets the verdict.", ["Julian", "Agent Shell", "Area brain", "Worker A"], ["handover", "testRequest", "testAnswer", "close"]),
  lifecycle("document", "Julian comments on a Document", "The comment goes to the controlling brain, which chooses who handles it.", ["Julian", "Agent Shell", "Area brain", "Worker A"], ["comment", "assignment", "handover"]),
  lifecycle("brain-stop", "A Brain session stops", "The runtime session ends. The durable Brain model remains available for Resume.", ["Julian", "Agent Shell", "Durable storage", "Area brain"], ["stopBrain", "retainBrain", "resumeBrain"]),
];

/** Builds one canonical sequence from its actors and boundary ids. */
function lifecycle(id, name, summary, actors, transitions) { return { id, name, summary, actors, transitions }; }

export const LEGACY_LIFECYCLES = [];

/** Escapes dynamic text for the Bestiary's HTML. */
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }

/** Finds the active brain that controls this exact Area. */
function controllingBrain(area, brains) {
  return brains.find((item) => item.area === String(area ?? "") && item.status === "active") ?? null;
}

/** Renders one explanatory boundary. Prompt text comes only from live server builders. */
function renderTransitionInspector(item, inspector) {
  const rows = [["Why now?", item.trigger], ["From and to", `${item.from} → ${item.to}`], ["What crosses", item.payload], ["Already known", item.knows], ["What happens next", item.next], ["State change", item.state], ["Delivery", item.delivery], ["Code source", item.source]];
  const preview = inspector.loading ? `<div class="prompt-preview"><p>Building the exact current message…</p></div>` : inspector.error ? `<div class="prompt-preview error-card">${escapeHtml(inspector.error)}</div>` : inspector.text ? `<div class="prompt-preview"><div><strong>${escapeHtml(inspector.title)}</strong><button type="button" data-close-prompt-preview>Close exact message</button></div><pre>${escapeHtml(inspector.text)}</pre></div>` : "";
  return `<aside class="transition-inspector" aria-live="polite"><p class="kicker">Selected boundary</p><h2>${escapeHtml(item.label)}</h2><div class="transition-route"><span>${escapeHtml(item.from)}</span><b>→</b><span>${escapeHtml(item.to)}</span></div><p class="boundary-summary">${escapeHtml(item.payload)}</p><details class="boundary-details"><summary>Why and how this boundary works</summary><dl>${rows.map(([name, value]) => `<div><dt>${name}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl><section class="prompt-layers"><h3>Message layers</h3><ol>${item.layers.map((layer) => `<li>${escapeHtml(layer)}</li>`).join("")}</ol></section></details>${preview}</aside>`;
}

/** Returns current examples without changing the canonical definition. */
function conceptExamples(conceptId, { goals, brains, sessions, pipelines, programs, asks }) {
  const openRequests = brains.flatMap((brain) => brain.requests ?? []).filter((request) => request.status === "open");
  const values = conceptId === "area" ? [...new Set([...goals.map((goal) => goal.area), ...brains.map((brain) => brain.area), ...programs.map((program) => program.area)].filter(Boolean))]
    : conceptId === "goal" ? goals.map((goal) => goal.title)
      : conceptId === "subgoal" ? goals.filter((goal) => Number(goal.depth ?? 0) > 0).map((goal) => goal.title)
        : conceptId === "document" ? [...new Set(goals.flatMap((goal) => goal.documents ?? []).map((document) => document.title ?? document.file ?? document))]
          : conceptId === "program" ? programs.map((program) => program.label ?? program.name ?? program.id)
            : conceptId === "brain" ? brains.map((brain) => `${brain.area} · ${brain.live ? "live" : brain.status ?? "recorded"}`)
              : conceptId === "pipeline" ? pipelines.map((pipeline) => pipeline.goalTitle ?? pipeline.goal ?? pipeline.file ?? "Pipeline")
                : conceptId === "run" ? sessions.filter((session) => session.kind !== "brain").map((session) => session.workTitle ?? session.goal ?? session.name)
                  : conceptId === "request" ? openRequests.map((request) => request.subject)
                    : conceptId === "test" ? openRequests.filter((request) => request.kind === "test").map((request) => request.subject)
                      : conceptId === "ask" ? asks.map((ask) => ask.subject)
                        : [];
  return { count: values.length, values: values.filter(Boolean).slice(0, 3) };
}

/** Renders the canonical relationship model and one concept inspector. */
function renderModel({ goals, brains, sessions, pipelines, programs, asks, selection }) {
  const selected = MODEL_CONCEPTS.find((item) => item.id === selection.concept) ?? MODEL_CONCEPTS[0];
  const examples = conceptExamples(selected.id, { goals, brains, sessions, pipelines, programs, asks });
  const bands = ["Durable meaning", "Control", "Runtime", "Attention"];
  return `<div class="model-layout">
    <main class="concept-map" aria-label="Tangent concept map">
      ${bands.map((band) => `<section class="concept-band"><header><span>${escapeHtml(band)}</span></header><div>${MODEL_CONCEPTS.filter((item) => item.band === band).map((item) => `<button type="button" data-model-concept="${item.id}" aria-pressed="${item.id === selected.id}"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.definition)}</small></button>`).join("")}</div></section>`).join("")}
      <p class="concept-map-note">A Subgoal is a Goal relationship. An Ask is a projection from a Request or runtime fact.</p>
    </main>
    <aside class="concept-inspector">
      <p class="kicker">${escapeHtml(selected.band)}</p><h2>${escapeHtml(selected.name)}</h2>
      <dl><div><dt>Definition</dt><dd>${escapeHtml(selected.definition)}</dd></div><div><dt>Purpose</dt><dd>${escapeHtml(conceptPurpose(selected.id))}</dd></div><div><dt>Owner</dt><dd>${escapeHtml(selected.owner)}</dd></div><div><dt>Lifecycle</dt><dd>${escapeHtml(selected.lifecycle)}</dd></div><div><dt>Related</dt><dd>${escapeHtml(selected.related.join(", "))}</dd></div></dl>
      <section class="concept-examples"><p class="kicker">In Tangent now</p><strong>${examples.count} ${escapeHtml(selected.name)}${examples.count === 1 ? "" : "s"}</strong>${examples.values.length ? `<ul>${examples.values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>` : `<p>No current examples.</p>`}</section>
    </aside>
  </div>`;
}

/** Gives one concept its user purpose. */
function conceptPurpose(id) {
  return ({ area: "Keeps one durable subject together.", goal: "States what must become true.", subgoal: "Splits a result without creating a second object type.", document: "Keeps knowledge after one agent session ends.", program: "Makes a repeatable Area operation available.", brain: "Owns planning and the next action for managed work.", pipeline: "Keeps ordered assignments and their handovers.", run: "Performs one assignment.", request: "Keeps a Brain question until Julian answers it.", test: "Makes user acceptance explicit.", ask: "Shows one action that needs Julian.", view: "Selects facts for one user purpose." })[id] ?? "Explains one part of Tangent.";
}

/** Renders a lifecycle field guide and an optional exact live prompt. */
function renderLifecycles({ goals, brains, inspector, selection, messages = false }) {
  const selectedLifecycle = LIFECYCLES.find((item) => item.id === selection.lifecycle) ?? LIFECYCLES[0];
  const transitionId = selectedLifecycle.transitions.includes(selection.transition) ? selection.transition : selectedLifecycle.transitions[0];
  const selectedTransition = TRANSITIONS[transitionId];
  const goalOptions = goals.slice(0, 200).map((goal) => { const brain = controllingBrain(goal.area, brains); return `<option value="${escapeHtml(goal.file)}"${inspector.file === goal.file ? " selected" : ""}>${escapeHtml(goal.title)} · ${escapeHtml(brain ? `Managed by ${brain.area}` : "No Area brain record")}</option>`; }).join("");
  const brainOptions = brains.map((brain) => `<option value="${escapeHtml(brain.area)}"${inspector.area === brain.area ? " selected" : ""}>${escapeHtml(brain.area)} · generation ${brain.generation ?? "?"}</option>`).join("");
  const selectedGoal = goals.find((goal) => goal.file === inspector.file);
  const selectedBrain = selectedGoal ? controllingBrain(selectedGoal.area, brains) : null;
  const liveBadge = selectedGoal ? `<p class="live-compatibility ${selectedBrain ? "managed" : "unmanaged"}"><strong>${selectedBrain ? "Managed work" : "No Area brain record"}</strong>${selectedBrain ? `Organized by brain ${escapeHtml(selectedBrain.area)}.` : "Direct commands remain available. Events wait in the logical Area inbox."}</p>` : "";
  const exactMessages = messages ? `<section class="live-inspector exact-message-inspector"><header><span><strong>Exact messages agents receive</strong><small>Choose a current Brain or Goal. Tangent rebuilds this text with the same server function used when it launches the agent.</small></span></header><div class="live-inspector-body">${liveBadge}<div class="live-prompt-row"><select data-prompt-brain><option value="">Choose a Brain…</option>${brainOptions}</select><button type="button" data-load-brain-prompt>Show brain prompt</button></div><div class="live-prompt-row"><select data-prompt-goal><option value="">Choose a Goal…</option>${goalOptions}</select><button type="button" data-load-goal-prompt="goal">Show worker prompt</button><button type="button" data-load-goal-prompt="pipeline">Show pipeline prompt</button></div></div></section>` : "";
  return `${exactMessages}<div class="bestiary-layout">
      <nav class="lifecycle-index" aria-label="Canonical lifecycles"><div><p class="kicker">Canonical encounters</p><p>The current brain-controlled model.</p></div>${LIFECYCLES.map((item) => `<button type="button" data-bestiary-lifecycle="${item.id}" aria-pressed="${item.id === selectedLifecycle.id}"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.summary)}</small></button>`).join("")}</nav>
      <main class="lifecycle-stage"><header><div><p class="kicker">Canonical lifecycle</p><h2>${escapeHtml(selectedLifecycle.name)}</h2><p>${escapeHtml(selectedLifecycle.summary)}</p></div><span class="model-badge">Brain controlled</span></header><div class="actor-strip" style="--actor-count:${selectedLifecycle.actors.length}">${selectedLifecycle.actors.map((actor) => `<span>${escapeHtml(actor)}</span>`).join("")}</div><ol class="lifecycle-sequence">${selectedLifecycle.transitions.map((id, index) => { const item = TRANSITIONS[id]; return `<li><button type="button" data-bestiary-transition="${id}" aria-pressed="${id === transitionId}"><span class="sequence-number">${index + 1}</span><span class="sequence-route"><small>${escapeHtml(item.from)}</small><b>→</b><small>${escapeHtml(item.to)}</small></span><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.trigger)}</span></button></li>`; }).join("")}</ol></main>
      ${renderTransitionInspector(selectedTransition, inspector)}
    </div>${messages ? `
    <section class="species-index"><header><p class="kicker">Boundary index</p><h2>Find an instruction by type</h2><p>Each entry describes one boundary contract. The lifecycle remains the primary explanation.</p></header><div class="prompt-species-grid">${PROMPT_SPECIES.map((species) => `<article class="prompt-species-card"><p class="kicker">${escapeHtml(species.recipient)}</p><h3>${escapeHtml(species.name)}</h3><dl><dt>Trigger</dt><dd>${escapeHtml(species.trigger)}</dd><dt>Delivery</dt><dd>${escapeHtml(species.delivery)}</dd><dt>Contents</dt><dd>${escapeHtml(species.shape)}</dd></dl></article>`).join("")}</div></section>
    ` : ""}`;
}

/** Renders the Tangent model, its lifecycles, and exact message contracts. */
export function renderPromptBestiary({ goals = [], brains = [], sessions = [], pipelines = [], programs = [], asks = [], inspector = {}, selection = {} } = {}) {
  const mode = ["model", "lifecycles", "messages"].includes(selection.mode) ? selection.mode : "model";
  return `<section class="prompt-bestiary">
    <header class="prompt-bestiary-intro"><p class="kicker">Tangent model</p><h1>Understand the objects, owners, and transitions.</h1><p>The model separates durable meaning, control, runtime activity, and attention.</p><nav class="model-modes" aria-label="Model sections">${[["model", "Model"], ["lifecycles", "Lifecycles"], ["messages", "Messages"]].map(([id, label]) => `<button type="button" data-model-mode="${id}" aria-pressed="${id === mode}">${label}</button>`).join("")}</nav></header>
    ${mode === "model" ? renderModel({ goals, brains, sessions, pipelines, programs, asks, selection }) : renderLifecycles({ goals, brains, inspector, selection, messages: mode === "messages" })}
  </section>`;
}

export default { LEGACY_LIFECYCLES, LIFECYCLES, MODEL_CONCEPTS, PROMPT_SPECIES, renderPromptBestiary };
