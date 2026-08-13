const chapters = [
  {
    id: "promise",
    kicker: "00 — Product promise",
    title: "A calm place to direct agent work",
    story:
      "Agent Shell holds the work around the terminal. It preserves intent, waits quietly, and returns work only for a useful decision.",
    move:
      "The shell opens on one resumable outcome. The full tree, running agents, and system controls stay available without taking the screen.",
    reasons: [
      "The first screen answers one question: what can I continue now?",
      "Running work stays visible through one quiet attention control.",
      "The shell stores context before each switch, so resumption needs less memory."
    ],
    principles: ["calm technology", "recognition", "external memory", "user control"],
    summary: "The shell protects attention before it adds execution power."
  },
  {
    id: "choose",
    kicker: "01 — Choose",
    title: "Browse is a doorway, not the room",
    story:
      "Julian wants to find a D&D outcome. Most other nodes do not matter during this choice.",
    move:
      "Browse opens a temporary work catalog. It starts with relevant work and expands into the full tree only after a search or deliberate exploration.",
    reasons: [
      "Recent, active, and attention-ready work appears before the whole tree.",
      "Search covers all nodes, including items that are not in the normal browse set.",
      "Selection shows context. A separate action starts work."
    ],
    principles: ["progressive disclosure", "recognition", "stable navigation", "no side effects"],
    summary: "The tree organizes work, but it does not occupy the work surface."
  },
  {
    id: "understand",
    kicker: "02 — Understand",
    title: "Build shared understanding before execution",
    story:
      "The D&D goal spans terrain, generation, segmentation, and movement. The first discussion produced too many questions and several later corrections.",
    move:
      "The agent handles facts and presents one product decision at a time. Each answer updates a visible, durable understanding beside the discussion.",
    reasons: [
      "One current decision limits cognitive load and gives the discussion a clear frontier.",
      "The right pane exposes the model that the agent will use later.",
      "Execute stays locked until Julian reviews the complete understanding."
    ],
    principles: ["shared mental model", "progressive disclosure", "visible state", "semantic approval"],
    summary: "Conversation becomes durable understanding instead of hidden transcript state."
  },
  {
    id: "assignment",
    kicker: "03 — Assign",
    title: "Read the exact job before an agent starts",
    story:
      "A broad outcome can contain several agent jobs. Julian needs to know which job starts now and which proof the agent must produce.",
    move:
      "Agent Shell generates a short assignment from the approved understanding. Julian reads the complete Markdown and starts it with an explicit action.",
    reasons: [
      "The assignment separates this run from the larger outcome.",
      "Sources show which outcome, design, and node notes shaped the brief.",
      "Agent choice remains local to this run and does not crowd the normal screen."
    ],
    principles: ["informed consent", "traceability", "one job", "explicit action"],
    summary: "Approval applies to a readable assignment, not a vague outcome title."
  },
  {
    id: "execute",
    kicker: "04 — Execute",
    title: "Let execution become peripheral",
    story:
      "The ramp agent needs time. Julian wants to leave it alone without forgetting its purpose or polling its terminal.",
    move:
      "The run view keeps the terminal available, but the persistent panel explains purpose, state, ownership, and the exact return condition.",
    reasons: [
      "The terminal proves activity, but it is not the durable home of intent.",
      "Leaving the run does not stop it or hide it.",
      "The shell asks for attention only when Julian can act."
    ],
    principles: ["calm technology", "peripheral awareness", "truthful state", "interruptibility"],
    summary: "Running agents remain accountable without demanding continuous attention."
  },
  {
    id: "return",
    kicker: "05 — Return",
    title: "Completed work waits at a boundary",
    story:
      "The ramp agent finishes while Julian discusses Agent Shell. The result matters, but it must not replace the current thought.",
    move:
      "A quiet count changes. Julian opens the attention drawer at a natural stopping point. Each item states its identity, reason, and next action.",
    reasons: [
      "Completion does not cause navigation or open a modal.",
      "The drawer explains why attention has value before Julian opens the work.",
      "Current work remains visible behind the temporary attention surface."
    ],
    principles: ["respectful notification", "resumption cues", "user timing", "actionable signals"],
    summary: "Agent Shell returns decisions, not terminal noise."
  },
  {
    id: "review",
    kicker: "06 — Review",
    title: "Review proof against the original agreement",
    story:
      "The agent says that the ramp work is complete. Julian needs proof tied to the decisions that defined the assignment.",
    move:
      "Review starts with the visible result and binary criteria. Detailed logs stay one click away. New durable knowledge appears as a separate proposal.",
    reasons: [
      "The proof uses the same criteria that Julian approved before execution.",
      "Evidence appears in layers. The result comes before logs and telemetry.",
      "Accepting the work does not silently change a design document or finish the parent outcome."
    ],
    principles: ["closure", "recognition", "progressive evidence", "separate decisions"],
    summary: "A stopped agent is not a finished outcome. Proof creates the decision point."
  },
  {
    id: "resume",
    kicker: "07 — Resume",
    title: "Land on a pre-paid next action",
    story:
      "The ramp assignment is accepted. The larger D&D outcome still needs a manual walk through the complete loop.",
    move:
      "Agent Shell uses the accepted breakdown to offer the next unresolved step. Julian still chooses whether to continue, defer, or browse.",
    reasons: [
      "The resume card restores the previous context in one small summary.",
      "The shell offers a next action from approved structure. It does not invent priority.",
      "A completed child changes the parent state without declaring the parent complete."
    ],
    principles: ["prospective memory", "closure", "user control", "state continuity"],
    summary: "Each return restores enough context to act without reconstructing the session."
  },
  {
    id: "fast-path",
    kicker: "08 — Small work",
    title: "Clear work stays light",
    story:
      "The Delete key stops text editing in Agent Shell. The expected behavior and proof are already clear.",
    move:
      "The shell detects no unresolved product decision. It shows a compact assignment and lets Julian start the fix without a design ritual.",
    reasons: [
      "Ceremony scales with uncertainty and risk, not task count.",
      "The compact brief still states observed behavior, expected behavior, and proof.",
      "Julian can open Understand if the apparent small fix reveals a larger decision."
    ],
    principles: ["low interaction cost", "proportional friction", "escape hatch", "clear proof"],
    summary: "The product adds friction only where judgment has value."
  },
  {
    id: "improve",
    kicker: "09 — Improve",
    title: "Turn annoyance into a better agent",
    story:
      "An agent returns a large document when Julian asked for a discussion. The failure is obvious now and difficult to reconstruct later.",
    move:
      "Mark captures the moment inside Agent Shell. The conversation evidence attaches automatically. Diagnosis and evaluation can happen later.",
    reasons: [
      "Capture takes seconds and does not open a separate analysis product.",
      "The current model describes observed and expected behavior while context is fresh.",
      "Future proof returns through the same review pattern as normal work."
    ],
    principles: ["capture in context", "low interruption cost", "evidence", "continuous improvement"],
    summary: "Agent improvement lives inside normal work, not in a separate project."
  },
  {
    id: "system",
    kicker: "10 — Whole product",
    title: "One shell, with one home for each fact",
    story:
      "Agent Shell is the daily product. Markdown, tmux, Git, Usage, and evals support it without becoming competing destinations.",
    move:
      "The shell connects durable intent to temporary execution. It shows the right projection for each moment and keeps every source inspectable.",
    reasons: [
      "Outcomes store desired results. Assignments store approved jobs. Runs store temporary execution.",
      "Attention items are projections. They never become a second task system.",
      "Usage and eval evidence appear inside review. They do not require a separate Tangent UI."
    ],
    principles: ["one work surface", "canonical sources", "local first", "inspectable system"],
    summary: "The product is a focus and return loop around agent execution."
  }
];

const browseItems = {
  "walk-loop": {
    path: "otto / dnd",
    title: "Walk the whole loop",
    outcome:
      "From an empty map, create terrain and a creature. Then walk the creature across a partial-width ramp in one sitting.",
    state: "Open",
    stateClass: "open",
    detail: "The outcome has an approved breakdown, but several product decisions still need a final review.",
    action: "Build understanding"
  },
  "generation": {
    path: "otto / dnd",
    title: "Image generation is consistent",
    outcome:
      "Accept the first generated candidate for blank terrain, painted terrain, filled volumes, and sprites.",
    state: "Agent working",
    stateClass: "working",
    detail: "The agent is investigating raster preservation. No decision needs your attention.",
    action: "Open run"
  },
  "vision": {
    path: "otto / tangent",
    title: "Define the Agent Shell product vision",
    outcome:
      "Create a concrete product vision that Julian can inspect, discuss, and understand through a working demonstration.",
    state: "Current",
    stateClass: "working",
    detail: "This interactive notebook is the current assignment.",
    action: "Continue"
  },
  "delete-key": {
    path: "otto / tangent",
    title: "Delete key edits text",
    outcome:
      "Delete and Backspace edit focused text without triggering tree or session actions.",
    state: "Ready",
    stateClass: "open",
    detail: "The expected behavior is clear. This outcome can use the short path.",
    action: "Review brief"
  }
};

let currentChapter = 0;
let explanations = true;
let browseSelection = "walk-loop";
let finalDecision = false;
let knowledgeSaved = false;
let smallFixStarted = false;
let markSaved = false;
let toastTimer = null;

const shell = document.querySelector("#shell");
const chapterList = document.querySelector("#chapter-list");
const chapterKicker = document.querySelector("#chapter-kicker");
const chapterTitle = document.querySelector("#chapter-title");
const chapterStory = document.querySelector("#chapter-story");
const chapterMove = document.querySelector("#chapter-move");
const chapterReasons = document.querySelector("#chapter-reasons");
const chapterPrinciples = document.querySelector("#chapter-principles");
const stepCount = document.querySelector("#step-count");
const footerSummary = document.querySelector("#footer-summary");
const previousButton = document.querySelector("#previous-button");
const nextButton = document.querySelector("#next-button");
const explainToggle = document.querySelector("#explain-toggle");
const restartButton = document.querySelector("#restart-button");
const toast = document.querySelector("#toast");

function pin(number, label) {
  return `<span class="pin pin-float" title="${label}" aria-label="Explanation ${number}: ${label}">${number}</span>`;
}

function statusDot(state, pulse = false) {
  return `<span class="status-dot ${state}${pulse ? " pulse" : ""}" aria-hidden="true"></span>`;
}

function topbar({ path = "Agent Shell", attention = 0, browseLabel = "Browse" } = {}) {
  const parts = path.split(" / ");
  const breadcrumb = parts
    .map((part, index) => {
      const text = index === parts.length - 1 ? `<strong>${part}</strong>` : part;
      return `${index ? '<span class="crumb-separator">/</span>' : ""}${text}`;
    })
    .join("");

  return `
    <div class="shell-topbar">
      <button class="shell-button" type="button" data-action="open-browse">⌘/ ${browseLabel}</button>
      <div class="shell-breadcrumb">${breadcrumb}</div>
      <button class="shell-button attention-button" type="button" data-action="open-attention">
        Needs you
        <span class="attention-count">${attention}</span>
      </button>
    </div>
  `;
}

function phases(active, completed = []) {
  return `
    <div class="phase-track">
      ${pin(3, "The current phase and every locked phase remain visible.")}
      ${["Understand", "Execute", "Review"]
        .map((phase) => {
          const lower = phase.toLowerCase();
          const classes = ["phase"];
          if (lower === active) classes.push("active");
          if (completed.includes(lower)) classes.push("complete");
          const symbol = completed.includes(lower) ? "✓" : lower === active ? "●" : "◇";
          return `<span class="${classes.join(" ")}"><span class="phase-lock">${symbol}</span>${phase}</span>`;
        })
        .join("")}
    </div>
  `;
}

function workHead({ active, completed = [], eyebrow, title }) {
  return `
    <div class="work-head">
      <div class="work-title">
        <p class="eyebrow">${eyebrow}</p>
        <h2>${title}</h2>
      </div>
      ${phases(active, completed)}
    </div>
  `;
}

function frame(content, options = {}) {
  return `<div class="shell-screen${explanations ? "" : " explain-off"}">${topbar(options)}<div class="shell-main">${content}</div></div>`;
}

function renderPromise() {
  return frame(
    `
      <div class="home-screen">
        <div class="home-center">
          <div class="home-symbol">⌁</div>
          <h2>Your work can leave your head without leaving your control.</h2>
          <p>Agent Shell holds intent around every agent run. It stays quiet until a useful decision is ready.</p>

          <article class="return-card">
            ${pin(1, "The first screen restores one useful thread instead of showing a dashboard.")}
            <p class="eyebrow">Continue where you stopped</p>
            <h3>Define the Agent Shell product vision</h3>
            <p>You accepted the shared-understanding model. The next step is to inspect the complete work loop.</p>
            <div class="return-card-footer">
              <span>otto / tangent · updated 4 minutes ago</span>
              <button class="shell-primary" type="button" data-action="next">Continue</button>
            </div>
          </article>
        </div>

        <div class="promise-strip">
          <div class="promise-item">
            ${pin(2, "Agent Shell stores intent outside the terminal.")}
            <strong>Understand before action</strong>
            <p>Important decisions become visible before an agent receives work.</p>
          </div>
          <div class="promise-item">
            <strong>Delegate without polling</strong>
            <p>Running agents stay quiet until they return a decision or proof.</p>
          </div>
          <div class="promise-item">
            ${pin(3, "Every return includes the identity, reason, and next action.")}
            <strong>Resume without reconstruction</strong>
            <p>Each switch restores the outcome, the last decision, and the next action.</p>
          </div>
        </div>
      </div>
    `,
    { path: "Agent Shell", attention: 1 }
  );
}

function workRow(id, state, meta) {
  const item = browseItems[id];
  return `
    <button class="work-row${browseSelection === id ? " selected" : ""}" type="button" data-select-outcome="${id}" data-search="${item.path} ${item.title} ${item.outcome}">
      ${id === "walk-loop" ? pin(1, "Relevant and recent work appears before the full tree.") : ""}
      ${statusDot(state, state === "working")}
      <span class="row-copy"><strong>${item.title}</strong><small>${item.path}</small></span>
      <span class="row-meta">${meta}</span>
    </button>
  `;
}

function renderBrowse() {
  const selected = browseItems[browseSelection];
  const startAction = browseSelection === "walk-loop" ? "start-understand" : browseSelection === "delete-key" ? "fast-path" : "show-demo-toast";

  return frame(
    `
      <div class="browse-screen">
        <div class="browse-head">
          <div class="browse-title-row">
            <h2>Choose work</h2>
            <button class="shell-button" type="button" data-action="previous">Close browse</button>
          </div>
          <label class="search-box">
            ${pin(2, "Search includes the entire tree, even when the normal list stays small.")}
            <span class="search-icon">⌕</span>
            <input id="work-search" type="search" placeholder="Find a node, outcome, person, or document" autocomplete="off" />
            <span class="search-shortcut">⌘ /</span>
          </label>
        </div>

        <div class="browse-grid">
          <div class="browse-list">
            <section class="browse-section">
              <div class="browse-section-head"><span>Needs you</span><span>1</span></div>
              ${workRow("vision", "waiting", "review")}
            </section>

            <section class="browse-section">
              <div class="browse-section-head"><span>In motion</span><span>2 quiet</span></div>
              ${workRow("generation", "working", "18m")}
              ${workRow("vision", "working", "now")}
            </section>

            <section class="browse-section">
              <div class="browse-section-head"><span>Ready to work</span><span>recent</span></div>
              ${workRow("walk-loop", "open", "dnd")}
              ${workRow("delete-key", "open", "tangent")}
            </section>

            <section class="browse-section full-tree-section">
              <div class="browse-section-head"><span>Explore the tree</span><span>all nodes</span></div>
              <div class="tree-group" data-search="otto dnd roleplaying game">
                <button class="tree-row node-row" type="button" data-action="show-demo-toast">
                  <span class="disclosure">▾</span>
                  <span class="row-copy"><strong>dnd</strong><small>otto / dnd</small></span>
                  <span class="row-meta">8 outcomes</span>
                </button>
                <button class="tree-row child-row" type="button" data-select-outcome="walk-loop" data-search="dnd walk whole loop">
                  <span class="tree-spacer"></span>
                  <span class="row-copy"><strong>Walk the whole loop</strong></span>
                  <span class="row-meta">open</span>
                </button>
              </div>
              <div class="tree-group" data-search="otto tangent agent shell">
                <button class="tree-row node-row" type="button" data-action="show-demo-toast">
                  <span class="disclosure">▾</span>
                  <span class="row-copy"><strong>tangent</strong><small>otto / tangent</small></span>
                  <span class="row-meta">24 outcomes</span>
                </button>
              </div>
              <p class="browse-footnote">Hidden nodes are absent here by default. Search still finds them.</p>
            </section>
          </div>

          <aside class="browse-detail">
            ${pin(3, "Selection reveals context. It never starts an agent.")}
            <div class="detail-path">${selected.path}</div>
            <h3>${selected.title}</h3>
            <p class="detail-outcome">${selected.outcome}</p>

            <div class="detail-block">
              <h4>Current state</h4>
              <div class="detail-state">
                ${statusDot(selected.stateClass, selected.stateClass === "working")}
                <span>${selected.state} <small>· ${selected.detail}</small></span>
              </div>
            </div>

            <div class="detail-block">
              <h4>Context that will load</h4>
              <ul class="fact-list">
                <li><span class="fact-mark">✓</span><span>Outcome and current state</span></li>
                <li><span class="fact-mark">✓</span><span>Nearest node notes</span></li>
                <li><span class="fact-mark">✓</span><span>Linked product design</span></li>
              </ul>
            </div>

            <div class="detail-actions">
              <button class="shell-primary" type="button" data-action="${startAction}">${selected.action}</button>
              <button class="shell-secondary" type="button" data-action="show-demo-toast">Open Markdown</button>
            </div>
          </aside>
        </div>
      </div>
    `,
    { path: "Browse", attention: 1, browseLabel: "Close" }
  );
}

function renderUnderstand() {
  const settledCount = finalDecision ? 4 : 3;
  return frame(
    `
      <div class="work-screen">
        ${workHead({
          active: "understand",
          eyebrow: "otto / dnd / outcome",
          title: "Walk the whole loop"
        })}

        <div class="phase-body understand-grid">
          <section class="conversation-pane">
            <div class="pane-head">
              <h3>Discussion</h3>
              <span>${finalDecision ? "All decisions settled" : "One decision remains"}</span>
              ${pin(1, "The agent presents one decision at a time.")}
            </div>

            <div class="conversation-scroll">
              <article class="message user">
                <div class="message-avatar">JO</div>
                <div class="message-copy">
                  <span class="message-author">Julian</span>
                  <p>I want one continuous loop. Start with a blank map. Create terrain and a creature, then walk it up a partial-width ramp.</p>
                </div>
              </article>

              <article class="message">
                <div class="message-avatar">A</div>
                <div class="message-copy">
                  <span class="message-author">Agent</span>
                  <p>I inspected the current map, prefab, segmentation, and movement systems. Three decisions are settled.</p>
                  <p>One decision still changes the breakdown and its proof.</p>
                </div>
              </article>

              <article class="decision-card">
                ${pin(2, "A recommendation reduces effort, but the alternative remains visible.")}
                <p class="eyebrow">Decision 4 of 4</p>
                <h4>What must the automated test protect?</h4>
                <div class="decision-options">
                  <button class="decision-option${finalDecision ? " selected" : ""}" type="button" data-action="settle-decision">
                    <span class="radio-ring"></span>
                    <span class="option-copy">
                      <strong>Movement and segmentation with saved assets</strong>
                      <small>The test uses real saved entities, drawings, and prefabs. It does not call image models.</small>
                    </span>
                    <span class="recommend-label">Recommended</span>
                  </button>
                  <button class="decision-option" type="button" data-action="show-demo-toast">
                    <span class="radio-ring"></span>
                    <span class="option-copy">
                      <strong>The complete loop, including model calls</strong>
                      <small>This test becomes slow, expensive, and dependent on external model output.</small>
                    </span>
                    <span></span>
                  </button>
                </div>
              </article>
            </div>

            <div class="conversation-composer">
              <div class="composer-box">
                <textarea aria-label="Reply to the agent" placeholder="Answer naturally, correct the summary, or ask why..."></textarea>
                <button class="shell-secondary" type="button" data-action="send-reply">Send</button>
              </div>
              <p class="composer-note">This reply updates shared understanding. It does not start implementation.</p>
            </div>
          </section>

          <aside class="understanding-pane">
            <div class="pane-head">
              <h3>Shared understanding</h3>
              <span class="saved-state">● Saved</span>
              ${pin(2, "This pane shows the durable model that future agents will receive.")}
            </div>

            <div class="understanding-scroll">
              <div class="understanding-progress">
                <div class="progress-track"><div class="progress-fill" style="width:${settledCount * 25}%"></div></div>
                <strong>${settledCount} / 4 settled</strong>
              </div>

              <section class="understanding-group">
                <h4>Outcome</h4>
                <p>From an empty map, create terrain and a creature. Then walk it across a partial-width ramp in one sitting.</p>
              </section>

              <section class="understanding-group">
                <h4>Settled decisions</h4>
                <ul class="fact-list">
                  <li><span class="fact-mark">✓</span><span>One parent outcome with an ordered breakdown.</span></li>
                  <li><span class="fact-mark">✓</span><span>The ramp connects existing volumes before volume editing expands.</span></li>
                  <li><span class="fact-mark">✓</span><span>Ramp width is selected during one continuous creation gesture.</span></li>
                  <li class="${finalDecision ? "" : "pending"}"><span class="fact-mark">${finalDecision ? "✓" : "?"}</span><span>${finalDecision ? "The automated test protects movement and segmentation with saved assets." : "The boundary of the automated test is not settled."}</span></li>
                </ul>
              </section>

              <section class="understanding-group">
                <h4>Deferred</h4>
                <ul class="fact-list">
                  <li><span class="fact-mark">–</span><span>Mask editing after generation.</span></li>
                  <li><span class="fact-mark">–</span><span>Volumes on entities and climbable movers.</span></li>
                </ul>
              </section>

              <section class="understanding-group">
                <h4>Proof</h4>
                <ul class="fact-list">
                  <li><span class="fact-mark">✓</span><span>Julian walks the complete loop by hand.</span></li>
                  <li><span class="fact-mark">✓</span><span>An automated test moves a saved entity across a saved map.</span></li>
                </ul>
              </section>
            </div>

            <div class="understanding-footer">
              ${pin(3, "A complete review is the gate between understanding and execution.")}
              <button class="shell-primary" type="button" data-action="review-understanding" ${finalDecision ? "" : "disabled"}>Review full understanding</button>
              <p>${finalDecision ? "Ready for one complete review" : "Settle or defer the remaining decision"}</p>
            </div>
          </aside>
        </div>
      </div>
    `,
    { path: "otto / dnd / Walk the whole loop", attention: 1 }
  );
}

function renderAssignment() {
  return frame(
    `
      <div class="work-screen">
        ${workHead({
          active: "understand",
          eyebrow: "Assignment review",
          title: "Implement connection-first, partial-width ramps"
        })}

        <div class="phase-body brief-grid">
          <article class="brief-document">
            <div class="brief-document-inner">
              <div class="document-label"><span>Exact agent assignment · Markdown</span><span>Derived from approved understanding</span></div>
              <h3>Implement connection-first, partial-width ramps</h3>
              <p class="brief-lede">A user can connect two existing volumes with a ramp. One continuous gesture sets the connection and its width.</p>

              <section class="markdown-section">
                <h4>Done condition</h4>
                <p>Press on one volume edge. Drag to the other volume. Continue the same gesture to set a partial width.</p>
              </section>

              <section class="markdown-section">
                <h4>Required behavior</h4>
                <ol>
                  <li>Show an honest preview before the user releases the pointer.</li>
                  <li>Keep both source volumes unchanged.</li>
                  <li>Use the same ramp geometry for preview, bake, navigation, and validation.</li>
                  <li>Explain a near miss without creating a broken ramp.</li>
                </ol>
              </section>

              <section class="markdown-section">
                <h4>Proof</h4>
                <ul>
                  <li>Add focused tests for the gesture and geometry consumers.</li>
                  <li>Run the relevant D&D checks.</li>
                  <li>Return a short recording of one complete gesture.</li>
                </ul>
              </section>

              <section class="markdown-section boundary">
                <h4>Do not do</h4>
                <p>Do not add entity volumes, climbable movers, ramp editing handles, or image-generation work.</p>
              </section>
            </div>
          </article>

          <aside class="brief-inspector">
            <div class="inspector-title">
              <h3>Before the agent starts</h3>
              ${pin(1, "Approval covers this complete assignment, not the parent outcome title.")}
            </div>

            <div class="contract-callout">Nothing starts until you approve this text. Discussing a change returns to Understand and updates the source.</div>

            <section class="inspector-group">
              <h4>Sources</h4>
              <div class="source-row"><span class="source-icon">O</span><span>Walk the whole loop</span><small>outcome</small></div>
              <div class="source-row"><span class="source-icon">D</span><span>D&D product design</span><small>linked</small></div>
              <div class="source-row"><span class="source-icon">N</span><span>dnd.md</span><small>nearest note</small></div>
            </section>

            <section class="inspector-group">
              <h4>Agent for this run</h4>
              ${pin(3, "Agent choice is available at the commitment point, not in permanent chrome.")}
              <select class="agent-select" aria-label="Agent for this assignment">
                <option>Codex · gpt-5.6-sol high</option>
                <option>Claude · Opus 4.1</option>
                <option>Shell only</option>
              </select>
            </section>

            <section class="inspector-group">
              <h4>Durable record</h4>
              <div class="agent-row"><span class="source-icon">A</span><span>Approved assignment</span><small>saved with run</small></div>
              <div class="agent-row"><span class="source-icon">G</span><span>Acceptance and edits</span><small>Git provenance</small></div>
            </section>

            <div class="brief-actions">
              <button class="shell-primary" type="button" data-action="approve-brief">Approve and start agent</button>
              <button class="shell-secondary" type="button" data-action="discuss-brief">Discuss a change</button>
            </div>
            <p class="brief-explanation">The agent receives this assignment plus its three sources.</p>
          </aside>
        </div>
      </div>
    `,
    { path: "otto / dnd / Walk the whole loop", attention: 1 }
  );
}

function renderRun() {
  return frame(
    `
      <div class="work-screen">
        ${workHead({
          active: "execute",
          completed: ["understand"],
          eyebrow: "Run · codex · working",
          title: "Implement connection-first, partial-width ramps"
        })}

        <div class="phase-body run-grid">
          <section class="run-activity">
            <div class="run-statusbar">
              <div class="run-status">${statusDot("working", true)}<strong>Agent working</strong><span>· editing ramp geometry</span></div>
              <span class="run-elapsed">18m 42s</span>
            </div>

            <div class="terminal-wrap" aria-label="Illustrative agent terminal">
              <div class="terminal-line command"><span class="terminal-time">14:31:08</span><span class="terminal-copy">› Read the linked outcome and D&amp;D design.</span></div>
              <div class="terminal-line"><span class="terminal-time">14:31:42</span><span class="terminal-copy">Mapped ramp preview, bake, validation, and navigation consumers.</span></div>
              <div class="terminal-line note"><span class="terminal-time">14:36:19</span><span class="terminal-copy">Found duplicate width calculations in preview and bake paths.</span></div>
              <div class="terminal-line command"><span class="terminal-time">14:39:02</span><span class="terminal-copy">› Consolidate geometry in ramp-connection.ts</span></div>
              <div class="terminal-line success"><span class="terminal-time">14:45:27</span><span class="terminal-copy">✓ focused geometry tests pass</span></div>
              <div class="terminal-line command"><span class="terminal-time">14:47:11</span><span class="terminal-copy">› Run movement tests for partial-width connection</span></div>
              <div class="terminal-line"><span class="terminal-time">14:49:50</span><span class="terminal-copy">The navigation mesh now uses the same geometry projection.</span></div>
              <div class="terminal-line command"><span class="terminal-time">14:50:03</span><span class="terminal-copy">› <span class="terminal-cursor"></span></span></div>
            </div>
          </section>

          <aside class="run-facts">
            <article class="run-summary">
              ${pin(1, "Purpose remains visible beside execution.")}
              <p class="eyebrow">Current assignment</p>
              <strong>Connection-first ramps</strong>
              <p>Create one continuous gesture that connects existing volumes and sets a partial width.</p>
            </article>

            <div class="fact-table">
              <div class="fact-row"><span>Owner</span><span>Codex · gpt-5.6-sol high</span></div>
              <div class="fact-row"><span>Repository</span><span>otto-dnd</span></div>
              <div class="fact-row"><span>Branch</span><span>current checkout</span></div>
              <div class="fact-row"><span>Last action</span><span>movement test · 12s ago</span></div>
              <div class="fact-row"><span>Changes</span><span>4 files · +186 −74</span></div>
            </div>

            <article class="return-rule">
              ${pin(3, "The return condition is explicit before you leave.")}
              <h4>Agent Shell will ask for you when</h4>
              <p>The agent has proof, needs a product decision, or cannot make progress.</p>
            </article>

            <div class="run-actions">
              <button class="shell-primary" type="button" data-action="leave-running">Leave running</button>
              <button class="shell-danger" type="button" data-action="stop-demo-run">Stop</button>
            </div>
          </aside>
        </div>
      </div>
    `,
    { path: "otto / dnd / Connection-first ramps", attention: 0 }
  );
}

function renderReturn() {
  return frame(
    `
      <div class="background-work">
        ${workHead({
          active: "understand",
          eyebrow: "otto / tangent / outcome",
          title: "Define the Agent Shell product vision"
        })}
        <div class="background-discussion">
          <div class="background-copy">
            <h3>What is the complete work loop?</h3>
            <p>Agent Shell must support understanding, delegation, quiet execution, proof review, and resumption without turning into a dashboard.</p>
            <div class="background-card">
              <strong>Current decision</strong>
              <p>How much information belongs on the normal work screen?</p>
            </div>
          </div>
          <div class="background-copy">
            <p class="eyebrow">Shared understanding</p>
            <div class="background-card">
              <strong>Attention is the scarce resource.</strong>
              <p>Unrelated work stays out of the current surface.</p>
            </div>
          </div>
        </div>
      </div>

      <div class="return-backdrop"></div>
      <aside class="attention-drawer">
        <div class="drawer-head">
          ${pin(1, "You open this drawer. Completion never replaces the current screen.")}
          <h2>Needs you</h2>
          <p>Two items are ready for a useful decision.</p>
        </div>

        <div class="drawer-list">
          <article class="attention-card primary-card">
            ${pin(2, "Each item gives identity, reason, and action.")}
            <div class="attention-card-head">
              <span class="attention-kind">${statusDot("done")} Ready for review</span>
              <time>2m ago</time>
            </div>
            <h3>Connection-first, partial-width ramps</h3>
            <p class="attention-path">otto / dnd / Walk the whole loop</p>
            <dl class="attention-contract">
              <div><dt>Reason</dt><dd>The implementation and required proof are ready.</dd></div>
              <div><dt>Action</dt><dd>Review the gesture recording and four criteria.</dd></div>
              <div><dt>Cost</dt><dd>About 3 minutes.</dd></div>
            </dl>
            <div class="attention-actions">
              <button class="shell-primary" type="button" data-action="review-work">Review work</button>
              <button class="shell-secondary" type="button" data-action="keep-working">Later</button>
            </div>
          </article>

          <article class="attention-card">
            <div class="attention-card-head">
              <span class="attention-kind">${statusDot("waiting")} Question</span>
              <time>8m ago</time>
            </div>
            <h3>Image generation is consistent</h3>
            <p class="attention-path">otto / dnd</p>
            <dl class="attention-contract">
              <div><dt>Reason</dt><dd>The agent found two raster-preservation options.</dd></div>
              <div><dt>Action</dt><dd>Choose which layer owns the generated pixels.</dd></div>
            </dl>
            <div class="attention-actions">
              <button class="shell-secondary" type="button" data-action="show-demo-toast">Open question</button>
            </div>
          </article>
        </div>

        <div class="drawer-footer">Nothing here forces a switch. Items stay until you review, defer, or dismiss them.</div>
      </aside>
    `,
    { path: "otto / tangent / UX Product Vision", attention: 2 }
  );
}

function renderReview() {
  return frame(
    `
      <div class="work-screen">
        ${workHead({
          active: "review",
          completed: ["understand", "execute"],
          eyebrow: "Assignment complete · review required",
          title: "Connection-first, partial-width ramps"
        })}

        <div class="phase-body review-grid">
          <section class="review-proof">
            <div class="review-intro">
              <div>
                <p class="eyebrow">Proof first</p>
                <h3>The same gesture creates and sizes the ramp.</h3>
              </div>
              <span class="run-duration">agent time 27m · review estimate 3m</span>
            </div>

            <div class="proof-scene" aria-label="Animated concept of a creature walking across a partial-width ramp">
              ${pin(1, "Visible proof appears before logs and implementation details.")}
              <div class="scene-grid"></div>
              <div class="platform left"></div>
              <div class="platform right"></div>
              <div class="ramp-shape"></div>
              <div class="creature">♞</div>
              <div class="scene-caption">${statusDot("done")} continuous path</div>
            </div>

            <div class="criteria-list">
              <div class="criterion">
                ${statusDot("done")}
                <span class="criterion-copy"><strong>One continuous gesture</strong><small>Press, connect, size, and release.</small></span>
                <button class="evidence-link" type="button" data-action="show-evidence">recording</button>
              </div>
              <div class="criterion">
                ${statusDot("done")}
                <span class="criterion-copy"><strong>Honest preview</strong><small>The final ramp matches the preview geometry.</small></span>
                <button class="evidence-link" type="button" data-action="show-evidence">2 tests</button>
              </div>
              <div class="criterion">
                ${statusDot("done")}
                <span class="criterion-copy"><strong>Shared geometry</strong><small>Preview, bake, navigation, and validation use one source.</small></span>
                <button class="evidence-link" type="button" data-action="show-evidence">diff</button>
              </div>
              <div class="criterion">
                ${statusDot("done")}
                <span class="criterion-copy"><strong>Existing volumes stay unchanged</strong><small>The ramp adds a connection without altering either volume.</small></span>
                <button class="evidence-link" type="button" data-action="show-evidence">test</button>
              </div>
            </div>

            <div class="review-secondary">
              <button class="shell-secondary" type="button" data-action="show-evidence">Open full diff</button>
              <button class="shell-secondary" type="button" data-action="show-evidence">Open terminal</button>
            </div>
          </section>

          <aside class="review-decision">
            <h3>Your decision</h3>
            <p>The agent stopped. The assignment is not accepted until you choose an action.</p>

            <article class="knowledge-proposal">
              ${pin(3, "A result and a knowledge change require separate approval.")}
              <p class="eyebrow">Proposed durable knowledge</p>
              <h4>Ramp width belongs to the creation gesture.</h4>
              <p>The same gesture determines connection, orientation, and width. Later editing handles are outside this outcome.</p>
              <span class="proposal-source">destination · D&amp;D product design / ramps</span>
              <div class="proposal-actions">
                <button class="shell-secondary" type="button" data-action="toggle-knowledge">${knowledgeSaved ? "✓ Saved to design" : "Accept knowledge"}</button>
                <button class="evidence-link" type="button" data-action="show-demo-toast">Edit</button>
              </div>
            </article>

            <div class="decision-actions">
              <button class="shell-primary" type="button" data-action="accept-result">Accept assignment</button>
              <button class="shell-secondary" type="button" data-action="request-changes">Request changes</button>
              <button class="shell-danger" type="button" data-action="propose-done">Propose parent outcome done…</button>
            </div>
            <p class="review-note">Accepting this assignment updates one child. It does not finish the parent outcome.</p>
          </aside>
        </div>
      </div>
    `,
    { path: "otto / dnd / Connection-first ramps", attention: 1 }
  );
}

function renderResume() {
  return frame(
    `
      <div class="resume-screen">
        <div class="resume-content">
          <div class="completion-line">${statusDot("done")} Connection-first ramps accepted</div>
          <article class="resume-card">
            ${pin(1, "The resume card restores identity, state, and the next unresolved action.")}
            <p class="eyebrow">Continue the parent outcome</p>
            <h2>Walk the whole loop</h2>
            <span class="resume-path">otto / dnd · 2 of 3 breakdown items complete</span>

            <div class="resume-context">
              <h3>Next unresolved step</h3>
              <p>Prove the complete experience by hand with real saved data. Start from an empty map and finish with creature movement.</p>
            </div>

            <div class="resume-actions">
              <button class="shell-primary" type="button" data-action="resume-next">Continue this outcome</button>
              <button class="shell-secondary" type="button" data-action="open-browse">Choose something else</button>
              <button class="shell-secondary" type="button" data-action="defer-next">Defer</button>
            </div>
          </article>
          <p class="resume-rule">Agent Shell offers this step because it is next in the approved breakdown. You still choose the work.</p>
        </div>
      </div>
    `,
    { path: "otto / dnd / Walk the whole loop", attention: 1 }
  );
}

function renderFastPath() {
  return frame(
    `
      <div class="work-screen">
        ${workHead({
          active: "understand",
          eyebrow: "otto / tangent / small fix",
          title: "Delete key edits text"
        })}

        <div class="phase-body">
          <div class="fast-path-banner">
            <span><strong>Short path:</strong> The expected behavior, scope, and proof are already clear.</span>
            <button class="evidence-link" type="button" data-action="show-demo-toast">Open Understand</button>
          </div>

          <div class="small-fix-body">
            <section class="small-brief">
              <article class="small-brief-card">
                ${pin(1, "Clear work receives a compact brief instead of a forced design discussion.")}
                <p class="eyebrow">Compact assignment</p>
                <h3>Restore Delete and Backspace inside text fields</h3>

                <div class="brief-field">
                  <h4>Observed</h4>
                  <p>The shell intercepts Delete while the outcome editor has focus. The key cannot remove text.</p>
                </div>

                <div class="brief-field">
                  <h4>Expected</h4>
                  <p>Delete and Backspace edit focused text. Tree and session actions stay inactive during text entry.</p>
                </div>

                <div class="brief-field">
                  <h4>Proof</h4>
                  <ul>
                    <li>Add a keyboard-focus regression test.</li>
                    <li>Do a manual edit in the Agent Shell outcome editor.</li>
                  </ul>
                </div>
              </article>
            </section>

            <aside class="fast-inspector">
              <article class="skip-card">
                ${pin(2, "The shell names which ceremony it skipped and why.")}
                <strong>No unresolved product decision</strong>
                <p>No design document is required. The focused element owns text-editing keys.</p>
              </article>

              <section class="inspector-group">
                <h4>Source</h4>
                <div class="source-row"><span class="source-icon">O</span><span>Delete key does not let me delete text</span><small>outcome</small></div>
              </section>

              <section class="inspector-group">
                <h4>Agent</h4>
                <select class="agent-select" aria-label="Agent for the small fix">
                  <option>Codex · inherited from tangent</option>
                  <option>Claude · Opus 4.1</option>
                </select>
              </section>

              <div class="brief-actions">
                <button class="shell-primary" type="button" data-action="start-small-fix">${smallFixStarted ? "Agent started ✓" : "Start fix"}</button>
                <button class="shell-secondary" type="button" data-action="show-demo-toast">Edit brief</button>
              </div>
            </aside>
          </div>
        </div>
      </div>
    `,
    { path: "otto / tangent / Delete key edits text", attention: 1 }
  );
}

function renderImprove() {
  return frame(
    `
      <div class="mark-screen">
        <section class="mark-conversation">
          <p class="eyebrow" style="max-width:700px;margin:0 auto 12px">Conversation · UX Product Vision</p>

          <article class="mark-turn">
            <strong>Julian</strong>
            <p>Let us have a discussion. I want to understand the product, not skim another large AI document.</p>
          </article>

          <article class="mark-turn bad-turn">
            <strong>Agent</strong>
            <p>Here is a complete product vision with contracts, objects, surfaces, principles, research findings, and implementation recommendations…</p>
          </article>

          <article class="mark-turn">
            <strong>Julian</strong>
            <p>This is an example of an AI agent producing more than I can comprehend. Let us go through it one by one.</p>
          </article>

          <div class="mark-action-row">
            <button class="shell-danger" type="button" data-action="save-mark">${markSaved ? "Marked ✓" : "Mark this moment"}</button>
          </div>
        </section>

        <aside class="mark-capture">
          <div class="mark-capture-head">
            ${pin(1, "The live conversation supplies evidence. Capture does not require a new tool.")}
            <h3>Capture agent failure</h3>
            <p>The current model drafted this diagnosis from the selected moment.</p>
          </div>

          <div class="capture-field">
            <label>Observed</label>
            <div class="capture-value">The agent returned a large specification during a discussion about product understanding.</div>
          </div>

          <div class="capture-field">
            <label>Expected</label>
            <div class="capture-value">Present one concrete workflow and wait for Julian to discuss it before adding another.</div>
          </div>

          <div class="capture-field">
            <label>Likely remedy</label>
            <div class="capture-value">Add a discussion mode that limits each turn to one decision and one visible artifact.</div>
          </div>

          <div class="capture-evidence">${statusDot("done")} Three conversation turns attached</div>

          <div class="capture-actions">
            <button class="shell-primary" type="button" data-action="save-mark">${markSaved ? "Saved for later diagnosis" : "Save mark"}</button>
            <button class="shell-secondary" type="button" data-action="show-demo-toast">Edit diagnosis</button>
          </div>
        </aside>
      </div>
    `,
    { path: "otto / tangent / UX Product Vision", attention: 1 }
  );
}

function renderSystem() {
  const objects = [
    ["N", "Node", "A durable subject or project.", "vault directory"],
    ["O", "Outcome", "The result and its done condition.", "outcome markdown"],
    ["U", "Understanding", "Settled decisions and boundaries.", "outcome + design"],
    ["A", "Assignment", "The exact approved agent job.", "run record"],
    ["R", "Run", "Temporary execution and activity.", "tmux + transcript"],
    ["!", "Attention", "A useful decision that is ready.", "derived view"],
    ["P", "Proof", "Evidence against approved criteria.", "git + artifacts"]
  ];

  return frame(
    `
      <div class="system-screen">
        <div class="system-head">
          <p class="eyebrow">The complete product model</p>
          <h2>One work surface connects durable intent to temporary execution.</h2>
          <p>Agent Shell is the daily product. Local files and tools remain the inspectable foundations beneath it.</p>
        </div>

        <div>
          <div class="system-flow">
            ${objects
              .map(
                ([icon, name, description, home], index) => `
                  <article class="system-object">
                    ${index === 1 ? pin(1, "The outcome remains the durable center of work.") : ""}
                    ${index === 3 ? pin(2, "The approved assignment is the missing bridge between intent and execution.") : ""}
                    ${index === 5 ? pin(3, "Attention is a derived view, never another task database.") : ""}
                    <div class="object-icon">${icon}</div>
                    <strong>${name}</strong>
                    <p>${description}</p>
                    <span class="object-home">${home}</span>
                  </article>
                `
              )
              .join("")}
          </div>

          <div class="system-rules">
            <article class="system-rule">
              <strong>One product surface</strong>
              <p>Usage, marks, and evals supply evidence inside Agent Shell. They do not compete for daily attention.</p>
            </article>
            <article class="system-rule">
              <strong>One home for each fact</strong>
              <p>The shell edits or projects canonical local sources. It does not create hidden truth.</p>
            </article>
            <article class="system-rule">
              <strong>One human authority</strong>
              <p>Agents research, execute, and propose. Julian chooses meaning, priority, acceptance, and completion.</p>
            </article>
          </div>
        </div>

        <div class="system-close">
          <button class="shell-primary" type="button" data-action="restart">Walk through again</button>
        </div>
      </div>
    `,
    { path: "Agent Shell / Complete product", attention: 1 }
  );
}

const renderers = [
  renderPromise,
  renderBrowse,
  renderUnderstand,
  renderAssignment,
  renderRun,
  renderReturn,
  renderReview,
  renderResume,
  renderFastPath,
  renderImprove,
  renderSystem
];

function renderChapterList() {
  chapterList.innerHTML = chapters
    .map(
      (chapter, index) => `
        <li>
          <button class="chapter-button${index === currentChapter ? " active" : ""}" type="button" data-chapter="${index}">
            <span class="chapter-index">${String(index).padStart(2, "0")}</span>
            <span class="chapter-label">${chapter.title}</span>
          </button>
        </li>
      `
    )
    .join("");
}

function render() {
  const chapter = chapters[currentChapter];
  chapterKicker.textContent = chapter.kicker;
  chapterTitle.textContent = chapter.title;
  chapterStory.textContent = chapter.story;
  chapterMove.textContent = chapter.move;
  chapterReasons.innerHTML = chapter.reasons
    .map(
      (reason, index) => `
        <li><span class="reason-number">${index + 1}</span><span>${reason}</span></li>
      `
    )
    .join("");
  chapterPrinciples.innerHTML = chapter.principles.map((principle) => `<span class="principle-chip">${principle}</span>`).join("");
  stepCount.textContent = `${String(currentChapter + 1).padStart(2, "0")} / ${String(chapters.length).padStart(2, "0")}`;
  footerSummary.textContent = chapter.summary;
  previousButton.disabled = currentChapter === 0;
  nextButton.disabled = currentChapter === chapters.length - 1;
  nextButton.textContent = currentChapter === chapters.length - 2 ? "Whole product →" : "Next →";
  shell.innerHTML = renderers[currentChapter]();
  renderChapterList();
}

function goToChapter(index) {
  currentChapter = Math.max(0, Math.min(chapters.length - 1, index));
  render();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function restart() {
  currentChapter = 0;
  browseSelection = "walk-loop";
  finalDecision = false;
  knowledgeSaved = false;
  smallFixStarted = false;
  markSaved = false;
  render();
}

document.addEventListener("click", (event) => {
  const chapterButton = event.target.closest("[data-chapter]");
  if (chapterButton) {
    goToChapter(Number(chapterButton.dataset.chapter));
    return;
  }

  const outcomeButton = event.target.closest("[data-select-outcome]");
  if (outcomeButton) {
    browseSelection = outcomeButton.dataset.selectOutcome;
    render();
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  const action = actionButton.dataset.action;

  const actions = {
    next: () => goToChapter(currentChapter + 1),
    previous: () => goToChapter(currentChapter - 1),
    restart,
    "open-browse": () => goToChapter(1),
    "open-attention": () => goToChapter(5),
    "start-understand": () => goToChapter(2),
    "fast-path": () => goToChapter(8),
    "settle-decision": () => {
      finalDecision = true;
      render();
      showToast("Decision saved. Shared understanding now has four settled decisions.");
    },
    "review-understanding": () => {
      if (finalDecision) goToChapter(3);
    },
    "send-reply": () => showToast("Your reply will update the shared understanding before execution."),
    "approve-brief": () => goToChapter(4),
    "discuss-brief": () => {
      goToChapter(2);
      showToast("The assignment did not start. The discussion is open again.");
    },
    "leave-running": () => goToChapter(5),
    "stop-demo-run": () => showToast("In the real shell, Stop ends the bound session after confirmation."),
    "review-work": () => goToChapter(6),
    "keep-working": () => showToast("The result stays in Needs you. Your current work remains in front."),
    "show-evidence": () => showToast("Detailed evidence opens in place without replacing the review summary."),
    "toggle-knowledge": () => {
      knowledgeSaved = !knowledgeSaved;
      render();
      showToast(knowledgeSaved ? "Knowledge proposal accepted with Git provenance." : "Knowledge proposal returned to draft state.");
    },
    "accept-result": () => goToChapter(7),
    "request-changes": () => showToast("The assignment returns to Execute with your review note attached."),
    "propose-done": () => showToast("The shell asks for explicit confirmation before it marks the parent outcome done."),
    "resume-next": () => showToast("The shell opens a new assignment for the next approved breakdown item."),
    "defer-next": () => showToast("The next step stays with the outcome and leaves the current view."),
    "start-small-fix": () => {
      smallFixStarted = true;
      render();
      showToast("The compact assignment started. No extra design artifact was created.");
    },
    "save-mark": () => {
      markSaved = true;
      render();
      showToast("Mark saved with the selected conversation evidence.");
    },
    "show-demo-toast": () => showToast("This notebook shows the interaction without changing real work."),
    "discuss-changes": () => showToast("Discussion returns to the same shared-understanding surface.")
  };

  if (actions[action]) actions[action]();
});

document.addEventListener("input", (event) => {
  if (event.target.id !== "work-search") return;
  const query = event.target.value.trim().toLowerCase();
  document.querySelectorAll("[data-search]").forEach((element) => {
    element.hidden = query.length > 0 && !element.dataset.search.toLowerCase().includes(query);
  });
});

previousButton.addEventListener("click", () => goToChapter(currentChapter - 1));
nextButton.addEventListener("click", () => goToChapter(currentChapter + 1));
restartButton.addEventListener("click", restart);

explainToggle.addEventListener("click", () => {
  explanations = !explanations;
  explainToggle.setAttribute("aria-pressed", String(explanations));
  explainToggle.lastChild.textContent = explanations ? " Explanations on" : " Explanations off";
  render();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "ArrowRight" && !event.target.matches("input, textarea, select")) {
    goToChapter(currentChapter + 1);
  }
  if (event.key === "ArrowLeft" && !event.target.matches("input, textarea, select")) {
    goToChapter(currentChapter - 1);
  }
});

render();
