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
    kicker: "04 — Leave",
    title: "Support unattended work at the moment it matters",
    summary: "The outcome summary states the live assignment. Sleep prevention sits beside the working state.",
    human: "People want to leave long work alone. Hidden system controls create doubt before they walk away.",
    model: "An agent can work for a long time, but terminal activity does not prove useful progress.",
    response: "Show purpose and truthful state. Offer one contextual keep-awake control. Hide the terminal by default.",
  },
  {
    kicker: "05 — Hand off",
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

function shellBar({ back = "Work", context = "Otto / Tangent · UX Product Vision", actions = "" } = {}) {
  return `
    <header class="shell-bar">
      <button class="shell-bar-button" type="button" data-action="previous">${back === "Agent Shell" ? "" : "← "}${back}</button>
      <div class="shell-context">${context}</div>
      <div class="shell-actions">${actions}</div>
    </header>
  `;
}

function projectPath() {
  return `<div class="project-path"><span>Otto</span><span>Tangent</span></div>`;
}

function storySoFar({ open = false } = {}) {
  return `
    <details class="story-details" ${open ? "open" : ""}>
      <summary>Story so far · 4 meaningful moments</summary>
      <ol class="timeline">
        <li><time>First use</time><div><strong>The phase dashboard failed.</strong><p>It showed system concepts before it restored context.</p></div></li>
        <li><time>Second use</time><div><strong>The context-first shell worked.</strong><p>Project, result, progress, and agent state became clear.</p></div></li>
        <li><time>Third use</time><div><strong>The summary gained durable memory.</strong><p>A current brief and short history support return and handoff.</p></div></li>
        <li><time>Now</time><div><strong>Native chat remains central.</strong><p>Agent Shell augments the chat instead of replacing it.</p></div></li>
      </ol>
    </details>
  `;
}

function renderReturn() {
  return `
    ${shellBar({ actions: `<button class="shell-bar-button" type="button">Find work&nbsp; ⌘/</button>` })}
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
            <div class="brief-fact"><dt>Now</dt><dd>Keep the native agent chat complete. Add context around it.</dd></div>
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

function renderSelectedWork() {
  const outcome = shapedOutcomes[selectedWork];
  return `
    <section class="selected-work">
      <div><p class="eyebrow">${outcome.kind}</p><h2>${outcome.title}</h2><p>${outcome.result}</p></div>
      <div class="action-row"><button class="primary-button" type="button" data-action="start-shaped-outcome">See what the agent will do</button><button class="secondary-button" type="button">Talk it through first</button></div>
    </section>
  `;
}

function renderWorking() {
  return `
    ${shellBar({ actions: `<button class="shell-bar-button danger" type="button">Stop agent…</button>` })}
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
            <article class="handoff-block"><h2>Decisions</h2><ul><li>No permanent tree beside the work.</li><li>No second chat or composer.</li><li>Parent and child outcomes use the same start flow.</li></ul></article>
            <article class="handoff-block"><h2>What happened</h2><ul><li>The first phase dashboard failed.</li><li>The context-first shell worked.</li><li>Julian kept native chat as the collaboration surface.</li></ul></article>
            <article class="handoff-block"><h2>Open question</h2><p>Which moments deserve a human checkpoint without adding ceremony to clear work?</p></article>
          </div>
          <div class="handoff-resources"><span class="resource-chip">Outcome · UX Product Vision</span><span class="resource-chip">Design · Agent Shell product design</span><span class="resource-chip">Story · 4 moments</span><span class="resource-chip">Native chat · Source evidence</span></div>
        </section>
      </article>
    </main>
  `;
}

const renderers = [renderReturn, renderChat, renderShape, renderWorking, renderHandoff];

function showToast(message) {
  visionToast.textContent = message;
  visionToast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => visionToast.classList.remove("show"), 2800);
}

function setScene(index) {
  currentScene = Math.max(0, Math.min(scenes.length - 1, index));
  render();
}

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
  const shapedOutcome = target.closest("[data-select-shaped-outcome]");
  if (shapedOutcome) {
    selectedWork = shapedOutcome.dataset.selectShapedOutcome;
    return render();
  }
  const action = target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "next") return setScene(currentScene + 1);
  if (action === "previous") return setScene(currentScene - 1);
  if (action === "handoff") return setScene(4);
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
  setScene(0);
});

render();
