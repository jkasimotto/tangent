/** The prompt and event species Agent Shell can send into an agent composer. */
export const PROMPT_SPECIES = [
  { id: "describe", name: "Work definition", recipient: "Defining agent", trigger: "Describe work → Start agent", delivery: "Verified, then submitted", shape: "Area + Julian's description + Area notes + selected Documents + rules for creating or doing the work." },
  { id: "goal", name: "Goal assignment", recipient: "Goal agent", trigger: "Start agent on a Goal", delivery: "Verified; submitted for direct launches", shape: "Done condition + Goal file + Area notes + linked Documents + ownership and completion rules." },
  { id: "collaborate", name: "Goal collaboration", recipient: "Goal agent", trigger: "Open agent while reading a Goal or Document", delivery: "Verified; user can submit manually", shape: "The complete Goal assignment, followed by collaboration rules and the current reading location." },
  { id: "pipeline", name: "Pipeline step", recipient: "Current step agent", trigger: "Start, advance, retry, or continue a pipeline", delivery: "Verified, then submitted", shape: "The complete Goal assignment + this step + prior handovers + continuation history + the handover contract." },
  { id: "brain", name: "Brain generation", recipient: "Area brain", trigger: "Start or hand over an Area brain", delivery: "Verified, then submitted", shape: "Julian's Area instruction + plan path + unread notices + orchestration, decision, Test, verdict, and handover rules." },
  { id: "agent-message", name: "Agent message", recipient: "Named agent", trigger: "tangent agent send", delivery: "Queued until an empty composer; then verified and submitted", shape: "[Message from <session> (<area>)] followed by the sender's text." },
  { id: "brain-notice", name: "Brain notice", recipient: "Nearest live Area brain", trigger: "Worker handover, completion, stop, context risk, request answer, or Document comment", delivery: "Durable until a brain generation receives it", shape: "A deterministic event sentence, sometimes with a worker's handover facts." },
  { id: "brain-request", name: "Brain request", recipient: "Julian", trigger: "The brain needs plan approval, a decision, a test, or explicit approval", delivery: "Durable request record on the Area brain", shape: "Subject, detail, question, named answers, and request lifecycle." },
  { id: "verdict", name: "Verdict", recipient: "Area brain", trigger: "Accept, Reject, or Undo on a For Julian row", delivery: "Brain notice queue", shape: "Julian accepted <target>; Julian rejected <target>; or Julian withdrew his verdict on <target>; the line is back." },
  { id: "reply", name: "Reply subject", recipient: "Area brain", trigger: "Reply or Answer on a For Julian row", delivery: "Brain notice queue before the terminal opens", shape: "Julian is replying about: <subject>" },
  { id: "context", name: "Context risk", recipient: "Goal or step agent, then Area brain", trigger: "Observed context crosses the configured threshold", delivery: "Queued until an empty composer", shape: "A reminder to run tangent handover with facts. The brain decides whether a fresh worker continues." },
  { id: "voice", name: "Voice utterance", recipient: "Focused or explicitly addressed agent", trigger: "Voice router returns say", delivery: "Typed verbatim; submitted only when the target is an agent", shape: "Julian's utterance, with a leading session address removed only for a directly addressed session." },
];

/** Expected multi-agent encounters shown as message sequences. */
export const LIFECYCLES = [
  { id: "solo", name: "One Goal agent", summary: "Julian works directly with one agent.", steps: [
    ["UI", "Goal agent", "Goal assignment"], ["Goal agent", "Julian", "A real decision in its terminal"], ["Julian", "Goal agent", "Answer or feedback"], ["Goal agent", "Tangent", "Handover facts or completion"],
  ] },
  { id: "brain-solo", name: "One brain + one Goal agent", summary: "Julian approves the split; the brain owns every later transition.", steps: [
    ["UI", "Brain", "Brain generation prompt"], ["Brain", "Julian", "Structured plan request"], ["Julian", "Brain", "Approve plan or Request changes"], ["Brain", "Goal agent", "Starts approved assignment"], ["Goal agent", "Brain", "One tangent handover report"], ["Brain", "Julian", "Structured decision or test request when needed"],
  ] },
  { id: "brain-pipeline", name: "One brain + agent sequence", summary: "Workers report facts; only the brain advances the approved assignments.", steps: [
    ["Brain", "Step 1", "Goal + step 1 prompt"], ["Step 1", "Brain", "tangent handover facts"], ["Brain", "Tangent", "advance step 2"], ["Tangent", "Step 2", "Goal + step 2 + prior handover"], ["Final step", "Brain", "Review facts"], ["Brain", "Julian", "Structured Test request when needed"],
  ] },
  { id: "verdicts", name: "Requests and answers", summary: "One durable request record states the question and its valid answers.", steps: [
    ["Brain", "UI", "Plan, Decision, Test, or Approval request"], ["Julian", "Request", "Named answer"], ["Request store", "Brain", "Durable answer notice"], ["Brain", "Worker or Goal", "Next command"],
  ] },
];

/** Escapes text for this view's HTML. */
function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** Renders the complete prompt bestiary and optional exact live preview. */
export function renderPromptBestiary({ goals = [], brains = [], inspector = {} } = {}) {
  const preview = inspector.loading
    ? `<div class="prompt-preview"><p>Rendering the current prompt…</p></div>`
    : inspector.error
      ? `<div class="prompt-preview error-card">${escapeHtml(inspector.error)}</div>`
      : inspector.text
        ? `<div class="prompt-preview"><div><strong>${escapeHtml(inspector.title)}</strong><button type="button" data-close-prompt-preview>Close</button></div><pre>${escapeHtml(inspector.text)}</pre></div>`
        : "";
  const goalOptions = goals.slice(0, 200).map((goal) => `<option value="${escapeHtml(goal.file)}">${escapeHtml(goal.title)} · ${escapeHtml(goal.area)}</option>`).join("");
  const brainOptions = brains.map((brain) => `<option value="${escapeHtml(brain.area)}">${escapeHtml(brain.area)} · generation ${brain.generation ?? "?"}</option>`).join("");
  return `<section class="prompt-bestiary">
    <header class="prompt-bestiary-intro"><p class="kicker">Prompt bestiary</p><h1>What Agent Shell tells each agent</h1><p>Inspect the messages, delivery rules, and expected encounters. Exact previews use current Goal and brain state.</p></header>
    <section class="prompt-live-tools"><h2>Inspect a live prompt</h2><div><select data-prompt-goal><option value="">Choose a Goal…</option>${goalOptions}</select><button type="button" data-load-goal-prompt="goal">Goal assignment</button><button type="button" data-load-goal-prompt="collaborate">Collaboration</button><button type="button" data-load-goal-prompt="pipeline">Pipeline step</button></div><div><select data-prompt-brain><option value="">Choose a brain…</option>${brainOptions}</select><button type="button" data-load-brain-prompt>Brain generation</button></div>${preview}</section>
    <section><h2>Encounters</h2><div class="lifecycle-grid">${LIFECYCLES.map((life) => `<article class="lifecycle-card"><h3>${escapeHtml(life.name)}</h3><p>${escapeHtml(life.summary)}</p><ol>${life.steps.map(([from, to, message]) => `<li><span>${escapeHtml(from)}</span><b>→</b><span>${escapeHtml(to)}</span><small>${escapeHtml(message)}</small></li>`).join("")}</ol></article>`).join("")}</div></section>
    <section><h2>Prompt species</h2><div class="prompt-species-grid">${PROMPT_SPECIES.map((species) => `<article class="prompt-species-card"><p class="kicker">${escapeHtml(species.recipient)}</p><h3>${escapeHtml(species.name)}</h3><dl><dt>Trigger</dt><dd>${escapeHtml(species.trigger)}</dd><dt>Delivery</dt><dd>${escapeHtml(species.delivery)}</dd><dt>Message</dt><dd>${escapeHtml(species.shape)}</dd></dl></article>`).join("")}</div></section>
  </section>`;
}

export default { LIFECYCLES, PROMPT_SPECIES, renderPromptBestiary };
