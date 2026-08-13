const scenes = [
  {
    kicker: "01 — Return",
    title: "Reload the thought before the controls",
    summary: "The first screen restores identity, intent, the latest change, and the next decision.",
    human: "Interruptions erase working context. An outcome title alone does not restore a useful mental model.",
    model: "Chat history is complete but expensive to reread. A generated summary can also drift.",
    response: "Show one current brief and one short story. Open the native chat when Julian wants the complete exchange.",
  },
  {
    kicker: "02 — Chat",
    title: "Keep the native agent chat whole",
    summary: "Agent Shell adds context and return controls around the chat. It does not replace the chat.",
    human: "People need complete agent messages and tool activity before they can judge or direct the work.",
    model: "The native agent interface already shows provider features, tool activity, history, and its composer.",
    response: "Open the native chat unchanged. Keep Summary, outcome context, and Stop agent in the shell chrome.",
  },
  {
    kicker: "03 — Shape",
    title: "Let natural description become organized work",
    summary: "Julian speaks freely first. The agent reflects one body of work and an optional outcome map.",
    human: "People often know the experience they want before they know the correct task structure.",
    model: "Models split work too early and lose the whole experience. They also invent scope from vague language.",
    response: "Preserve the description. Propose a parent and children. Then let Julian open any outcome and start an agent there.",
  },
  {
    kicker: "04 — Organize",
    title: "Give noun nodes one temporary home",
    summary: "A Projects action opens the noun hierarchy alone. Empty projects remain visible without becoming fake work.",
    human: "People need a stable map of subjects. They do not need that complete map beside every outcome or agent message.",
    model: "Moving one noun node changes every descendant path. A conversational request can hide that complete effect.",
    response: "Put Projects on the Work screen. Show one full-screen tree with New child, Rename, and Move actions. Preview every changed path.",
  },
  {
    kicker: "05 — Programs",
    title: "Keep operational programs near their nouns",
    summary: "Programs gathers live processes, on-demand commands, and scheduled agent routines without turning them into outcomes.",
    human: "People need to find a running server quickly. They also need quiet confidence that a daily agent will run once.",
    model: "A command can stop while its tmux session remains useful. A scheduled agent can overlap or repeat unless the scheduler prevents duplicates.",
    response: "Group programs by noun. Show true process state, open the native tmux session, and give schedules an explicit next-run and catch-up rule.",
  },
  {
    kicker: "06 — Leave",
    title: "Support unattended work at the moment it matters",
    summary: "The outcome summary states the live assignment. Sleep prevention sits beside the working state.",
    human: "People want to leave long work alone. Hidden system controls create doubt before they walk away.",
    model: "An agent can work for a long time, but terminal activity does not prove useful progress.",
    response: "Show purpose and truthful state. Offer one contextual keep-awake control. Hide the terminal by default.",
  },
  {
    kicker: "07 — Hand off",
    title: "Prepare context while the work happens",
    summary: "Another person receives the same compact memory that restores Julian's context.",
    human: "New readers need purpose, decisions, current direction, and open questions. They do not need the complete chat.",
    model: "A fresh model or person lacks private context. A new summary written later can omit important decisions.",
    response: "Derive a short handoff from the brief, story, and linked documents. Keep every source inspectable.",
  },
];

let currentScene = 0;
let rationaleVisible = true;
let shaped = false;
let mapCreated = false;
let selectedWork = "";
let awake = false;
let organizeMode = "tree";
let programView = "list";
let dndServerRunning = true;
let dndStopConfirm = false;
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

/** Renders the current outcome's read-only noun path. */
function projectPath() {
  return `<div class="project-path"><span>Otto</span><span>Tangent</span></div>`;
}

/** Renders the compact sequence of meaningful product decisions. */
function storySoFar({ open = false } = {}) {
  return `
    <details class="story-details" ${open ? "open" : ""}>
      <summary>Story so far · 5 meaningful moments</summary>
      <ol class="timeline">
        <li><time>First use</time><div><strong>The phase dashboard failed.</strong><p>It showed system concepts before it restored context.</p></div></li>
        <li><time>Second use</time><div><strong>The context-first shell worked.</strong><p>Project, result, progress, and agent state became clear.</p></div></li>
        <li><time>Third use</time><div><strong>The summary gained durable memory.</strong><p>A current brief and short history support return and handoff.</p></div></li>
        <li><time>Fourth use</time><div><strong>Native chat remained central.</strong><p>Agent Shell augments the chat instead of replacing it.</p></div></li>
        <li><time>Now</time><div><strong>Projects and programs gained quiet homes.</strong><p>The noun map and operational tools stay close without crowding focused work.</p></div></li>
      </ol>
    </details>
  `;
}

/** Renders the context-first outcome summary. */
function renderReturn() {
  return `
    ${shellBar({ actions: `${dndServerRunning ? `<button class="shell-bar-button" type="button" data-action="programs"><span class="live-indicator" aria-hidden="true"></span>1 program</button>` : ""}<button class="shell-bar-button" type="button">Find work&nbsp; ⌘/</button>` })}
    <main class="shell-screen">
      <article class="reading-page">
        ${projectPath()}
        <h1 class="outcome-title">UX Product Vision</h1>

        <section class="brief-card">
          <p class="eyebrow">Current brief</p>
          <h2>Make Agent Shell a calm place to understand, direct, and resume agent work.</h2>
          <dl class="brief-facts">
            <div class="brief-fact"><dt>You wanted</dt><dd>One focused surface that restores context before it shows controls.</dd></div>
            <div class="brief-fact"><dt>What changed</dt><dd>The summary now restores the current direction and the short path that produced it.</dd></div>
            <div class="brief-fact"><dt>Now</dt><dd>Keep chat central. Give noun structure and noun-owned programs quiet secondary surfaces.</dd></div>
          </dl>
        </section>

        <section class="agent-card">
          <div class="agent-state"><span class="state-dot" aria-hidden="true"></span><div><h3>Codex is waiting for you.</h3><p>Open the complete native chat to read its message and reply.</p></div></div>
          <div class="action-row">
            <button class="primary-button" type="button" data-action="next">Reply to Codex</button>
            <button class="secondary-button" type="button">Choose next step…</button>
          </div>
        </section>

        <section class="memory-section">
          <div class="memory-head"><h3>Your latest take</h3><span>Saved with this outcome</span></div>
          <blockquote class="checkpoint-quote">The summary and story work. Agent Shell must augment the native chat, not replace it.</blockquote>
          ${storySoFar()}
        </section>

        <section class="memory-section">
          <div class="memory-head"><h3>Living document</h3><button class="quiet-button" type="button" data-action="document">Open</button></div>
          <div class="document-row"><div><strong>Agent Shell product design</strong><small>Current principles and solution contract</small></div><button class="quiet-button" type="button" data-action="document">Read</button></div>
          <button class="quiet-button" type="button" data-action="handoff">Share context with another person →</button>
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
          <div class="native-tool"><span>• Read</span><code>outcome-ux-product-vision.md</code></div>
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

const originalDescription = "I want to make the complete D&D scene workflow reliable. I care about terrain generation, sprite cutouts, ramps, and movement. I want one coherent experience, but I also want to finish one useful result at a time. My proposed breakdown is useful context, not a fixed execution plan.";

const shapedOutcomes = {
  parent: {
    title: "Complete scene loop works end to end",
    kind: "Parent outcome",
    result: "A player creates terrain and a creature, then moves through the complete scene in one flow.",
  },
  generation: {
    title: "Scene generation preserves the world",
    kind: "Child outcome",
    result: "Generated terrain fits the current view and preserves existing world content.",
  },
  sprites: {
    title: "Sprite cutouts preserve the asset",
    kind: "Child outcome",
    result: "Segmentation removes the background and keeps the complete visible asset.",
  },
  movement: {
    title: "Movement works across ramps",
    kind: "Child outcome",
    result: "A creature crosses partial-width ramps without leaving the movement flow.",
  },
};

/** Renders one proposed parent or child outcome. */
function shapedOutcomeRow(id, child = false) {
  const outcome = shapedOutcomes[id];
  const tag = mapCreated ? "Ready" : outcome.kind;
  return `
    <button class="map-row ${child ? "child" : ""} ${selectedWork === id ? "selected" : ""}" type="button" ${mapCreated ? `data-select-shaped-outcome="${id}"` : "disabled"}>
      <span><strong>${outcome.title}</strong><small>${tag}</small></span>
      <span class="map-arrow" aria-hidden="true">${mapCreated ? "→" : ""}</span>
    </button>
  `;
}

/** Renders natural work capture and the proposed outcome structure. */
function renderShape() {
  if (!shaped) {
    return `
      ${shellBar({ back: "Work", context: "Describe new work" })}
      <main class="shell-screen">
        <article class="shape-page">
          <header class="shape-head"><p class="eyebrow">New work</p><h1>Describe the experience you want to change.</h1><p>Speak or type naturally. Agent Shell will reflect the whole before it creates outcomes.</p></header>
          <form class="capture-card" data-shape-form>
            <label><span>Project</span><select><option>Otto / D&amp;D</option><option>Otto / Tangent</option></select></label>
            <label><span>Your description</span><textarea>${originalDescription}</textarea></label>
            <div class="action-row"><button class="primary-button" type="submit">Shape this work</button><button class="quiet-button" type="button" data-action="save-idea">Save as an idea</button></div>
          </form>
        </article>
      </main>
    `;
  }

  return `
    ${shellBar({ back: "Your description", context: "Otto / D&D · Shape new work" })}
    <main class="shell-screen">
      <article class="shape-page">
        <header class="shape-head"><p class="eyebrow">Codex reflected your description</p><h1>Make the complete scene loop reliable</h1><p>${mapCreated ? "The outcomes are ready. Open the parent or any child." : "Nothing exists in the vault until you create these outcomes."}</p></header>
        <section class="result-card shape-result-card">
          <p class="eyebrow">Body of work</p>
          <h2>One coherent player experience</h2>
          <p class="user-story">From an empty map, create terrain and a creature. Then move the creature through the complete scene without leaving the flow.</p>
          <div class="work-map">
            ${shapedOutcomeRow("parent")}
            ${shapedOutcomeRow("generation", true)}
            ${shapedOutcomeRow("sprites", true)}
            ${shapedOutcomeRow("movement", true)}
          </div>
          ${mapCreated
            ? `<p class="map-note">These are ordinary outcomes. Select the parent for the complete body, or select a child for one result.</p>`
            : `<div class="shape-actions"><button class="primary-button" type="button" data-action="create-map">Create these outcomes</button><button class="quiet-button" type="button" data-action="save-idea">Save as an idea</button></div>`}
          <details class="original-details"><summary>Read my original description</summary><p>${originalDescription}</p></details>
        </section>
        ${selectedWork ? renderSelectedWork() : ""}
      </article>
    </main>
  `;
}

/** Renders the selected outcome's ordinary start action. */
function renderSelectedWork() {
  const outcome = shapedOutcomes[selectedWork];
  return `
    <section class="selected-work">
      <div><p class="eyebrow">${outcome.kind}</p><h2>${outcome.title}</h2><p>${outcome.result}</p></div>
      <div class="action-row"><button class="primary-button" type="button" data-action="start-shaped-outcome">See what the agent will do</button><button class="secondary-button" type="button">Talk it through first</button></div>
    </section>
  `;
}

/** Renders one noun-node row in the temporary project hierarchy. */
function projectNode({ name, path, depth = 0, selected = false, parent = false }) {
  return `
    <button class="project-node ${selected ? "selected" : ""} ${parent ? "parent" : ""}" style="--node-depth: ${depth}" type="button" data-project-node="${path}">
      <span class="node-disclosure" aria-hidden="true">${parent ? "⌄" : ""}</span>
      <span>${name}</span>
      ${selected ? `<span class="selected-label">Selected</span>` : ""}
    </button>
  `;
}

/** Renders the temporary noun hierarchy and its direct structural actions. */
function renderProjectTree() {
  return `
    ${shellBar({ back: "Work", backAction: "work", context: "Projects" })}
    <main class="shell-screen">
      <article class="projects-page">
        <header class="projects-head">
          <div><p class="eyebrow">Projects</p><h1>Where work belongs.</h1><p>This view contains nouns only. Outcomes remain on the Work screen.</p></div>
          <button class="primary-button" type="button" data-action="new-root-project">New project</button>
        </header>

        <section class="project-tree-card" aria-label="Project hierarchy">
          ${projectNode({ name: "Neara", path: "neara", parent: true })}
          ${projectNode({ name: "Essential", path: "neara/essential", depth: 1 })}
          ${projectNode({ name: "Hackathon", path: "neara/hackathon", depth: 1, selected: true, parent: true })}
          ${projectNode({ name: "Live Edit", path: "neara/hackathon/live-edit", depth: 2 })}
          ${projectNode({ name: "Hedno", path: "neara/hedno", depth: 1 })}
          ${projectNode({ name: "PG&E", path: "neara/pgande", depth: 1, parent: true })}
          ${projectNode({ name: "Portland", path: "neara/portland", depth: 1, parent: true })}
          ${projectNode({ name: "Python", path: "neara/pyth", depth: 1 })}
          ${projectNode({ name: "Otto", path: "otto", parent: true })}
          ${projectNode({ name: "D&D", path: "otto/dnd", depth: 1, parent: true })}
          ${projectNode({ name: "Tangent", path: "otto/tangent", depth: 1 })}
        </section>

        <section class="project-selection-card">
          <div><p class="eyebrow">Neara / Hackathon</p><h2>Hackathon</h2><p>Live Edit belongs below this noun.</p></div>
          <div class="action-row"><button class="primary-button" type="button" data-action="new-child-project">New child</button><button class="secondary-button" type="button" data-action="move-project">Move…</button><button class="quiet-button" type="button" data-action="rename-project">Rename</button></div>
        </section>

        <p class="projects-principle">The hierarchy disappears when you return to work. Project breadcrumbs elsewhere remain read-only.</p>
      </article>
    </main>
  `;
}

/** Renders a focused form for a root or child noun node. */
function renderNewProject({ root = false } = {}) {
  const parent = root ? "Top level" : "Neara / Hackathon";
  return `
    ${shellBar({ back: "Projects", backAction: "project-tree", context: root ? "New project" : "Neara / Hackathon · New child" })}
    <main class="shell-screen">
      <article class="project-action-page">
        <p class="eyebrow">New noun node</p>
        <h1>${root ? "Add a top-level project." : "Add a noun below Hackathon."}</h1>
        <form class="project-action-form" data-project-create-form data-project-parent="${root ? "root" : "neara/hackathon"}">
          <label><span>${root ? "Location" : "Parent"}</span><div class="fixed-path">${parent}</div></label>
          <label><span>Name</span><input value="${root ? "New project" : "Demo area"}" aria-label="Noun name" required /></label>
          <div class="action-row"><button class="primary-button" type="submit">Create noun node</button><button class="quiet-button" type="button" data-action="cancel-project-action">Cancel</button></div>
        </form>
        <p class="project-action-note">This creates a place for future work. It does not create an outcome or start an agent.</p>
      </article>
    </main>
  `;
}

/** Renders the complete path effect before a noun-node move. */
function renderMoveProject() {
  return `
    ${shellBar({ back: "Projects", backAction: "project-tree", context: "Move Hackathon" })}
    <main class="shell-screen">
      <article class="project-action-page move-project-page">
        <p class="eyebrow">Move noun node</p>
        <h1>Move Hackathon and everything below it.</h1>
        <label class="move-destination"><span>New parent</span><select><option>Otto</option><option>Neara</option><option>Otto / D&D</option><option>Otto / Tangent</option></select></label>
        <section class="move-preview">
          <p class="eyebrow">Path preview</p>
          <div class="path-change"><span>Before</span><code>neara/hackathon</code><span aria-hidden="true">→</span><code>otto/hackathon</code></div>
          <div class="path-change descendant"><span>Child</span><code>neara/hackathon/live-edit</code><span aria-hidden="true">→</span><code>otto/hackathon/live-edit</code></div>
        </section>
        <div class="action-row"><button class="primary-button" type="button" data-action="confirm-project-move">Move project</button><button class="quiet-button" type="button" data-action="cancel-project-action">Cancel</button></div>
        <p class="project-action-note">The preview shows every changed path before Agent Shell writes the move.</p>
      </article>
    </main>
  `;
}

/** Selects the current project-organization subview. */
function renderOrganize() {
  if (organizeMode === "new-child") return renderNewProject();
  if (organizeMode === "new-root") return renderNewProject({ root: true });
  if (organizeMode === "move") return renderMoveProject();
  return renderProjectTree();
}

/** Renders one noun-owned program with truthful state and one obvious action. */
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

/** Renders the noun-grouped index of processes, commands, and agent routines. */
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

        <p class="programs-principle">Programs belong to nouns. They do not become outcomes unless the result itself needs tracked work.</p>
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
        <div class="project-path"><span>Otto</span><span>D&amp;D</span></div>
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
        <div class="project-path"><span>Neara</span><span>PG&amp;E</span><span>Dev</span></div>
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
        ${projectPath()}
        <h1 class="outcome-title">UX Product Vision</h1>
        <section class="assignment-card"><p class="eyebrow">What Codex is doing now</p><h2>Build the context around the native agent chat</h2><p>Show re-entry, shaped work, unattended execution, and a concise human handoff.</p></section>
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

/** Renders concise context for another human reader. */
function renderHandoff() {
  return `
    ${shellBar({ back: "Outcome", context: "Share context · UX Product Vision" })}
    <main class="shell-screen">
      <article class="handoff-page">
        <header class="handoff-head"><div><p class="eyebrow">Two-minute context</p><h1>Agent Shell product direction</h1><p>Generated from current sources. No separate handoff document needs maintenance.</p></div><button class="primary-button" type="button" data-action="copy-handoff">Copy context</button></header>
        <section class="handoff-sheet">
          <div class="handoff-grid">
            <article class="handoff-block"><h2>Result</h2><p>Make Agent Shell a calm place to understand, direct, and resume agent work.</p></article>
            <article class="handoff-block"><h2>Current direction</h2><p>Use a context-first summary around the complete native agent chat.</p></article>
            <article class="handoff-block"><h2>Why</h2><p>Human attention and memory are limited. The chat remains useful evidence but requires concise return context.</p></article>
            <article class="handoff-block"><h2>Decisions</h2><ul><li>No permanent tree beside the work.</li><li>No second chat or composer.</li><li>Projects and Programs open as temporary secondary surfaces.</li><li>Programs belong to nouns, not outcomes.</li></ul></article>
            <article class="handoff-block"><h2>What happened</h2><ul><li>The first phase dashboard failed.</li><li>The context-first shell worked.</li><li>Julian kept native chat as the collaboration surface.</li></ul></article>
            <article class="handoff-block"><h2>Open question</h2><p>Which moments deserve a human checkpoint without adding ceremony to clear work?</p></article>
          </div>
          <div class="handoff-resources"><span class="resource-chip">Outcome · UX Product Vision</span><span class="resource-chip">Design · Agent Shell product design</span><span class="resource-chip">Story · 5 moments</span><span class="resource-chip">Native chat · Source evidence</span></div>
        </section>
      </article>
    </main>
  `;
}

const renderers = [renderReturn, renderChat, renderShape, renderOrganize, renderPrograms, renderWorking, renderHandoff];

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
  const shapedOutcome = target.closest("[data-select-shaped-outcome]");
  if (shapedOutcome) {
    selectedWork = shapedOutcome.dataset.selectShapedOutcome;
    return render();
  }
  const action = target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "next") return setScene(currentScene + 1);
  if (action === "previous") return setScene(currentScene - 1);
  if (action === "work") return setScene(0);
  if (action === "programs") {
    programView = "list";
    return setScene(4);
  }
  if (action === "handoff") return setScene(6);
  if (action === "new-child-project") {
    organizeMode = "new-child";
    return render();
  }
  if (action === "new-root-project") {
    organizeMode = "new-root";
    return render();
  }
  if (action === "move-project") {
    organizeMode = "move";
    return render();
  }
  if (action === "project-tree" || action === "cancel-project-action") {
    organizeMode = "tree";
    return render();
  }
  if (action === "confirm-project-move") return showToast("Agent Shell shows the complete path change before it moves the noun node.");
  if (action === "rename-project") return showToast("Rename uses the same focused path preview.");
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
  if (action === "create-map") {
    mapCreated = true;
    render();
    return showToast("The parent and child outcomes are ready.");
  }
  if (action === "save-idea") return showToast("The description is saved as an idea. No outcomes were created.");
  if (action === "start-shaped-outcome") return showToast(`The normal start plan opens for “${shapedOutcomes[selectedWork].title}”.`);
  if (action === "copy-handoff") return showToast("The two-minute context is ready to share.");
  if (action === "document") return showToast("A document opens alone in the same reading column.");
});

document.addEventListener("submit", (event) => {
  if (event.target.matches("[data-shape-form]")) {
    event.preventDefault();
    shaped = true;
    render();
    return;
  }
  if (event.target.matches("[data-project-create-form]")) {
    event.preventDefault();
    const atRoot = event.target.dataset.projectParent === "root";
    organizeMode = "tree";
    render();
    showToast(atRoot ? "The new top-level noun node now exists." : "The new noun node now exists below Neara / Hackathon.");
  }
});

previousScene.addEventListener("click", () => setScene(currentScene - 1));
nextScene.addEventListener("click", () => setScene(currentScene === scenes.length - 1 ? 0 : currentScene + 1));
rationaleToggle.addEventListener("click", () => {
  rationaleVisible = !rationaleVisible;
  render();
});
document.querySelector("#restart-vision").addEventListener("click", () => {
  shaped = false;
  mapCreated = false;
  selectedWork = "";
  awake = false;
  organizeMode = "tree";
  programView = "list";
  dndServerRunning = true;
  dndStopConfirm = false;
  setScene(0);
});

render();
