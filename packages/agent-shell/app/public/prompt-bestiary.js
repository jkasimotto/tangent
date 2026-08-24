/** Reusable message contracts that appear inside lifecycle transitions. */
export const PROMPT_SPECIES = [
  { id: "brain", name: "Brain generation", recipient: "Area brain", trigger: "Start or replace an Area brain", delivery: "Built, typed, and confirmed", shape: "Area instruction, sources, plan, unread notices, authority, request rules, and handover rules." },
  { id: "goal", name: "Worker assignment", recipient: "Worker", trigger: "The brain starts an approved assignment", delivery: "Built, typed, and confirmed", shape: "Done condition, sources, approved context, brain authority, and one handover route." },
  { id: "pipeline", name: "Pipeline assignment", recipient: "Worker", trigger: "The brain advances an approved pipeline", delivery: "Built, typed, and confirmed", shape: "Worker assignment, current step, earlier handovers, continuation facts, and exit contract." },
  { id: "brain-notice", name: "Brain notice", recipient: "Controlling Area brain", trigger: "A worker reports, a request is answered, or a Document changes", delivery: "Recorded, queued, typed, and confirmed", shape: "A durable event with its Area, source identity, facts, and time." },
  { id: "brain-request", name: "Brain request", recipient: "Julian", trigger: "The brain needs plan approval, a decision, a test, or explicit approval", delivery: "Durable request record", shape: "Kind, subject, detail, question, named answers, status, and answer." },
  { id: "handover", name: "Worker handover", recipient: "Controlling Area brain", trigger: "The worker runs tangent handover", delivery: "Recorded before delivery", shape: "Files, commits, checks, completion facts, unresolved facts, and any decision or test need." },
  { id: "context", name: "Context continuation", recipient: "Fresh worker", trigger: "The brain chooses fresh context for the same assignment", delivery: "New prompt confirmed before old session ends", shape: "Original assignment plus every durable continuation handover." },
  { id: "comment", name: "Document comment notice", recipient: "Nearest live Area brain", trigger: "Julian presses the Document notification button", delivery: "Durable brain notice", shape: "Document path, open comment count, and the command that reads them." },
];

/** Canonical user concepts. A Subgoal is a Goal relationship. An Ask is a projection. */
export const MODEL_CONCEPTS = [
  concept("area", "Area", "Durable meaning", "A durable subject that contains related Goals, Documents, and Programs.", "Julian", "Created explicitly. It stays until Julian closes it.", ["Goal", "Document", "Program", "Brain"]),
  concept("goal", "Goal", "Durable meaning", "A desired result with a condition for completion.", "Julian or an approved Brain plan", "Open until its completion condition and acceptance rules hold.", ["Area", "Subgoal", "Pipeline", "Run", "Test"]),
  concept("subgoal", "Subgoal", "Durable meaning", "A Goal that contributes to another Goal through a To do that link.", "The parent Goal", "It uses the complete Goal lifecycle.", ["Goal"]),
  concept("document", "Document", "Durable meaning", "Durable knowledge that supports an Area or Goal.", "Its Area", "Comments stay open until their work is complete.", ["Area", "Goal", "Brain"]),
  concept("program", "Program", "Durable meaning", "A repeatable operation attached to an Area.", "Its Area", "Its definition persists when its process stops.", ["Area"]),
  concept("brain", "Brain", "Control", "The controller that plans and directs managed work for an Area tree.", "One Area tree", "Its record survives stopped sessions and new generations.", ["Area", "Goal", "Pipeline", "Request"]),
  concept("pipeline", "Pipeline", "Runtime", "An ordered set of assignments for one Goal.", "The controlling Brain", "Steps move from pending to running, then complete or stopped.", ["Goal", "Run", "Brain"]),
  concept("run", "Run", "Runtime", "One agent session that works on a Goal or pipeline step.", "A Goal or pipeline step", "The session can work, wait, stop, or end.", ["Goal", "Pipeline", "Brain"]),
  concept("request", "Request", "Attention", "A durable question from a Brain to Julian.", "The Brain that created it", "It stays open until Julian answers it.", ["Brain", "Test", "Ask"]),
  concept("test", "Test", "Attention", "A Request that asks Julian to evaluate a reviewed result.", "The Brain that reviewed the Goal", "Pass can close the Goal. Needs work returns it to the Brain.", ["Request", "Goal", "Ask"]),
  concept("ask", "Ask", "Attention", "One actionable row in For you.", "The source request or runtime fact", "It disappears when its source no longer needs an answer.", ["Request", "Test", "Run", "View"]),
  concept("view", "View", "Attention", "A projection of durable and runtime facts for one purpose.", "Agent Shell", "Current, Planned, and For you do not change stored object states.", ["Ask", "Goal", "Run"]),
];

/** Builds one canonical user concept. */
function concept(id, name, band, definition, owner, lifecycle, related) { return { id, name, band, definition, owner, lifecycle, related }; }

const TRANSITIONS = {
  work: transition("Brain opening prompt", "Agent Shell", "Area brain", "brain", {
    trigger: "Julian starts or speaks to the brain for an Area.",
    payload: "The brain role, Area, Julian's instruction, sources, prior facts, and operating contract.",
    knows: "Agent Shell knows the Area tree and finds the one controlling ancestor brain.",
    next: "Agent Shell starts a brain generation or delivers the instruction to the live brain.",
    state: "The brain record identifies the Area, instruction, generation, and session.",
    delivery: "The prompt is built, typed into the harness composer, and checked before submission.",
    source: "server.mjs: brainPrompt and spawnBrainSession",
    layers: ["Identity and Area authority", "Julian's instruction", "Area sources", "Prior generation facts", "Operating and exit contract"],
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
    next: "The worker performs the assignment and reports through tangent handover.",
    state: "The Goal and pipeline record identify the running session and step.",
    delivery: "Agent Shell waits for a ready composer, types the prompt, checks its tail, and submits it.",
    source: "server.mjs: goalPrompt and pipelineStepPrompt",
    layers: ["Worker identity and brain authority", "Done condition", "Goal and Area sources", "Current step and prior facts", "One handover contract"],
  }),
  handover: transition("Worker handover", "Worker A", "Area brain", "handover", {
    trigger: "The worker finishes a useful turn or needs the brain to choose what happens next.",
    payload: "Files, commits, checks, results, completion facts, unresolved facts, and any decision, test, or context need.",
    knows: "Agent Shell adds the worker session, Goal, Area, pipeline step, and event time.",
    next: "Only the brain classifies the report and chooses the next transition.",
    state: "The handover is stored on the assignment. A durable brain notice is appended.",
    delivery: "Recording completes before composer delivery. Delivery is at least once.",
    source: "server.mjs: workerHandover; brain-inbox.mjs",
    layers: ["Worker facts", "Server-owned identity", "Assignment state", "Brain notice"],
  }),
  advance: transition("Advance assignment", "Area brain", "Agent Shell", "pipeline", {
    trigger: "The brain reads the handover and chooses an approved pending assignment.",
    payload: "The Goal and requested step number through tangent brain advance.",
    knows: "Agent Shell knows the pipeline record, prior handovers, and current step state.",
    next: "Agent Shell builds the next worker prompt and starts Worker B.",
    state: "The selected step changes from pending to starting, then running.",
    delivery: "The command returns an error if the brain lacks authority or the step cannot start.",
    source: "server.mjs: advanceBrainPipeline",
    layers: ["Brain identity", "Goal identity", "Requested step", "Authority and state checks"],
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
    next: "Pass can allow closure. Needs work causes a correction assignment.",
    state: "The request becomes answered and the brain receives a durable notice.",
    delivery: "The verdict is durable before the brain composer receives it.",
    source: "brain-requests.mjs and brain-inbox.mjs",
    layers: ["Request identity", "Verdict", "Feedback", "Brain notice"],
  }),
  contextRisk: transition("Context risk", "Agent Shell", "Worker A", "context", {
    trigger: "Observed worker context crosses the configured threshold.",
    payload: "A reminder to pause and report complete continuation facts.",
    knows: "Agent Shell reads context fill from the harness pane when available.",
    next: "The worker hands over facts. The brain chooses whether fresh context continues.",
    state: "The reminder level is recorded so it does not repeat without cause.",
    delivery: "The reminder waits for an empty composer. Unsupported harnesses remain inert.",
    source: "context-handover.mjs; server.mjs: reconcileContextHandovers",
    layers: ["Observed fill", "Threshold", "Required facts", "Handover command"],
  }),
  continueWorker: transition("Fresh worker", "Area brain", "Worker B", "context", {
    trigger: "The brain decides that the same assignment needs a fresh worker.",
    payload: "The original assignment plus every durable continuation fact in order.",
    knows: "Worker B does not receive the old transcript.",
    next: "Worker B continues the same assignment and uses the normal handover.",
    state: "The record points to Worker B. Worker A ends after prompt confirmation.",
    delivery: "Facts are written before spawn. Failure restores Worker A when possible.",
    source: "context-handover.mjs; server.mjs: continueWorkerSession",
    layers: ["Original assignment", "Continuation history", "Current worker identity", "Normal exit contract"],
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
    trigger: "The done condition holds and the required review and test have passed.",
    payload: "The Goal identity and completion verdict.",
    knows: "The brain has the final worker report, checks, review, and test answer.",
    next: "Agent Shell marks the Goal done. The brain starts newly unblocked approved work.",
    state: "The Goal status changes in the vault in the same control loop.",
    delivery: "Closure does not wait for an inferred user acknowledgement.",
    source: "tangent goal done; brainPrompt closure contract",
    layers: ["Goal identity", "Done-condition proof", "Review verdict", "Test verdict when required"],
  }),
  stopBrain: transition("Stop Brain session", "Julian", "Agent Shell", "brain", {
    trigger: "Julian stops the Brain agent, or its session ends.", payload: "The Brain session identity.", knows: "Agent Shell owns the Brain record and session state.",
    next: "No Brain agent remains active. Managed Runs can continue.", state: "The Brain record becomes stopped or ended. Its durable records remain.",
    delivery: "Agent Shell ends the tmux session and records the new runtime state.", source: "server.mjs: endBrainForSession", layers: ["Brain identity", "Session state", "Durable Brain record"],
  }),
  retainBrain: transition("Retain Brain records", "Agent Shell", "Durable storage", "brain-notice", {
    trigger: "The Brain session stops.", payload: "The Brain record, plan, inbox, handovers, and open requests.", knows: "These records belong to the Area, not one session.",
    next: "The records wait for an answer or a resumed generation.", state: "No request is answered and no inbox notice is removed.",
    delivery: "No message delivery occurs while the Brain has no live session.", source: "brain-record.mjs; brain-inbox.mjs; brain-requests.mjs", layers: ["Area identity", "Generation history", "Unread notices", "Open requests"],
  }),
  resumeBrain: transition("Resume Brain", "Julian", "Agent Shell", "brain", {
    trigger: "Julian resumes a stopped Brain.", payload: "The existing Brain record and the resume command.", knows: "Agent Shell reads the latest handover, plan, and unread notices.",
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
  lifecycle("context", "A worker needs fresh context", "Durable facts cross to a fresh worker. The old transcript does not.", ["Agent Shell", "Area brain", "Worker A", "Worker B"], ["contextRisk", "handover", "continueWorker"]),
  lifecycle("document", "Julian comments on a Document", "The comment goes to the controlling brain, which chooses who handles it.", ["Julian", "Agent Shell", "Area brain", "Worker A"], ["comment", "assignment", "handover"]),
  lifecycle("brain-stop", "A Brain session stops", "The runtime session ends. The durable Brain model remains available for Resume.", ["Julian", "Agent Shell", "Durable storage", "Area brain"], ["stopBrain", "retainBrain", "resumeBrain"]),
];

/** Builds one canonical sequence from its actors and boundary ids. */
function lifecycle(id, name, summary, actors, transitions) { return { id, name, summary, actors, transitions }; }

export const LEGACY_LIFECYCLES = [
  { id: "legacy-solo", name: "Direct Goal agent", summary: "The worker can speak directly with Julian because no Area brain controls the Goal.", steps: ["UI → Goal agent: assignment", "Goal agent → Julian: decision", "Goal agent → Tangent: completion"] },
  { id: "legacy-pipeline", name: "Self-advancing pipeline", summary: "A worker handover can start the next step without a brain decision.", steps: ["Step 1 → Tangent: handover", "Tangent → Step 2: automatic advance", "Final step → Julian: result"] },
];

/** Escapes dynamic text for the Bestiary's HTML. */
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }

/** Finds the nearest active ancestor brain that controls an Area. */
function controllingBrain(area, brains) {
  const parts = String(area ?? "").split("/").filter(Boolean);
  for (let count = parts.length; count > 0; count -= 1) {
    const candidate = parts.slice(0, count).join("/");
    const brain = brains.find((item) => item.area === candidate && item.status !== "ended");
    if (brain) return brain;
  }
  return null;
}

/** Returns the canonical text for one boundary, with dynamic values as tags. */
function canonicalMessage(item) {
  if (item.species === "brain") return `# Brain for <area>

You are the brain of the Area <area>. You are the one long-lived agent that plans and dispatches its work. Julian will mostly speak only with you.

## Julian's instruction

<instruction>

## Sources

<area-notes-and-documents>

## Handover from the earlier generation

<brain-handover-if-present>

## Notices you have not read

<durable-worker-and-user-notices>

## How to work

Research the work and write the proposed Goals, done conditions, agent count, assignments, dependencies, parallel work, and risks in the plan. Request one plan approval before you create Goals or start workers.

Workers report only to you through tangent handover. Read each report and choose the next transition. Ask Julian only through plan, decision, test, or approval requests. Close a Goal when its done condition and review policy hold.

## When to hand over

<brain-generation-handover-contract>`;
  if (item.species === "goal") return `# Assignment: <goal-title>

## Done when

<done-condition>

## Sources

- Goal: <goal-file>
- Area notes: <area-notes>
- Documents: <linked-documents>

## Brain

The brain for Area <controlling-area> controls this work. Do the assignment. Do not create, start, close, or re-plan Goals. Do not contact Julian or choose another agent.

## How to work

<assignment-guidance>

When you finish, run tangent handover "<facts>". State files and commits, checks and results, what is complete, what is unresolved, and any decision or test that is needed. The brain decides the next action.`;
  if (item.species === "pipeline") return item.label === "Advance assignment"
    ? `tangent brain advance <goal> <step-number>`
    : `# Assignment: <goal-title>

<goal-assignment>

## Your step

Step <index> of <total>: <step-instruction>

## Handovers so far

<earlier-worker-handovers>

## When you finish

Run tangent handover "<facts>". Report to the brain. Do not choose the next worker.`;
  if (item.species === "handover") return `tangent handover "Files changed: <paths>. Commits: <commits>. Checks: <commands-and-results>. Complete: <completed-work>. Unresolved: <remaining-work>. Decision or test needed: <need-or-none>."`;
  if (item.species === "brain-request") {
    const kind = item.label.startsWith("Plan") ? "plan" : item.label.startsWith("Decision") ? "decision" : "test";
    const options = "Approve | I want these changes";
    return `<brain-request>
  <kind>${kind}</kind>
  <subject><subject-text></subject>
  <detail><why-now-options-effects-and-blocked-work></detail>
  <question><direct-question></question>
  <answers>${options}</answers>
</brain-request>`;
  }
  if (["Plan answer", "Decision answer", "Test answer"].includes(item.label)) return `<brain-notice>
  Julian answered <request-kind> request <request-id>: <named-answer>.
  <optional-feedback>
</brain-notice>`;
  if (item.label === "Close Goal") return `tangent goal done <goal-slug>

Proof: <done-condition-proof>
Review: <review-verdict>
Test: <test-verdict-if-required>`;
  if (item.label === "Context risk") return `Your context is at <used-tokens> of <context-window>. At the next natural pause, report complete continuation facts through tangent handover. The brain decides whether a fresh worker continues.`;
  if (item.label === "Fresh worker") return `<worker-assignment>

## Continuing this step

<continuation-1-facts>
<continuation-2-facts-if-present>

Continue the same assignment. Report through tangent handover.`;
  if (item.species === "comment") return `<brain-notice>
  Julian added comments to <document> (<open-comment-count> open comments).
  Read them with tangent document comments <document>.
</brain-notice>`;
  return `<message>${item.payload}</message>`;
}

/** Renders the selected boundary and optional exact live message. */
function renderTransitionInspector(item, inspector) {
  const rows = [["Why now?", item.trigger], ["From and to", `${item.from} → ${item.to}`], ["What crosses", item.payload], ["Already known", item.knows], ["What happens next", item.next], ["State change", item.state], ["Delivery", item.delivery], ["Code source", item.source]];
  const preview = inspector.loading ? `<div class="prompt-preview"><p>Building the exact current message…</p></div>` : inspector.error ? `<div class="prompt-preview error-card">${escapeHtml(inspector.error)}</div>` : inspector.text ? `<div class="prompt-preview"><div><strong>${escapeHtml(inspector.title)}</strong><button type="button" data-close-prompt-preview>Close exact message</button></div><pre>${escapeHtml(inspector.text)}</pre></div>` : "";
  return `<aside class="transition-inspector" aria-live="polite"><p class="kicker">Selected boundary</p><h2>${escapeHtml(item.label)}</h2><div class="transition-route"><span>${escapeHtml(item.from)}</span><b>→</b><span>${escapeHtml(item.to)}</span></div><section class="canonical-message"><header><h3>Message sent</h3><small>Dynamic parts stay visible as &lt;tags&gt;.</small></header><pre>${escapeHtml(canonicalMessage(item))}</pre></section><details class="boundary-details"><summary>Why and how this message is sent</summary><dl>${rows.map(([name, value]) => `<div><dt>${name}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl><section class="prompt-layers"><h3>Message layers</h3><ol>${item.layers.map((layer) => `<li>${escapeHtml(layer)}</li>`).join("")}</ol></section></details>${preview}</aside>`;
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
  const goalOptions = goals.slice(0, 200).map((goal) => { const brain = controllingBrain(goal.area, brains); return `<option value="${escapeHtml(goal.file)}"${inspector.file === goal.file ? " selected" : ""}>${escapeHtml(goal.title)} · ${escapeHtml(brain ? `Managed by ${brain.area}` : "Legacy direct Goal")}</option>`; }).join("");
  const brainOptions = brains.map((brain) => `<option value="${escapeHtml(brain.area)}"${inspector.area === brain.area ? " selected" : ""}>${escapeHtml(brain.area)} · generation ${brain.generation ?? "?"}</option>`).join("");
  const selectedGoal = goals.find((goal) => goal.file === inspector.file);
  const selectedBrain = selectedGoal ? controllingBrain(selectedGoal.area, brains) : null;
  const liveBadge = selectedGoal ? `<p class="live-compatibility ${selectedBrain ? "managed" : "legacy"}"><strong>${selectedBrain ? "Managed work" : "Legacy direct Goal"}</strong>${selectedBrain ? `Controlled by brain ${escapeHtml(selectedBrain.area)}.` : "No Area brain controls this Goal. Its prompt can contain old direct-to-Julian rules."}</p>` : "";
  return `<div class="bestiary-layout">
      <nav class="lifecycle-index" aria-label="Canonical lifecycles"><div><p class="kicker">Canonical encounters</p><p>The current brain-controlled model.</p></div>${LIFECYCLES.map((item) => `<button type="button" data-bestiary-lifecycle="${item.id}" aria-pressed="${item.id === selectedLifecycle.id}"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.summary)}</small></button>`).join("")}</nav>
      <main class="lifecycle-stage"><header><div><p class="kicker">Canonical lifecycle</p><h2>${escapeHtml(selectedLifecycle.name)}</h2><p>${escapeHtml(selectedLifecycle.summary)}</p></div><span class="model-badge">Brain controlled</span></header><div class="actor-strip" style="--actor-count:${selectedLifecycle.actors.length}">${selectedLifecycle.actors.map((actor) => `<span>${escapeHtml(actor)}</span>`).join("")}</div><ol class="lifecycle-sequence">${selectedLifecycle.transitions.map((id, index) => { const item = TRANSITIONS[id]; return `<li><button type="button" data-bestiary-transition="${id}" aria-pressed="${id === transitionId}"><span class="sequence-number">${index + 1}</span><span class="sequence-route"><small>${escapeHtml(item.from)}</small><b>→</b><small>${escapeHtml(item.to)}</small></span><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.trigger)}</span></button></li>`; }).join("")}</ol></main>
      ${renderTransitionInspector(selectedTransition, inspector)}
    </div>${messages ? `
    <details class="live-inspector"${inspector.text || inspector.loading || inspector.error ? " open" : ""}><summary><span><strong>Inspect a live instance</strong><small>Overlay a current Goal or Brain on the canonical lifecycle.</small></span></summary><div class="live-inspector-body">${liveBadge}<div class="live-prompt-row"><select data-prompt-goal><option value="">Choose a Goal…</option>${goalOptions}</select><button type="button" data-load-goal-prompt="goal">Worker assignment</button><button type="button" data-load-goal-prompt="pipeline">Pipeline assignment</button></div><div class="live-prompt-row"><select data-prompt-brain><option value="">Choose a Brain…</option>${brainOptions}</select><button type="button" data-load-brain-prompt>Brain generation</button></div></div></details>
    <details class="legacy-encounters"><summary><span><strong>Legacy encounters</strong><small>Old paths that remain inspectable during migration.</small></span></summary><div>${LEGACY_LIFECYCLES.map((item) => `<article><span>Legacy</span><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.summary)}</p><ol>${item.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol></article>`).join("")}</div></details>
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
