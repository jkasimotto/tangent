const scenes = [
  {
    kicker: "01 — Return",
    title: "Reload the thought before the controls",
    summary: "The first screen restores the requested result, the short story, and the documents that carry the work.",
    human: "Interruptions erase working context. A result title alone does not restore a useful mental model.",
    model: "Chat history is complete but expensive to reread. A generated summary can also drift.",
    response: "Show one requested-result line, one short story, and linked documents. Keep the native agent at the bottom.",
  },
  {
    kicker: "02 — Chat",
    title: "Keep the native agent chat whole",
    summary: "Agent Shell adds context and return controls around the chat. It does not replace the chat.",
    human: "People need complete agent messages and tool activity before they can judge or direct the work.",
    model: "The native agent interface already shows provider features, tool activity, history, and its composer.",
    response: "Open the native chat unchanged. Keep Summary, goal context, and Stop agent in the shell chrome.",
  },
  {
    kicker: "03 — Describe",
    title: "Define work through a native conversation",
    summary: "Julian speaks freely first. An Area-scoped agent helps him find the useful Goal boundaries.",
    human: "People often know the situation they want to change before they know the correct work structure.",
    model: "A one-shot conversion splits work too early and hides the judgment behind generated form fields.",
    response: "Open the native agent in the Area repository. Discuss exact Goals and Subgoals before the agent writes them.",
  },
  {
    kicker: "04 — Organize",
    title: "Give durable Areas one clear home",
    summary: "The Areas action opens the hierarchy alone. Empty Areas remain visible without becoming fake work.",
    human: "People need a stable map of subjects. They do not need that complete map beside every goal or agent message.",
    model: "Moving one Area changes every descendant path. A conversational request can hide that complete effect.",
    response: "Put Areas on the Work screen. Show one full-screen tree with New nested Area, Rename, and Move actions. Preview every changed path.",
  },
  {
    kicker: "05 — Programs",
    title: "Keep operational programs near their areas",
    summary: "Programs gathers live processes, on-demand commands, and scheduled agent routines without turning them into goals.",
    human: "People need to find a running server quickly. They also need quiet confidence that a daily agent will run once.",
    model: "A command can stop while its tmux session remains useful. A scheduled agent can overlap or repeat unless the scheduler prevents duplicates.",
    response: "Group programs by area. Show true process state, open the native tmux session, and give schedules an explicit next-run and catch-up rule.",
  },
  {
    kicker: "06 — Leave",
    title: "Support unattended work at the moment it matters",
    summary: "The goal summary states the live assignment. Sleep prevention sits beside the working state.",
    human: "People want to leave long work alone. Hidden system controls create doubt before they walk away.",
    model: "An agent can work for a long time, but terminal activity does not prove useful progress.",
    response: "Show purpose and truthful state. Offer one contextual keep-awake control. Hide the terminal by default.",
  },
  {
    kicker: "07 — Continue",
    title: "Read one Document at a time",
    summary: "One centered Document stays dominant. History, Document choice, the page outline, and Open agent remain quiet at the edge.",
    human: "A persistent Goal index competes with the prose. Two complete surfaces create more visual decisions than the reader needs.",
    model: "The linked Goal can supply complete agent context without occupying the reading surface.",
    response: "Use a calm reader with familiar history controls, a compact Document picker, a quiet outline, and a separate native-agent screen.",
  },
];

let currentScene = 0;
let rationaleVisible = true;
let describing = false;
let awake = false;
let organizeMode = "tree";
let programView = "list";
let dndServerRunning = true;
let dndStopConfirm = false;
let readerAgentOpen = false;
let selectedReviewDocument = "design";
let reviewTrail = ["design"];
let reviewTrailIndex = 0;
let toastTimer = null;

const demoShell = document.querySelector("#demo-shell");
const sceneCount = document.querySelector("#scene-count");
const sceneKicker = document.querySelector("#scene-kicker");
const sceneTitle = document.querySelector("#scene-title");
const sceneSummary = document.querySelector("#scene-summary");
const humanLimit = document.querySelector("#human-limit");
const modelLimit = document.querySelector("#model-limit");
const productResponse = document.querySelector("#product-response");
const rationale = document.querySelector("#rationale");
const rationaleToggle = document.querySelector("#rationale-toggle");
const previousScene = document.querySelector("#previous-scene");
const nextScene = document.querySelector("#next-scene");
const sceneDots = document.querySelector("#scene-dots");
const visionToast = document.querySelector("#vision-toast");

/** Renders the stable Agent Shell bar around one focused surface. */
function shellBar({ back = "Work", backAction = "previous", context = "Otto / Tangent · UX Product Vision", actions = "" } = {}) {
  return `
    <header class="shell-bar">
      <button class="shell-bar-button" type="button" data-action="${backAction}">${back === "Agent Shell" ? "" : "← "}${back}</button>
      <div class="shell-context">${context}</div>
      <div class="shell-actions">${actions}</div>
    </header>
  `;
}

/** Renders the current goal's read-only area path. */
function areaPath() {
  return `<div class="area-path"><span>Otto</span><span>Tangent</span></div>`;
}

/** Renders the compact sequence of meaningful product decisions. */
function storySoFar({ open = false } = {}) {
  return `
    <details class="story-details" ${open ? "open" : ""}>
      <summary>Story so far · 5 meaningful moments</summary>
      <ol class="timeline">
        <li><time>First use</time><div><strong>The phase dashboard failed.</strong><p>It showed system concepts before it restored context.</p></div></li>
        <li><time>Second use</time><div><strong>The context-first shell worked.</strong><p>Area, result, progress, and agent state became clear.</p></div></li>
        <li><time>Third use</time><div><strong>The summary gained durable memory.</strong><p>One requested result and a short history support return.</p></div></li>
        <li><time>Fourth use</time><div><strong>Native chat remained central.</strong><p>Agent Shell augments the chat instead of replacing it.</p></div></li>
        <li><time>Now</time><div><strong>The goal-first view failed.</strong><p>Stable areas and flexible work boundaries now serve different jobs.</p></div></li>
      </ol>
    </details>
  `;
}

/** Renders the context-first goal summary. */
function renderReturn() {
  return `
    ${shellBar({ actions: `${dndServerRunning ? `<button class="shell-bar-button" type="button" data-action="programs"><span class="live-indicator" aria-hidden="true"></span>1 program</button>` : ""}<button class="shell-bar-button" type="button">Find work&nbsp; ⌘/</button>` })}
    <main class="shell-screen">
      <article class="reading-page">
        ${areaPath()}
        <h1 class="goal-title">UX Product Vision</h1>

        <section class="brief-card">
          <p class="eyebrow">Current brief</p>
          <h2>Agent Shell organizes work around the subject and boundary that make sense to you.</h2>
        </section>

        <section class="memory-section">
          <div class="memory-head"><h3>Story so far</h3><span>Meaningful changes only</span></div>
          ${storySoFar({ open: true })}
        </section>

        <section class="memory-section">
          <div class="memory-head"><h3>Documents</h3><span>3 linked Documents</span></div>
          <div class="document-row"><div><strong>Use Case Documentation</strong><small>Document</small></div><button class="quiet-button" type="button" data-action="document">Read</button></div>
          <div class="document-row"><div><strong>Principles of a Good Solution</strong><small>Document</small></div><button class="quiet-button" type="button" data-action="document">Read</button></div>
          <div class="document-row"><div><strong>Design Document: Live Edit Collaboration</strong><small>Document</small></div><button class="quiet-button" type="button" data-action="document">Read</button></div>
        </section>

        <section class="agent-card">
          <div class="agent-state"><span class="state-dot" aria-hidden="true"></span><div><h3>Codex is waiting for you.</h3><p>Open the complete native chat to read its message and reply.</p></div></div>
          <div class="action-row">
            <button class="primary-button" type="button" data-action="next">Reply to Codex</button>
            <button class="secondary-button" type="button">Choose next step…</button>
          </div>
        </section>
      </article>
    </main>
  `;
}

/** Renders the complete native agent-chat concept. */
function renderChat() {
  return `
    ${shellBar({ back: "Summary", actions: `<button class="shell-bar-button danger" type="button">Stop agent…</button>` })}
    <main class="shell-screen native-chat-screen">
      <section class="native-chat" aria-label="Native Codex chat">
        <div class="native-chat-heading">
          <span>&gt;_</span>
          <strong>OpenAI Codex</strong>
          <small>Native agent surface</small>
        </div>
        <div class="native-transcript">
          <div class="native-user"><span>›</span><p>Keep the chat central. I want Agent Shell to augment this experience, not replace it.</p></div>
          <div class="native-tool"><span>• Read</span><code>design-tangent.md</code></div>
          <div class="native-tool"><span>• Read</span><code>goal-ux-product-vision.md</code></div>
          <div class="native-agent">
            <p>That creates a cleaner boundary.</p>
            <p>The native chat remains the complete place for messages, tool activity, and feedback. Agent Shell adds three things around it:</p>
            <ul>
              <li>a summary before you enter the chat</li>
              <li>stable Summary and Stop agent controls while you are here</li>
              <li>a concise story for the next return</li>
            </ul>
            <p>I will remove the second composer and the separate memory screen.</p>
          </div>
        </div>
        <div class="native-composer"><span>›</span><span class="composer-placeholder">Reply in Codex…</span><kbd>⌘↵</kbd></div>
      </section>
    </main>
  `;
}

const originalDescription = "I want to make the complete D&D scene workflow reliable. I care about terrain generation, sprite cutouts, ramps, and movement. I want one coherent experience, but I also want to finish one useful result at a time. My proposed subgoals is useful context, not a fixed execution plan.";

/** Renders natural work capture and its native agent conversation. */
function renderDescribe() {
  if (!describing) {
    return `
      ${shellBar({ back: "Work", context: "Describe new work" })}
      <main class="shell-screen">
        <article class="describe-page">
          <header class="describe-head"><p class="eyebrow">New work</p><h1>What do you want to work out?</h1><p>Speak or type the whole thought. Then continue with an agent that knows this Area.</p></header>
          <form class="capture-card" data-describe-form>
            <label><span>Area</span><select><option>Otto / D&amp;D</option><option>Otto / Tangent</option></select></label>
            <label><span>Your description</span><textarea>${originalDescription}</textarea></label>
            <div class="action-row"><button class="primary-button" type="submit">Open agent</button><button class="quiet-button" type="button" data-action="save-idea">Save as an idea</button></div>
          </form>
        </article>
      </main>
    `;
  }

  return `
    ${shellBar({ back: "Work", context: "Otto / D&D · Defining work · Waiting for you", actions: `<button class="shell-bar-button danger" type="button">Stop agent…</button>` })}
    <main class="shell-screen native-chat-screen">
      <section class="native-chat" aria-label="Native conversation about new work">
        <div class="native-chat-heading"><span>&gt;_</span><strong>OpenAI Codex</strong><small>Otto / D&amp;D repository</small></div>
        <div class="native-transcript">
          <div class="native-user"><span>›</span><p>${originalDescription}</p></div>
          <div class="native-tool"><span>• Read</span><code>otto/dnd/dnd.md</code></div>
          <div class="native-tool"><span>• Explore</span><code>Otto D&amp;D repository</code></div>
          <div class="native-agent">
            <p>I see one broad experience and three results that might need separate focus.</p>
            <p>Before I create Goals, let us decide whether generation, sprite cutouts, and ramp movement can finish independently.</p>
            <p>I will show the exact Goal names, done conditions, and links before I write them.</p>
          </div>
        </div>
        <div class="native-composer"><span>›</span><span class="composer-placeholder">Continue defining the work…</span><kbd>⌘↵</kbd></div>
      </section>
    </main>
  `;
}

/** Renders one row in the temporary Area hierarchy. */
function areaRow({ name, path, depth = 0, selected = false, parent = false }) {
  return `
    <button class="area-row ${selected ? "selected" : ""} ${parent ? "parent" : ""}" style="--area-depth: ${depth}" type="button" data-area-row="${path}">
      <span class="area-disclosure" aria-hidden="true">${parent ? "⌄" : ""}</span>
      <span>${name}</span>
      ${selected ? `<span class="selected-label">Selected</span>` : ""}
    </button>
  `;
}

/** Renders the temporary area hierarchy and its direct structural actions. */
function renderAreaTree() {
  return `
    ${shellBar({ back: "Work", backAction: "work", context: "Areas" })}
    <main class="shell-screen">
      <article class="areas-page">
        <header class="areas-head">
          <div><p class="eyebrow">Areas</p><h1>Where work belongs.</h1><p>This view contains areas only. Goals remain on the Work screen.</p></div>
          <button class="primary-button" type="button" data-action="new-root-area">New area</button>
        </header>

        <section class="area-tree-card" aria-label="Area hierarchy">
          ${areaRow({ name: "Neara", path: "neara", parent: true })}
          ${areaRow({ name: "Essential", path: "neara/essential", depth: 1 })}
          ${areaRow({ name: "Hackathon", path: "neara/hackathon", depth: 1, selected: true, parent: true })}
          ${areaRow({ name: "Live Edit", path: "neara/hackathon/live-edit", depth: 2 })}
          ${areaRow({ name: "Hedno", path: "neara/hedno", depth: 1 })}
          ${areaRow({ name: "PG&E", path: "neara/pgande", depth: 1, parent: true })}
          ${areaRow({ name: "Portland", path: "neara/portland", depth: 1, parent: true })}
          ${areaRow({ name: "Python", path: "neara/pyth", depth: 1 })}
          ${areaRow({ name: "Otto", path: "otto", parent: true })}
          ${areaRow({ name: "D&D", path: "otto/dnd", depth: 1, parent: true })}
          ${areaRow({ name: "Tangent", path: "otto/tangent", depth: 1 })}
        </section>

        <section class="area-selection-card">
          <div><p class="eyebrow">Neara / Hackathon</p><h2>Hackathon</h2><p>Live Edit belongs below this area.</p></div>
          <div class="action-row"><button class="primary-button" type="button" data-action="new-nested-area">New nested Area</button><button class="secondary-button" type="button" data-action="move-area">Move…</button><button class="quiet-button" type="button" data-action="rename-area">Rename</button></div>
        </section>

        <p class="areas-principle">The hierarchy disappears when you return to work. Area breadcrumbs elsewhere remain read-only.</p>
      </article>
    </main>
  `;
}

/** Renders a focused form for a root or nested Area. */
function renderNewArea({ root = false } = {}) {
  const parent = root ? "Top level" : "Neara / Hackathon";
  return `
    ${shellBar({ back: "Areas", backAction: "area-tree", context: root ? "New Area" : "Neara / Hackathon · New nested Area" })}
    <main class="shell-screen">
      <article class="area-action-page">
        <p class="eyebrow">New Area</p>
        <h1>${root ? "Add a top-level Area." : "Add an Area below Hackathon."}</h1>
        <form class="area-action-form" data-area-create-form data-area-parent="${root ? "root" : "neara/hackathon"}">
          <label><span>${root ? "Location" : "Inside"}</span><div class="fixed-path">${parent}</div></label>
          <label><span>Name</span><input value="${root ? "New area" : "Demo area"}" aria-label="Area name" required /></label>
          <div class="action-row"><button class="primary-button" type="submit">Create Area</button><button class="quiet-button" type="button" data-action="cancel-area-action">Cancel</button></div>
        </form>
        <p class="area-action-note">This creates a place for future work. It does not create a Goal or start an agent.</p>
      </article>
    </main>
  `;
}

/** Renders the complete path effect before an Area move. */
function renderMoveArea() {
  return `
    ${shellBar({ back: "Areas", backAction: "area-tree", context: "Move Hackathon" })}
    <main class="shell-screen">
      <article class="area-action-page move-area-page">
        <p class="eyebrow">Move Area</p>
        <h1>Move Hackathon and everything below it.</h1>
        <label class="move-destination"><span>Move inside</span><select><option>Otto</option><option>Neara</option><option>Otto / D&D</option><option>Otto / Tangent</option></select></label>
        <section class="move-preview">
          <p class="eyebrow">Path preview</p>
          <div class="path-change"><span>Before</span><code>neara/hackathon</code><span aria-hidden="true">→</span><code>otto/hackathon</code></div>
          <div class="path-change descendant"><span>Nested Area</span><code>neara/hackathon/live-edit</code><span aria-hidden="true">→</span><code>otto/hackathon/live-edit</code></div>
        </section>
        <div class="action-row"><button class="primary-button" type="button" data-action="confirm-area-move">Move area</button><button class="quiet-button" type="button" data-action="cancel-area-action">Cancel</button></div>
        <p class="area-action-note">The preview shows every changed path before Agent Shell writes the move.</p>
      </article>
    </main>
  `;
}

/** Selects the current area-organization subview. */
function renderOrganize() {
  if (organizeMode === "new-nested-area") return renderNewArea();
  if (organizeMode === "new-root") return renderNewArea({ root: true });
  if (organizeMode === "move") return renderMoveArea();
  return renderAreaTree();
}

/** Renders one area-owned program with truthful state and one obvious action. */
function programRow({ name, kind, state, detail, action = "Open", id, running = false }) {
  return `
    <button class="program-row" type="button" data-program="${id}">
      <span class="program-state ${running ? "running" : ""}" aria-hidden="true"></span>
      <span class="program-main"><strong>${name}</strong><span>${detail}</span></span>
      <span class="program-kind">${kind}</span>
      <span class="program-status"><strong>${state}</strong><small>${action} →</small></span>
    </button>
  `;
}

/** Renders the area-grouped index of processes, commands, and agent routines. */
function renderProgramList() {
  const liveAction = dndServerRunning ? `<button class="shell-bar-button" type="button"><span class="live-indicator" aria-hidden="true"></span>1 running</button>` : "";
  return `
    ${shellBar({ back: "Work", backAction: "work", context: "Programs", actions: liveAction })}
    <main class="shell-screen">
      <article class="programs-page">
        <header class="programs-head"><div><p class="eyebrow">Programs</p><h1>Things that run.</h1><p>Open a live session, start a known command, or inspect an agent schedule.</p></div><button class="primary-button" type="button" data-action="new-program">New program</button></header>

        <section class="program-section">
          <div class="program-section-head"><h2>Otto / D&amp;D</h2><span>${dndServerRunning ? "1 running" : "1 program"}</span></div>
          ${programRow({ name: "Development server", kind: "Process", state: dndServerRunning ? "Running" : "Stopped", detail: dndServerRunning ? "npm run dev:hmr · tmux session available" : "Stopped · tmux scrollback remains available", id: "dnd-server", running: dndServerRunning })}
        </section>

        <section class="program-section">
          <div class="program-section-head"><h2>Neara / PG&amp;E / Dev</h2><span>1 program</span></div>
          ${programRow({ name: "Daily remediation run", kind: "Agent routine", state: "Next 07:30", detail: "Runs once daily · one missed run catches up at the next available time", id: "daily-agent" })}
        </section>

        <section class="program-section">
          <div class="program-section-head"><h2>Neara</h2><span>3 programs</span></div>
          ${programRow({ name: "Run client", kind: "Command", state: "Ready", detail: "Starts in a visible tmux session", id: "neara-client", action: "Run" })}
          ${programRow({ name: "Release", kind: "Command", state: "Ready", detail: "Requires confirmation before it starts", id: "neara-release", action: "Review" })}
          ${programRow({ name: "Deploy", kind: "Command", state: "Ready", detail: "Requires confirmation before it starts", id: "neara-deploy", action: "Review" })}
        </section>

        <p class="programs-principle">Programs belong to areas. They do not become goals unless the result itself needs tracked work.</p>
      </article>
    </main>
  `;
}

/** Renders controls and the native tmux entry for the D&D server. */
function renderDndProgram() {
  return `
    ${shellBar({ back: "Programs", backAction: "program-list", context: "Otto / D&D · Development server" })}
    <main class="shell-screen">
      <article class="program-detail-page">
        <div class="area-path"><span>Otto</span><span>D&amp;D</span></div>
        <p class="eyebrow">Process</p>
        <h1>Development server</h1>
        <section class="program-hero ${dndServerRunning ? "running" : "stopped"}">
          <div><span class="program-state ${dndServerRunning ? "running" : ""}"></span><div><h2>${dndServerRunning ? "Running" : "Stopped"}</h2><p>${dndServerRunning ? "The process is active in its tmux session." : "The tmux session remains available with its scrollback."}</p></div></div>
          <div class="action-row"><button class="primary-button" type="button" data-action="open-program-session">Open session</button>${dndServerRunning ? `<button class="secondary-button" type="button" data-action="restart-dnd-server">Restart</button><button class="danger-button" type="button" data-action="stop-dnd-server">Stop…</button>` : `<button class="primary-button" type="button" data-action="start-dnd-server">Start</button><button class="quiet-button" type="button">Close session…</button>`}</div>
        </section>
        ${dndStopConfirm ? `<section class="program-confirm" role="alertdialog" aria-labelledby="stop-program-title"><div><strong id="stop-program-title">Stop the D&amp;D server?</strong><p>The command will end. The tmux session and its scrollback will remain.</p></div><div class="action-row"><button class="danger-button" type="button" data-action="confirm-stop-dnd-server">Stop server</button><button class="quiet-button" type="button" data-action="cancel-stop-dnd-server">Keep running</button></div></section>` : ""}
        <dl class="program-facts"><div><dt>Command</dt><dd><code>npm run dev:hmr</code></dd></div><div><dt>Working directory</dt><dd>Otto D&amp;D repository</dd></div><div><dt>Session</dt><dd><code>process-dnd--hmr-7cbba254</code></dd></div><div><dt>Ownership</dt><dd>This program belongs to Otto / D&amp;D.</dd></div></dl>
      </article>
    </main>
  `;
}

/** Renders schedule, catch-up, and session rules for one agent routine. */
function renderDailyAgentProgram() {
  return `
    ${shellBar({ back: "Programs", backAction: "program-list", context: "Neara / PG&E / Dev · Daily remediation run" })}
    <main class="shell-screen">
      <article class="program-detail-page">
        <div class="area-path"><span>Neara</span><span>PG&amp;E</span><span>Dev</span></div>
        <p class="eyebrow">Scheduled agent routine</p>
        <h1>Daily remediation run</h1>
        <section class="schedule-card">
          <div class="next-run"><small>Next run</small><strong>Tomorrow at 07:30</strong><span>Europe/Athens · as close as possible</span></div>
          <div class="action-row"><button class="primary-button" type="button" data-action="run-daily-now">Run now</button><button class="secondary-button" type="button">Edit schedule</button><button class="quiet-button" type="button">Pause</button></div>
        </section>
        <dl class="program-facts"><div><dt>Work</dt><dd>An agent reads the PG&amp;E daily procedure and performs one remediation run.</dd></div><div><dt>Catch-up</dt><dd>If this Mac misses 07:30, Tangent starts one run at the next available time.</dd></div><div><dt>Overlap</dt><dd>If the prior run is live, Tangent skips the duplicate and reports the conflict.</dd></div><div><dt>Last run</dt><dd>Yesterday at 07:34 · Complete · 42 minutes</dd></div></dl>
        <section class="recent-run"><div><span class="program-state"></span><div><strong>Last agent session</strong><p>The complete native agent session remains available for inspection.</p></div></div><button class="secondary-button" type="button" data-action="open-program-session">Open session</button></section>
      </article>
    </main>
  `;
}

/** Selects the program index or one program detail. */
function renderPrograms() {
  if (programView === "dnd-server") return renderDndProgram();
  if (programView === "daily-agent") return renderDailyAgentProgram();
  return renderProgramList();
}

/** Renders the quiet state for an unattended agent run. */
function renderWorking() {
  return `
    ${shellBar({ actions: `${dndServerRunning ? `<button class="shell-bar-button" type="button" data-action="programs"><span class="live-indicator" aria-hidden="true"></span>1 program</button>` : ""}<button class="shell-bar-button danger" type="button">Stop agent…</button>` })}
    <main class="shell-screen">
      <article class="reading-page">
        ${areaPath()}
        <h1 class="goal-title">UX Product Vision</h1>
        <section class="assignment-card"><p class="eyebrow">What Codex is doing now</p><h2>Build the context around the native agent chat</h2><p>Show re-entry, conversational work definition, readable documents, and unattended execution.</p></section>
        <section class="agent-card working">
          <div class="agent-state"><span class="state-dot" aria-hidden="true"></span><div><h3>Codex is working.</h3><p>Started 8 minutes ago. You do not need to watch it.</p></div></div>
          <button class="awake-control ${awake ? "on" : ""}" type="button" data-action="awake" aria-pressed="${awake}">
            <span class="awake-icon" aria-hidden="true">☕</span>
            <span class="awake-copy"><strong>${awake ? "Mac stays awake" : "Keep Mac awake"}</strong><small>${awake ? "Until you turn this off or quit Agent Shell." : "Useful while an agent works."}</small></span>
            <span class="awake-switch" aria-hidden="true"><span></span></span>
          </button>
          <div class="action-row"><button class="secondary-button" type="button">Open agent details</button><button class="quiet-button" type="button">Choose next step…</button></div>
        </section>
        <section class="memory-section"><div class="memory-head"><h3>Context is ready for your return</h3><span>Updated during the run</span></div><p class="checkpoint-quote">The current brief and story remain available. The native chat keeps the complete exchange.</p></section>
      </article>
    </main>
  `;
}

const reviewDocuments = {
  useCases: { title: "Live Edit use cases", file: "use-case-documentation.md" },
  principles: { title: "Principles of a good solution", file: "principles-of-a-good-solution.md" },
  design: { title: "Design Document: Live Edit Collaboration", file: "design-live-edit-collaboration.md" },
};

/** Returns the useful headings for the selected Document. */
function reviewHeadings() {
  return selectedReviewDocument === "design"
    ? ["Problem", "Shared state", "Recommended direction"]
    : selectedReviewDocument === "principles"
      ? ["Shared boundaries are explicit and small", "Observable behavior wins"]
      : ["Co-edit", "Observe"];
}

/** Renders the selected Document content for the calm reader. */
function productDocument() {
  const document = reviewDocuments[selectedReviewDocument];
  const content = selectedReviewDocument === "design" ? `
    <h2>Problem</h2>
    <p>Several people need to edit one project while keeping personal layouts, cameras, cursors, and selections.</p>
    <p>The complete use cases and <button class="vision-doc-link" type="button" data-review-document="principles">principles of a good solution</button> remain separate Documents.</p>
    <h2>Shared state</h2>
    <div class="vision-table-wrap"><table><thead><tr><th>State</th><th>Scope</th><th>Transport</th></tr></thead><tbody><tr><td>Project edits</td><td>Shared</td><td>Operations</td></tr><tr><td>Cursor position</td><td>Presence</td><td>Ephemeral</td></tr><tr><td>Camera</td><td>Personal</td><td>Presence when followed</td></tr></tbody></table></div>
    <h2>Recommended direction</h2>
    <p>Use a semantics-free server relay with sequence numbers. Keep personal state outside the durable project stream.</p>` : selectedReviewDocument === "principles" ? `
    <h2>Shared boundaries are explicit and small</h2>
    <p>A reviewer can challenge this principle while the complete design and use cases remain one click away.</p>
    <h2>Observable behavior wins</h2>
    <p>Each principle names a result that the team can inspect.</p>` : `
    <h2>Co-edit</h2><p>Two participants edit the same project and see the same durable state.</p>
    <h2>Observe</h2><p>One participant follows another without replacing personal state.</p>`;
  return `
    <article class="reading-page vision-document-page">
      <h1 class="goal-title">${document.title}</h1>
      <section class="memory-section document-prose">${content}</section>
      <p class="checkpoint-quote">Source: neara/hackathon/live-edit/${document.file}</p>
    </article>`;
}

/** Renders the small Document picker in the reader toolbar. */
function productDocumentPicker() {
  return `
    <details class="vision-document-picker">
      <summary>${reviewDocuments[selectedReviewDocument].title}<span aria-hidden="true">⌄</span></summary>
      <div><p>Linked to Define Live Edit collaboration</p>${Object.entries(reviewDocuments).map(([id, document]) => `<button class="${id === selectedReviewDocument ? "selected" : ""}" type="button" data-review-document="${id}">${document.title}${id === selectedReviewDocument ? " · Current" : ""}</button>`).join("")}</div>
    </details>`;
}

/** Renders the quiet page outline beside the selected Document. */
function productPageOutline() {
  return `<aside class="vision-page-outline"><p>On this page</p><nav>${reviewHeadings().map((heading, index) => `<a class="${index === 0 ? "active" : ""}" href="#">${heading}</a>`).join("")}</nav></aside>`;
}

/** Renders one Document reader or its separate native-agent surface. */
function renderDocument() {
  if (readerAgentOpen) {
    return `
      ${shellBar({ back: "Document", backAction: "close-reader-agent", context: "Define Live Edit collaboration · OpenAI Codex" })}
      <main class="shell-screen native-chat-screen">
        <section class="native-chat">
          <div class="native-chat-heading"><span>&gt;_</span><strong>OpenAI Codex</strong><small>Define Live Edit collaboration</small></div>
          <div class="native-transcript">
            <div class="native-agent"><p>I read the complete Goal, all three linked Documents, and your selected reading location.</p><p>Give feedback naturally. I can answer a question, edit or consolidate Documents, or propose a separate Goal.</p></div>
          </div>
          <div class="native-composer"><span>›</span><span class="composer-placeholder">Give feedback across this Goal…</span><kbd>⌘↵</kbd></div>
        </section>
      </main>`;
  }
  const bar = shellBar({
    back: "Summary",
    backAction: "work",
    context: "",
  });
  return `
    ${bar}
    <main class="shell-screen vision-reader-only">
      <section class="vision-reader">
        <header class="vision-reader-toolbar">
          <div class="vision-reader-route">
            <div class="vision-reader-history">
              <button type="button" data-action="review-back" ${reviewTrailIndex > 0 ? "" : "disabled"} aria-label="Previous Document">←</button>
              <button type="button" data-action="review-forward" ${reviewTrailIndex < reviewTrail.length - 1 ? "" : "disabled"} aria-label="Next Document">→</button>
            </div>
            <div class="area-path"><button>Neara</button><button>Hackathon</button><button>Live Edit</button></div>
            <span class="vision-route-separator">/</span>
            ${productDocumentPicker()}
          </div>
          <button class="shell-bar-button" type="button" data-action="open-reader-agent">Open agent</button>
        </header>
        <div class="vision-reader-scroll">
          <div class="vision-reader-grid">
            ${productDocument()}
            ${productPageOutline()}
          </div>
        </div>
      </section>
    </main>`;
}

/** Selects one Document and updates the local reading trail. */
function selectReviewDocument(id, { record = true } = {}) {
  if (!reviewDocuments[id]) return;
  if (record && id !== selectedReviewDocument) {
    reviewTrail = reviewTrail.slice(0, reviewTrailIndex + 1);
    reviewTrail.push(id);
    reviewTrailIndex = reviewTrail.length - 1;
  }
  selectedReviewDocument = id;
  render();
}

const renderers = [renderReturn, renderChat, renderDescribe, renderOrganize, renderPrograms, renderWorking, renderDocument];

/** Shows one temporary response to a concept interaction. */
function showToast(message) {
  visionToast.textContent = message;
  visionToast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => visionToast.classList.remove("show"), 2800);
}

/** Selects one bounded product-vision scene. */
function setScene(index) {
  currentScene = Math.max(0, Math.min(scenes.length - 1, index));
  render();
}

/** Renders the current rationale and interactive shell scene. */
function render() {
  const scene = scenes[currentScene];
  sceneCount.textContent = `${currentScene + 1} of ${scenes.length}`;
  sceneKicker.textContent = scene.kicker;
  sceneTitle.textContent = scene.title;
  sceneSummary.textContent = scene.summary;
  humanLimit.textContent = scene.human;
  modelLimit.textContent = scene.model;
  productResponse.textContent = scene.response;
  rationale.classList.toggle("is-hidden", !rationaleVisible);
  rationaleToggle.textContent = rationaleVisible ? "Hide why" : "Why this works";
  rationaleToggle.setAttribute("aria-pressed", String(rationaleVisible));
  demoShell.innerHTML = renderers[currentScene]();
  previousScene.disabled = currentScene === 0;
  nextScene.textContent = currentScene === scenes.length - 1 ? "Restart ↺" : "Next →";
  sceneDots.innerHTML = scenes.map((sceneItem, index) => `<button class="scene-dot ${index === currentScene ? "active" : ""}" type="button" data-scene="${index}" aria-label="${sceneItem.title}"></button>`).join("");
}

document.addEventListener("click", (event) => {
  const target = event.target;
  const dot = target.closest("[data-scene]");
  if (dot) return setScene(Number(dot.dataset.scene));
  const program = target.closest("[data-program]");
  if (program) {
    if (["dnd-server", "daily-agent"].includes(program.dataset.program)) {
      programView = program.dataset.program;
      return render();
    }
    return showToast("The command opens a short review before Agent Shell starts its visible tmux session.");
  }
  const reviewDocument = target.closest("[data-review-document]");
  if (reviewDocument) return selectReviewDocument(reviewDocument.dataset.reviewDocument);
  const action = target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "next") return setScene(currentScene + 1);
  if (action === "previous") return setScene(currentScene - 1);
  if (action === "work") return setScene(0);
  if (action === "programs") {
    programView = "list";
    return setScene(4);
  }
  if (action === "new-nested-area") {
    organizeMode = "new-nested-area";
    return render();
  }
  if (action === "new-root-area") {
    organizeMode = "new-root";
    return render();
  }
  if (action === "move-area") {
    organizeMode = "move";
    return render();
  }
  if (action === "area-tree" || action === "cancel-area-action") {
    organizeMode = "tree";
    return render();
  }
  if (action === "confirm-area-move") return showToast("Agent Shell shows the complete path change before it moves the Area.");
  if (action === "rename-area") return showToast("Rename uses the same focused path preview.");
  if (action === "program-list") {
    programView = "list";
    dndStopConfirm = false;
    return render();
  }
  if (action === "stop-dnd-server") {
    dndStopConfirm = true;
    return render();
  }
  if (action === "cancel-stop-dnd-server") {
    dndStopConfirm = false;
    return render();
  }
  if (action === "confirm-stop-dnd-server") {
    dndServerRunning = false;
    dndStopConfirm = false;
    render();
    return showToast("The process stopped. Its tmux session and scrollback remain.");
  }
  if (action === "start-dnd-server" || action === "restart-dnd-server") {
    dndServerRunning = true;
    render();
    return showToast(action === "start-dnd-server" ? "The D&D server started in its tmux session." : "The D&D server restarted.");
  }
  if (action === "open-program-session") return showToast("The complete tmux session opens with Programs and Stop available in the shell bar.");
  if (action === "run-daily-now") return showToast("One agent run starts now. The next daily time does not change.");
  if (action === "new-program") return showToast("Choose Process, Command, or Scheduled agent routine.");
  if (action === "awake") {
    awake = !awake;
    render();
    return showToast(awake ? "This Mac will stay awake while Agent Shell is open." : "This Mac can sleep normally.");
  }
  if (action === "save-idea") return showToast("The description is saved as an idea. No work was created.");
  if (action === "document") return setScene(6);
  if (action === "review-back" && reviewTrailIndex > 0) {
    reviewTrailIndex -= 1;
    return selectReviewDocument(reviewTrail[reviewTrailIndex], { record: false });
  }
  if (action === "review-forward" && reviewTrailIndex < reviewTrail.length - 1) {
    reviewTrailIndex += 1;
    return selectReviewDocument(reviewTrail[reviewTrailIndex], { record: false });
  }
  if (action === "open-reader-agent") {
    readerAgentOpen = true;
    return render();
  }
  if (action === "close-reader-agent") {
    readerAgentOpen = false;
    return render();
  }
});

document.addEventListener("submit", (event) => {
  if (event.target.matches("[data-describe-form]")) {
    event.preventDefault();
    describing = true;
    render();
    return;
  }
  if (event.target.matches("[data-area-create-form]")) {
    event.preventDefault();
    const atRoot = event.target.dataset.areaParent === "root";
    organizeMode = "tree";
    render();
    showToast(atRoot ? "The new top-level Area now exists." : "The new Area now exists below Neara / Hackathon.");
    return;
  }
});

previousScene.addEventListener("click", () => setScene(currentScene - 1));
nextScene.addEventListener("click", () => setScene(currentScene === scenes.length - 1 ? 0 : currentScene + 1));
rationaleToggle.addEventListener("click", () => {
  rationaleVisible = !rationaleVisible;
  render();
});
document.querySelector("#restart-vision").addEventListener("click", () => {
  describing = false;
  awake = false;
  organizeMode = "tree";
  programView = "list";
  dndServerRunning = true;
  dndStopConfirm = false;
  readerAgentOpen = false;
  selectedReviewDocument = "design";
  reviewTrail = ["design"];
  reviewTrailIndex = 0;
  setScene(0);
});

render();
