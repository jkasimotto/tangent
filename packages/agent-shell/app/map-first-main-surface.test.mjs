import assert from "node:assert/strict";
import test from "node:test";

import { bootWorkTable, legacyFixtureWork, press, settle } from "./work-table-harness.mjs";

const AREA = "otto/tangent";
const DOCUMENT = {
  file: `${AREA}/design-map-first-proof.md`, area: AREA, kind: "document", docKind: "page",
  title: "Map-first proof", searchText: "map first proof", mtime: 1, links: [], goalHistory: [],
};

/** Creates one Goal record accepted by the legacy-to-v3 fixture adapter. */
function goal(slug, title, extra = {}) {
  return {
    mtime: 1, changedAt: 1, area: AREA, slug, file: `${AREA}/goal-${slug}.md`, title,
    status: "active", doneWhen: `${title} is done.`, waitingOn: "", depth: 0, order: 1,
    dependsOn: [], requiredBy: [], unresolvedDependencies: [], documents: [], agents: [],
    ...extra,
  };
}

/** Builds one Map, one named Brain, one direct-attention Goal, and one routine Goal. */
function fixture() {
  const attention = goal("needs-decision", "Choose the Map proof", { session: "map-proof-waiting" });
  const routine = goal("routine-progress", "Continue routine indexing", { session: "map-proof-working" });
  const goals = [attention, routine];
  const area = { path: AREA, name: "tangent", goals, documents: [DOCUMENT] };
  return {
    goals,
    vault: { areas: [area], map: [{ path: AREA, name: "tangent", goals }], documents: [DOCUMENT] },
    sessions: [
      { name: "map-proof-waiting", goal: attention.file, area: AREA, state: "waiting", stateDetail: "decision", command: "codex", created: 1 },
      { name: "map-proof-working", goal: routine.file, area: AREA, state: "working", command: "codex", created: 1 },
      { name: "otto-tangent--brain", area: AREA, kind: "brain", state: "working", command: "codex", created: 1 },
    ],
    brains: [{ area: AREA, status: "active", live: true, session: "otto-tangent--brain", generation: 4, state: "working", forJulian: [], requests: [] }],
    pipelines: [],
  };
}

/** Serves the one proof Document through the harness's canonical read route. */
function servedDocument() {
  return { ...DOCUMENT, text: "# Map-first proof\n\nKeep the durable Map beneath this discussion.", hash: "map-first-proof-1", comments: [] };
}

/** Clicks one selector and reports a useful missing-control failure. */
function click(document, selector) {
  const target = document.querySelector(selector);
  assert.ok(target, `Expected ${selector}`);
  target.click();
  return target;
}

/** Waits for one semantic proof state without coupling it to machine speed. */
async function waitForProof(window, read, message, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = read();
    if (value) return value;
    await settle(window, 2);
  }
  assert.fail(message);
}

/** Opens the named proof Document through the real global Go To layer. */
async function openProofDocument(window) {
  const { document } = window;
  click(document, "#go-to-button");
  await settle(window, 5);
  const row = [...document.querySelectorAll("[data-go-to-row]")].find((item) => item.textContent.includes(DOCUMENT.title));
  assert.ok(row, "Go To includes the complete-vault proof Document");
  row.click();
  await settle(window, 5);
  assert.equal(document.querySelector("#document-peek-layer").hidden, false);
  assert.match(document.querySelector("#document-peek-layer .document-peek-title")?.textContent ?? "", /Map-first proof/);
}

/** Opens the responsible named Brain through the same complete-vault finder. */
async function openProofBrain(window) {
  const { document } = window;
  click(document, "#go-to-button");
  await settle(window, 5);
  const row = [...document.querySelectorAll("[data-go-to-row]")].find((item) => /Brain/.test(item.textContent) && /Tangent/i.test(item.textContent));
  assert.ok(row, "Go To includes the named Tangent Brain");
  row.click();
  await settle(window, 5);
  assert.match(document.querySelector("[data-map-brain-pane] > header strong")?.textContent ?? "", /Tangent Brain/);
}

/** Filters out telemetry and reports only actions that could send or start work. */
function automaticBrainMutations(posts) {
  return posts.filter(({ path }) => ["/api/agents/send", "/api/brains/start", "/api/goals/start", "/api/pipelines/start"].includes(path));
}

/** Keeps one Work query after the search input returns focus to its matching row. */
async function keepWorkSearch(window, pattern) {
  press(window, "/");
  await settle(window, 3);
  const input = window.document.querySelector("#work-search-input");
  input.value = pattern;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await settle(window, 3);
  press(window, "Enter");
  await settle(window, 3);
  return input;
}

/** Activates one named native control through the same click default as Enter or Space. */
async function activateNamedControl(window, control, expectedName) {
  assert.ok(control, `Expected a control named ${expectedName}`);
  assert.equal(control.hidden, false, `${expectedName} is visible`);
  assert.equal(Boolean(control.closest("[inert], [hidden]")), false, `${expectedName} is in the active accessibility tree`);
  const name = control.getAttribute("aria-label") || control.textContent.trim();
  assert.match(name, expectedName, `${name} names its target`);
  control.focus();
  assert.equal(control.isConnected, true, `${name} stays mounted when it receives keyboard focus`);
  control.click();
  await settle(window, 5);
}

/** Selects one real Go To option with its input, Arrow keys, and Enter. */
async function chooseGoToWithKeyboard(window, { query, kind, id = "", open = "shortcut" }) {
  const { document } = window;
  if (open === "shortcut") {
    press(window, "k", { metaKey: true });
    await settle(window, 5);
  } else if (open === "pointer") {
    const button = document.querySelector("#go-to-button");
    assert.match(button.textContent, /Go to/);
    button.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
    button.click();
    await settle(window, 5);
  } else {
    await activateNamedControl(window, document.querySelector("#go-to-button"), /Go to/);
  }
  const input = document.querySelector("#go-to-input");
  assert.equal(document.activeElement, input, "Go To gives its labelled combobox focus");
  assert.equal(input.getAttribute("role"), "combobox");
  input.value = query;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await settle(window, 6);
  const rows = [...document.querySelectorAll("[data-go-to-row]")];
  const target = rows.find((row) => row.querySelector(".search-result-kind")?.textContent.trim() === kind
    && (!id || row.textContent.includes(id)));
  assert.ok(target, `Go To contains ${kind} ${id || query}`);
  assert.match(target.textContent, /Otto \/ Tangent|otto \/ tangent|otto\/tangent/i, "the result names its responsible Area");
  let selected = rows.findIndex((row) => row.getAttribute("aria-selected") === "true");
  const wanted = rows.indexOf(target);
  while (selected !== wanted) {
    press(window, "ArrowDown");
    await settle(window);
    selected = (selected + 1) % rows.length;
  }
  press(window, "Enter");
  await settle(window, 6);
}

/** Boots one isolated route proof with a durable Map location and live Brain. */
async function bootRouteProof(width) {
  return bootWorkTable(fixture(), {
    startSurface: "map",
    documentRecord: servedDocument(),
    terminalStandin: true,
    mapDocumentRef: DOCUMENT.file,
    width,
    localStorageEntries: { "agent-shell.last-area": AREA },
  });
}

/** The retained Map stand-in used by the DOM boundary. */
function focusRouteMap(document) {
  const map = document.querySelector("#screen [data-tangent-area-map]");
  assert.ok(map, "the durable Map is mounted");
  map.setAttribute("tabindex", "0");
  map.focus();
  return map;
}

/** Opens the live named Brain from Map with the documented chord. */
async function openRouteBrain(window) {
  const { document } = window;
  focusRouteMap(document);
  const named = document.querySelector("#context-brain-button");
  assert.match(named.getAttribute("aria-label"), /Show Otto \/ Tangent Brain/);
  press(window, "Enter", { metaKey: true, shiftKey: true });
  await settle(window, 6);
  const pane = document.querySelector("[data-map-brain-pane]");
  assert.match(pane.querySelector(":scope > header strong")?.textContent ?? "", /Otto \/ Tangent Brain/);
  assert.equal(document.querySelector("#context-brain-button").getAttribute("aria-pressed"), "true");
  assert.equal(document.activeElement?.hasAttribute("data-terminal-standin"), true, "Brain gives its composer immediate focus");
  return pane;
}

/** Opens the proof Document from the Map's semantic block. */
async function openRouteDocument(window) {
  const block = window.document.querySelector(`[data-map-document-ref="${DOCUMENT.file}"]`);
  await activateNamedControl(window, block, /Open .*design-map-first-proof\.md/);
  const reader = window.document.querySelector("#document-peek-layer .document-peek-surface");
  assert.equal(reader.getAttribute("role"), "dialog");
  assert.equal(reader.getAttribute("aria-label"), DOCUMENT.title);
  return { block, reader };
}

/** Opens Work through the always-visible native tab, equivalent to Enter or Space. */
async function openRouteWork(window) {
  const { document } = window;
  await activateNamedControl(window, document.querySelector("#work-tab"), /^Work$/);
  const work = document.querySelector("#work-lens-layer");
  assert.equal(work.hidden, false);
  assert.equal(work.hasAttribute("inert"), false);
  assert.equal(document.querySelector("#work-tab").getAttribute("aria-current"), "page");
  assert.equal(document.querySelector("#work-lens-title").textContent, "All work");
  return work;
}

/** Selects and focuses one Work row as the exact keyboard return target. */
function focusRouteWorkRow(window, cursor = `goal:${AREA}/goal-routine-progress.md`) {
  const row = window.document.querySelector(`[data-work-cursor="${cursor}"]`);
  assert.ok(row, `Work contains ${cursor}`);
  row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const control = row.querySelector("[data-work-row-title], [data-work-cursor-control]");
  control.focus();
  return { row, control };
}

/** Confirms Map is the announced current surface and lower layers are gone. */
function assertRouteMap(document, map) {
  assert.equal(document.querySelector("#screen [data-tangent-area-map]"), map, "the exact retained Map is visible");
  assert.equal(document.querySelector("#map-tab").getAttribute("aria-current"), "page", "Map is announced as current");
  assert.equal(document.querySelector("#screen").hasAttribute("inert"), false);
}

test("journey 1: Map boots, For you opens above it, and Close returns to the retained Map", async () => {
  for (const width of [1440, 800]) {
    let releaseWork;
    const workGate = new Promise((resolve) => { releaseWork = resolve; });
    const { window, document } = await bootWorkTable(fixture(), {
      startSurface: "map", documentRecord: servedDocument(), width,
      /** Delays the first Work publication until the Map boot assertion completes. */
      workHandler: async ({ read }) => { if (read === 1) await workGate; return null; },
    });
    const map = document.querySelector("#screen [data-tangent-area-map]");
    assert.ok(map, `Map is usable at ${width}px while the first Work publication is delayed`);
    assert.equal(document.querySelector("#work-lens-layer").hidden, true);
    releaseWork();
    await settle(window, 8);

    click(document, "#for-you-button");
    await settle(window, 5);
    assert.equal(document.querySelector("#work-lens-layer").hidden, false);
    assert.equal(document.querySelector("#work-lens-title").textContent, "For you");
    assert.ok(document.querySelector(`[data-goal-anchor="${AREA}/goal-needs-decision.md"]`), "direct attention is in For you");
    assert.equal(document.querySelector(`[data-goal-anchor="${AREA}/goal-routine-progress.md"]`), null, "routine progress is not direct attention");

    click(document, "[data-close-work-lens]");
    await settle(window);
    assert.equal(document.querySelector("#work-lens-layer").hidden, true);
    assert.equal(document.querySelector("#screen [data-tangent-area-map]"), map, `closing Work retains the exact ${width}px Map instance`);
    window.close();
  }
});

test("journey 4: a Map Document opens its named Brain with a removable subject and no automatic send", async () => {
  for (const width of [1440, 800]) {
    const { window, document, posts } = await bootWorkTable(fixture(), { startSurface: "map", documentRecord: servedDocument(), terminalStandin: true, mapDocumentRef: DOCUMENT.file, width });
    const map = document.querySelector("#screen [data-tangent-area-map]");
    click(document, `[data-map-document-ref="${DOCUMENT.file}"]`);
    await settle(window, 5);
    assert.equal(document.querySelector("#document-peek-layer").hidden, false, `one direct Map block action opens the ${width}px quick reader`);
    assert.match(document.querySelector("#document-peek-layer .document-peek-title")?.textContent ?? "", /Map-first proof/);
    const reader = document.querySelector("#document-peek-layer .document-peek-surface");
    const readerScroll = document.querySelector("#document-peek-layer .document-peek-scroll");
    readerScroll.scrollTop = 31;

    const discuss = document.querySelector("[data-discuss-document]");
    assert.equal(discuss.textContent.trim(), "Discuss with Otto / Tangent Brain");
    discuss.click();
    await settle(window, 5);

    assert.ok(document.querySelector(".document-discussion-workspace"));
    assert.match(document.querySelector("[data-map-brain-pane] > header strong")?.textContent ?? "", /Tangent Brain/);
    const subject = document.querySelector("[data-brain-subject]");
    assert.equal(subject.hidden, false);
    assert.equal(subject.querySelector("span").textContent, DOCUMENT.title);
    assert.equal(document.activeElement?.hasAttribute("data-terminal-standin"), true, `the responsible Brain accepts typing immediately at ${width}px`);
    assert.deepEqual(automaticBrainMutations(posts), [], "opening discussion sends and starts nothing");

    click(document, "[data-remove-brain-subject]");
    assert.equal(subject.hidden, true, "the exact Document subject is removable");
    assert.deepEqual(automaticBrainMutations(posts), []);

    click(document, "[data-leave-area-workspace]");
    await settle(window);
    assert.equal(document.querySelector(".document-discussion-workspace"), null, "Back removes only the Brain stage");
    assert.equal(document.querySelector("#document-peek-layer").hidden, false, "the quick reader remains");
    assert.equal(document.querySelector("#document-peek-layer .document-peek-surface"), reader, "discussion keeps the exact Document surface mounted");
    assert.equal(document.querySelector("#document-peek-layer .document-peek-scroll"), readerScroll);
    assert.equal(readerScroll.scrollTop, 31, "discussion Back keeps the exact reading position");
    click(document, "[data-close-document-peek]");
    await settle(window);
    assert.equal(document.querySelector("#document-peek-layer").hidden, true);
    assert.equal(document.querySelector("#screen [data-tangent-area-map]"), map, `the next Back returns to the retained ${width}px Map`);
    window.close();
  }
});

test("journey 5: Go To opens the same Document above Brain and closes to its exact terminal", async () => {
  for (const width of [1440, 800]) {
    const { window, document, posts } = await bootWorkTable(fixture(), { startSurface: "map", documentRecord: servedDocument(), terminalStandin: true, width });
    await openProofBrain(window);
    const terminal = document.querySelector("[data-terminal-standin]");
    assert.ok(terminal, "the named Brain is open");
    terminal.value = `unsent terminal draft at ${width}`;
    terminal.focus();

    await openProofDocument(window);
    assert.equal(document.querySelector("[data-terminal-standin]"), terminal, "Go To does not remount the Brain terminal");
    assert.equal(terminal.value, `unsent terminal draft at ${width}`);
    assert.deepEqual(automaticBrainMutations(posts), []);

    click(document, "[data-close-document-peek]");
    await settle(window, 5);
    assert.equal(document.querySelector("#document-peek-layer").hidden, true);
    assert.equal(document.querySelector("[data-terminal-standin]"), terminal, `closing the ${width}px Document reveals the exact Brain terminal`);
    assert.equal(document.activeElement, terminal, "focus returns to the Brain composer");
    assert.equal(terminal.value, `unsent terminal draft at ${width}`);
    window.close();
  }
});

test("journey 7: stale Work keeps the last-known list and its controls usable", async () => {
  for (const width of [1440, 800]) {
    const { window, document } = await bootWorkTable(fixture(), {
      startSurface: "map", documentRecord: servedDocument(), width,
      /** Fails each Work refresh after the initial complete publication. */
      workHandler: ({ read }) => read > 1 ? { error: new Error("injected Work refresh failure") } : null,
    });
    const map = document.querySelector("#screen [data-tangent-area-map]");
    click(document, "#work-tab");
    await settle(window, 5);
    assert.equal(document.querySelector("#work-lens-freshness").dataset.state, "current", `Work begins from a complete publication at ${width}px`);
    click(document, "#menu-refresh");
    await settle(window, 10);

    const freshness = document.querySelector("#work-lens-freshness");
    assert.equal(freshness.dataset.state, "stale");
    assert.match(freshness.textContent, /Last known at/);
    const first = document.querySelector(`[data-goal-anchor="${AREA}/goal-needs-decision.md"]`);
    const second = document.querySelector(`[data-goal-anchor="${AREA}/goal-routine-progress.md"]`);
    assert.ok(first && second, "a failed refresh retains known rows instead of showing a false empty state");
    first.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settle(window);
    const motion = press(window, "j");
    await settle(window);
    assert.equal(motion.defaultPrevented, true, "the stale Work table still owns its navigation keys");
    assert.ok(document.querySelector(".work-row.cursor"), "the last-known list remains interactive");

    click(document, "[data-close-work-lens]");
    await settle(window);
    assert.equal(document.querySelector("#screen [data-tangent-area-map]"), map);
    window.close();
  }
});

test("Go To opens the exact Brain and agent, and a full-screen agent keeps a visible exact-return Go To route", async () => {
  for (const width of [1440, 800]) {
    const { window, document } = await bootWorkTable(fixture(), {
      startSurface: "map", documentRecord: servedDocument(), terminalStandin: true, width,
    });
    click(document, "#work-tab");
    await settle(window, 5);
    const routine = document.querySelector(`[data-goal-anchor="${AREA}/goal-routine-progress.md"]`);
    const routineControl = routine.querySelector("[data-work-row-title]");
    routine.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    routineControl.focus();
    const retainedSearch = await keepWorkSearch(window, "routine");
    const searchBar = document.querySelector("#work-search");
    assert.equal(searchBar.hidden, false);
    assert.equal(searchBar.hasAttribute("inert"), false);

    click(document, "#go-to-button");
    await settle(window, 5);
    const agent = [...document.querySelectorAll("[data-go-to-row]")].find((item) => item.textContent.includes("map-proof-working"));
    assert.ok(agent, "Go To contains the current runtime agent");
    agent.click();
    await settle(window, 5);
    const sessionLayer = document.querySelector("#session-layer");
    const workLayer = document.querySelector("#work-lens-layer");
    assert.equal(sessionLayer.hidden, false, `the exact ${width}px agent session opens`);
    assert.equal(document.querySelector("#session-layer-terminal").dataset.session, "map-proof-working");
    assert.equal(workLayer.hidden, false, "agent inspection retains Work and its query below");
    assert.equal(workLayer.hasAttribute("inert"), true, "assistive input reaches only the agent dialog");
    assert.equal(searchBar.hidden, true, "the retained Work search cannot cover the agent dialog");
    assert.equal(searchBar.hasAttribute("inert"), true, "the retained Work search is silent to assistive input");
    assert.equal(document.querySelector("#session-layer [data-close-session-layer]").getAttribute("aria-label"), "Back to Work");
    assert.match(document.querySelector(".session-surface").getAttribute("aria-label"), /Continue routine indexing session/);

    const agentTerminal = document.querySelector("#session-layer [data-terminal-standin]");
    agentTerminal.value = `agent draft at ${width}`;
    agentTerminal.focus();
    const visibleGoTo = document.querySelector("#session-layer [data-session-go-to]");
    assert.equal(visibleGoTo.hidden, false, "full-screen terminal chrome keeps a visible Go To action");
    visibleGoTo.click();
    await settle(window, 5);
    assert.equal(document.querySelector("#go-to-layer").hidden, false);
    assert.equal(document.activeElement, document.querySelector("#go-to-input"), "Go To announces and focuses its search field");
    assert.equal(sessionLayer.hasAttribute("inert"), true, "the terminal is silent while Go To is the top dialog");
    press(window, "Escape");
    await settle(window, 5);
    assert.equal(document.querySelector("#go-to-layer").hidden, true);
    assert.equal(document.querySelector("#session-layer [data-terminal-standin]"), agentTerminal, "closing Go To keeps the exact agent terminal");
    assert.equal(document.activeElement, agentTerminal, "closing terminal Go To restores composer focus");
    assert.equal(agentTerminal.value, `agent draft at ${width}`);

    click(document, "[data-close-session-layer]");
    await settle(window, 5);
    assert.equal(sessionLayer.hidden, true);
    assert.equal(workLayer.hidden, false);
    assert.equal(searchBar.hidden, false, "agent Back reveals the retained Work search");
    assert.equal(searchBar.hasAttribute("inert"), false);
    assert.equal(retainedSearch.value, "routine", "agent inspection preserves the exact Work query");
    assert.equal(document.activeElement?.closest("[data-goal-anchor]")?.dataset.goalAnchor, `${AREA}/goal-routine-progress.md`, "agent Back restores its exact Work row");

    const areaControl = document.querySelector(`[data-work-cursor="area:${AREA}"] [data-work-cursor-control]`);
    areaControl.focus();
    click(document, "#go-to-button");
    await settle(window, 5);
    const brain = [...document.querySelectorAll("[data-go-to-row]")].find((item) => /Brain/.test(item.textContent) && /Tangent/i.test(item.textContent));
    assert.ok(brain, "Go To contains the named Area Brain");
    brain.click();
    await settle(window, 6);
    assert.equal(workLayer.hidden, true, "Go To removes Work from above the selected Brain");
    assert.equal(workLayer.hasAttribute("inert"), true, "the hidden Work lens cannot intercept Brain input");
    assert.match(document.querySelector("[data-map-brain-pane] > header strong")?.textContent ?? "", /Tangent Brain/);
    assert.equal(document.activeElement?.hasAttribute("data-terminal-standin"), true, `the ${width}px Brain accepts typing immediately`);

    click(document, "#back-button");
    await settle(window, 6);
    assert.equal(workLayer.hidden, false, "Brain Back restores the retained Work lens");
    assert.equal(document.activeElement?.closest("[data-work-cursor]")?.dataset.workCursor, `area:${AREA}`, "Brain Back restores the exact Work cursor and focus");
    window.close();
  }
});

test("a failed Work refresh repaints above a retained Document and closes back one exact stage", async () => {
  for (const width of [1440, 800]) {
    const { window, document } = await bootWorkTable(fixture(), {
      startSurface: "map", documentRecord: servedDocument(), width,
      /** Fails the refresh performed while Work covers the retained Document. */
      workHandler: ({ read }) => read > 1 ? { error: new Error("injected Work refresh failure above Document") } : null,
    });
    const map = document.querySelector("#screen [data-tangent-area-map]");
    await openProofDocument(window);
    const reader = document.querySelector("#document-peek-layer");
    const readerSurface = reader.querySelector(".document-peek-surface");
    readerSurface.scrollTop = 37;
    readerSurface.focus();
    click(document, "#work-tab");
    await settle(window, 5);
    const work = document.querySelector("#work-lens-layer");
    assert.equal(work.hidden, false);
    assert.equal(reader.hidden, false, "Work keeps the quick Document mounted below it");
    assert.equal(reader.hasAttribute("inert"), true, "the retained Document is silent while Work is on top");

    click(document, "#menu-refresh");
    await settle(window, 10);
    assert.equal(document.querySelector("#work-lens-freshness").dataset.state, "stale", `the ${width}px Work layer repaints after the failed publication`);
    assert.match(document.querySelector("#work-lens-freshness").textContent, /Last known at/);
    assert.ok(document.querySelector(`[data-goal-anchor="${AREA}/goal-needs-decision.md"]`), "known Work rows remain above the Document");

    click(document, "[data-close-work-lens]");
    await settle(window, 5);
    assert.equal(work.hidden, true);
    assert.equal(reader.hidden, false, "closing Work reveals the same quick Document");
    assert.equal(reader.hasAttribute("inert"), false);
    assert.equal(reader.querySelector(".document-peek-surface"), readerSurface, "the failed refresh never remounts the retained Document");
    assert.equal(readerSurface.scrollTop, 37, "the retained Document keeps its reading position");
    assert.equal(document.activeElement, readerSurface, "closing Work restores the exact Document focus target");
    assert.match(reader.querySelector(".document-peek-title")?.textContent ?? "", /Map-first proof/);
    click(document, "[data-close-document-peek]");
    await settle(window, 5);
    assert.equal(document.querySelector("#screen [data-tangent-area-map]"), map, "the next Close reveals the exact retained Map");
    window.close();
  }
});

test("Work → Document → Map returns through the retained Document to the exact Work row", async () => {
  for (const width of [1440, 800]) {
    const { window, document } = await bootWorkTable(fixture(), {
      startSurface: "map", documentRecord: servedDocument(), width,
    });
    click(document, "#work-tab");
    await settle(window, 5);
    const work = document.querySelector("#work-lens-layer");
    const workContent = document.querySelector("#work-lens-content");
    const row = document.querySelector(`[data-goal-anchor="${AREA}/goal-routine-progress.md"]`);
    const rowTitle = row.querySelector("[data-work-row-title]");
    row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    rowTitle.focus();
    const retainedSearch = await keepWorkSearch(window, "routine");
    const searchBar = document.querySelector("#work-search");
    workContent.scrollTop = 43;

    await openProofDocument(window);
    const reader = document.querySelector("#document-peek-layer .document-peek-surface");
    assert.equal(work.hidden, false, "the Document initially retains Work below it");
    assert.equal(work.hasAttribute("inert"), true);
    assert.equal(searchBar.hidden, true, "the retained Work search cannot cover the Document");
    assert.equal(searchBar.hasAttribute("inert"), true);
    click(document, "[data-show-document-on-map]");
    await settle(window, 5);
    assert.equal(work.hidden, true, `the ${width}px Map route temporarily hides Work with the Document`);
    assert.equal(document.querySelector("#document-peek-layer").hidden, true);

    click(document, "#back-button");
    await settle(window, 5);
    assert.equal(document.querySelector("#document-peek-layer .document-peek-surface"), reader, "Back restores the exact retained Document");
    assert.equal(work.hidden, false, "Back also restores Work beneath the Document");
    assert.equal(work.hasAttribute("inert"), true, "the restored Work lens stays silent while Document is on top");
    assert.equal(searchBar.hidden, true, "the Work search stays hidden until Document closes");
    assert.equal(workContent.scrollTop, 43, "the retained Work scroll survives the Map detour");

    click(document, "[data-close-document-peek]");
    await settle(window, 5);
    assert.equal(work.hidden, false, "closing Document reveals Work instead of skipping to Map");
    assert.equal(work.hasAttribute("inert"), false);
    assert.equal(searchBar.hidden, false, "closing Document reveals the retained Work search");
    assert.equal(searchBar.hasAttribute("inert"), false);
    assert.equal(retainedSearch.value, "routine");
    assert.equal(document.querySelector(`[data-goal-anchor="${AREA}/goal-routine-progress.md"] [data-work-row-title]`), rowTitle, "the exact Work row node is retained");
    assert.equal(document.activeElement, rowTitle, `the ${width}px route restores exact Work focus`);
    window.close();
  }
});

test("Work → Document → Go To → Brain returns to Document above the retained Work row", async () => {
  for (const width of [1440, 800]) {
    const { window, document, posts } = await bootWorkTable(fixture(), {
      startSurface: "map", documentRecord: servedDocument(), terminalStandin: true, width,
    });
    click(document, "#work-tab");
    await settle(window, 5);
    const work = document.querySelector("#work-lens-layer");
    const row = document.querySelector(`[data-goal-anchor="${AREA}/goal-routine-progress.md"]`);
    const rowTitle = row.querySelector("[data-work-row-title]");
    row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    rowTitle.focus();

    await openProofDocument(window);
    const reader = document.querySelector("#document-peek-layer .document-peek-surface");
    await openProofBrain(window);
    assert.equal(work.hidden, true, "the Brain temporarily removes Work from above its retained Document");
    assert.ok(document.querySelector(".document-discussion-workspace"));
    assert.deepEqual(automaticBrainMutations(posts), [], "generic Brain navigation sends and starts nothing");

    click(document, "[data-leave-area-workspace]");
    await settle(window, 6);
    const restoredReader = document.querySelector("#document-peek-layer .document-peek-surface");
    assert.ok(restoredReader, "Brain Back restores the Document reader");
    assert.equal(restoredReader.getAttribute("aria-label"), reader.getAttribute("aria-label"));
    assert.equal(work.hidden, false, "Brain Back restores Work beneath the Document");
    assert.equal(work.classList.contains("top-layer"), false, "the retained Work lens does not cover the restored Document");
    assert.equal(work.hasAttribute("inert"), true, "assistive input reaches only the restored Document");
    assert.equal(document.activeElement, restoredReader, `the ${width}px Brain Back focuses the restored Document`);

    click(document, "[data-close-document-peek]");
    await settle(window, 5);
    assert.equal(work.hidden, false);
    assert.equal(work.hasAttribute("inert"), false);
    assert.equal(document.querySelector(`[data-goal-anchor="${AREA}/goal-routine-progress.md"] [data-work-row-title]`), rowTitle);
    assert.equal(document.activeElement, rowTitle, `closing Document restores exact ${width}px Work focus`);
    window.close();
  }
});

test("Go To agent inspection stages through Work and then returns exactly to Map, Document, or Brain", async () => {
  for (const width of [1440, 800]) {
    const { window, document } = await bootWorkTable(fixture(), {
      startSurface: "map", documentRecord: servedDocument(), terminalStandin: true, width,
    });
    const map = document.querySelector("#screen [data-tangent-area-map]");
    map.setAttribute("tabindex", "0");
    map.focus();
    click(document, "#go-to-button");
    await settle(window, 5);
    const mapAgent = [...document.querySelectorAll("[data-go-to-row]")].find((item) => item.textContent.includes("map-proof-working"));
    mapAgent.click();
    await settle(window, 5);
    let work = document.querySelector("#work-lens-layer");
    assert.equal(work.hidden, false);
    assert.equal(work.hasAttribute("inert"), true);
    assert.equal(document.querySelector("#session-layer [data-close-session-layer]").getAttribute("aria-label"), "Back to Work");
    click(document, "[data-close-session-layer]");
    await settle(window, 5);
    assert.equal(work.hasAttribute("inert"), false);
    click(document, "[data-close-work-lens]");
    await settle(window, 5);
    assert.equal(document.querySelector("#screen [data-tangent-area-map]"), map);
    assert.equal(document.activeElement, map);

    await openProofDocument(window);
    const reader = document.querySelector("#document-peek-layer .document-peek-surface");
    reader.focus();
    press(window, "k", { metaKey: true });
    await settle(window, 5);
    assert.equal(document.activeElement, document.querySelector("#go-to-input"), "Command-K focuses Go To outside a Document");
    const documentAgent = [...document.querySelectorAll("[data-go-to-row]")].find((item) => item.textContent.includes("map-proof-working"));
    documentAgent.click();
    await settle(window, 5);
    const session = document.querySelector("#session-layer");
    assert.equal(session.hidden, false, "agent inspection is visible above the retained Document");
    assert.equal(session.classList.contains("top-layer"), true);
    assert.equal(document.querySelector("#document-peek-layer").hasAttribute("inert"), true);
    work = document.querySelector("#work-lens-layer");
    assert.equal(work.hidden, false, "the Agent's Work inspection stays mounted above Document");
    assert.equal(work.hasAttribute("inert"), true);
    assert.equal(document.querySelector("#session-layer-terminal").dataset.session, "map-proof-working");
    assert.equal(document.querySelector("#session-layer [data-close-session-layer]").getAttribute("aria-label"), "Back to Work");
    click(document, "[data-close-session-layer]");
    await settle(window, 5);
    assert.equal(work.hasAttribute("inert"), false);
    assert.equal(document.querySelector("#document-peek-layer").hasAttribute("inert"), true);
    click(document, "[data-close-work-lens]");
    await settle(window, 5);
    assert.equal(document.querySelector("#document-peek-layer .document-peek-surface"), reader);
    assert.equal(document.activeElement, reader, `Work Close restores exact ${width}px Document focus`);

    click(document, "[data-close-document-peek]");
    await settle(window, 5);
    await openProofBrain(window);
    const brainTerminal = document.querySelector("[data-map-brain-pane] [data-terminal-standin]");
    brainTerminal.value = `brain draft at ${width}`;
    brainTerminal.focus();
    click(document, "#go-to-button");
    await settle(window, 5);
    assert.equal(document.activeElement, document.querySelector("#go-to-input"), "the visible terminal route focuses Go To search");
    const brainAgent = [...document.querySelectorAll("[data-go-to-row]")].find((item) => item.textContent.includes("map-proof-working"));
    brainAgent.click();
    await settle(window, 5);
    assert.equal(document.querySelector("#session-layer-terminal").dataset.session, "map-proof-working");
    work = document.querySelector("#work-lens-layer");
    assert.equal(work.hidden, false);
    assert.equal(document.querySelector("#session-layer [data-close-session-layer]").getAttribute("aria-label"), "Back to Work");
    click(document, "[data-close-session-layer]");
    await settle(window, 5);
    assert.equal(work.hasAttribute("inert"), false);
    click(document, "[data-close-work-lens]");
    await settle(window, 5);
    assert.equal(document.querySelector("[data-map-brain-pane] [data-terminal-standin]"), brainTerminal, "agent Back retains the exact Brain terminal");
    assert.equal(document.activeElement, brainTerminal, `Work Close restores exact ${width}px Brain focus`);
    assert.equal(brainTerminal.value, `brain draft at ${width}`);
    window.close();
  }
});

test("Go To routes a bounded unknown agent to its exact Problems consequence", async () => {
  for (const width of [1440, 800]) {
    const source = fixture();
    const workProjection = legacyFixtureWork(source);
    workProjection.agents.push({
      id: "unassigned-unknown-agent", target: "unassigned-unknown-agent:0.0", role: "worker", areaId: null,
      owner: { kind: "none", id: null }, liveness: "unknown", activity: "unknown", activityDetail: "none",
      activitySince: null, evidence: "bounded fixture observation failed", observedAt: "2026-09-01T00:00:00.000Z",
      contextUsedTokens: null, cwd: null, launchRef: null, createdAt: null, workTitle: "Unassigned recovery agent",
    });
    const navigationSearch = {
      rows: [{ kind: "agent", id: "unassigned-unknown-agent", session: "unassigned-unknown-agent", area: "", goalId: null, name: "Unassigned recovery agent", role: "worker", status: "unknown", live: false }],
      areas: [], kinds: ["agent"],
    };
    const { window, document } = await bootWorkTable(source, { startSurface: "map", width, workProjection, navigationSearch });
    click(document, "#go-to-button");
    await settle(window, 5);
    click(document, "[data-go-to-row]");
    await settle(window, 5);
    assert.equal(document.querySelector("#work-lens-layer").hidden, false);
    assert.equal(document.querySelector("#work-lens-title").textContent, "Problems");
    const consequence = document.querySelector('[data-work-cursor="problem:agent:unassigned-unknown-agent"]');
    assert.ok(consequence, `the ${width}px Problems lens contains the exact unknown Agent consequence`);
    assert.match(consequence.textContent, /bounded fixture observation failed/);
    window.close();
  }
});

test("a live or stopped Work Brain has the same retained surface route by pointer and keyboard", async () => {
  for (const width of [1440, 800]) {
    for (const lifecycle of ["live", "stopped"]) for (const activation of ["pointer", "keyboard"]) {
      const source = fixture();
      if (lifecycle === "stopped") {
        source.sessions = source.sessions.filter((session) => session.kind !== "brain");
        source.brains = [{
          area: AREA, status: "inactive", live: false, session: "otto-tangent--brain",
          generation: 4, state: "stopped", forJulian: [], requests: [],
        }];
      }
      const { window, document, posts } = await bootWorkTable(source, {
        startSurface: "map", documentRecord: servedDocument(), terminalStandin: true, width,
      });
      click(document, "#work-tab");
      await settle(window, 5);
      const row = document.querySelector(`[data-work-cursor="area:${AREA}"]`);
      row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      const areaControl = row.querySelector("[data-work-cursor-control]");
      const brainControl = row.querySelector("[data-open-brain], [data-open-area-brain]");
      if (activation === "pointer") {
        brainControl.focus();
        brainControl.click();
      } else {
        areaControl.focus();
        press(window, "Enter", { metaKey: true, shiftKey: true });
      }
      const brainSurface = await waitForProof(window, () => lifecycle === "stopped"
        ? document.querySelector("[data-map-brain-pane] .map-brain-start")
        : document.querySelector("[data-map-brain-pane] [data-terminal-standin]"), `${lifecycle} ${activation} opens its Brain surface`);
      assert.equal(document.querySelector("#work-lens-layer").hidden, true, `${lifecycle} ${activation} leaves the same retained Work surface`);
      assert.match(document.querySelector("[data-map-brain-pane] > header strong")?.textContent ?? "", /Otto \/ Tangent Brain/);
      if (lifecycle === "stopped") assert.ok(brainSurface, `${activation} opens the stopped Brain composer surface`);
      else assert.equal(brainSurface.closest("[data-session]")?.dataset.session, "otto-tangent--brain");
      assert.deepEqual(automaticBrainMutations(posts), [], `${lifecycle} ${activation} starts and sends nothing`);
      click(document, "[data-leave-area-workspace]");
      await settle(window, 6);
      assert.equal(document.querySelector("#work-lens-layer").hidden, false);
      assert.equal(document.activeElement?.closest("[data-work-cursor]")?.dataset.workCursor, `area:${AREA}`);
      window.close();
    }
  }
});

test("journey 10: every route keeps a named keyboard path and one accessible active surface", { timeout: 60_000 }, async () => {
  const routes = [
    {
      name: "Map → Brain",
      /** Proves the Map-to-Brain route and exact keyboard return. */
      async run({ window, document }) {
        const map = focusRouteMap(document);
        await openRouteBrain(window);
        assert.equal(document.querySelector("#screen").hasAttribute("inert"), false);
        press(window, "Enter", { metaKey: true, shiftKey: true });
        await settle(window, 6);
        assertRouteMap(document, map);
        assert.equal(document.activeElement, map);
      },
    },
    {
      name: "Map → Document",
      /** Proves the Map-to-Document route and exact keyboard return. */
      async run({ window, document }) {
        const map = focusRouteMap(document);
        const { block } = await openRouteDocument(window);
        assert.equal(document.querySelector("#screen").hasAttribute("inert"), true);
        await activateNamedControl(window, document.querySelector("[data-close-document-peek]"), /Close/);
        assertRouteMap(document, map);
        assert.equal(document.activeElement, block);
      },
    },
    {
      name: "Map → Work",
      /** Proves the Map-to-Work route and exact keyboard return. */
      async run({ window, document }) {
        const map = focusRouteMap(document);
        await openRouteWork(window);
        const opener = document.querySelector("#work-tab");
        assert.equal(document.querySelector("#screen").hasAttribute("inert"), true);
        press(window, "Escape");
        await settle(window, 5);
        assertRouteMap(document, map);
        assert.equal(document.activeElement, opener);
      },
    },
    {
      name: "Brain → Map",
      /** Proves the Brain-to-Map route while retaining the terminal draft. */
      async run({ window, document }) {
        const map = focusRouteMap(document);
        const pane = await openRouteBrain(window);
        const terminal = pane.querySelector("[data-terminal-standin]");
        terminal.value = "retained Brain draft";
        const showMap = pane.querySelector("[data-toggle-workspace-map]");
        await activateNamedControl(window, showMap, /Show Otto \/ Tangent on Map/);
        assert.match(document.querySelector("#back-button").textContent, /Brain/, "Show on Map names Brain as the return target");
        const mapPane = document.querySelector('[data-split-pane="map"]');
        const brainPane = document.querySelector('[data-split-pane="brain"]');
        assert.equal(mapPane.classList.contains("focused"), true, `Show on Map focuses the Map pane; active=${document.activeElement?.tagName}:${document.activeElement?.getAttribute?.("data-map-block") ?? document.activeElement?.getAttribute?.("data-terminal-standin") ?? document.activeElement?.textContent?.trim?.().slice(0, 40)}; map=${mapPane.className}; brain=${brainPane.className}`);
        assertRouteMap(document, map);
        await activateNamedControl(window, document.querySelector("#back-button"), /Brain/);
        assert.equal(document.querySelector("[data-map-brain-pane] [data-terminal-standin]"), terminal);
        assert.equal(terminal.value, "retained Brain draft");
        assert.equal(document.activeElement, terminal);
      },
    },
    {
      name: "Brain → Document",
      /** Proves the Brain-to-Document route and exact terminal return. */
      async run({ window, document }) {
        await openRouteBrain(window);
        const terminal = document.querySelector("[data-map-brain-pane] [data-terminal-standin]");
        terminal.value = "Brain Go To draft";
        terminal.focus();
        await chooseGoToWithKeyboard(window, { query: "map first proof", kind: "page", id: DOCUMENT.title, open: "pointer" });
        const reader = document.querySelector("#document-peek-layer .document-peek-surface");
        assert.equal(reader.getAttribute("aria-label"), DOCUMENT.title);
        assert.equal(document.querySelector("#screen").hasAttribute("inert"), true);
        document.querySelector("[data-close-document-peek]").click();
        await settle(window, 5);
        assert.equal(document.querySelector("[data-map-brain-pane] [data-terminal-standin]"), terminal);
        assert.equal(terminal.value, "Brain Go To draft");
        assert.equal(document.activeElement, terminal);
      },
    },
    {
      name: "Brain → Work",
      /** Proves the Brain-to-Work route and exact terminal return. */
      async run({ window, document }) {
        await openRouteBrain(window);
        const terminal = document.querySelector("[data-map-brain-pane] [data-terminal-standin]");
        terminal.value = "Brain Work draft";
        terminal.focus();
        await openRouteWork(window);
        const opener = document.querySelector("#work-tab");
        assert.equal(document.querySelector("[data-map-brain-pane] [data-terminal-standin]"), terminal);
        assert.equal(document.querySelector("#screen").hasAttribute("inert"), true);
        press(window, "Escape");
        await settle(window, 5);
        assert.equal(document.querySelector("[data-map-brain-pane] [data-terminal-standin]"), terminal);
        assert.equal(terminal.value, "Brain Work draft");
        assert.equal(document.activeElement, opener);
      },
    },
    {
      name: "Document → Brain",
      /** Proves the Document-to-Brain discussion route and retained reader. */
      async run({ window, document, posts }) {
        const { reader } = await openRouteDocument(window);
        const scroll = reader.querySelector(".document-peek-scroll");
        scroll.scrollTop = 29;
        reader.focus();
        press(window, "Enter", { metaKey: true, shiftKey: true });
        await settle(window, 6);
        assert.equal(document.querySelector("[data-brain-subject] span").textContent, DOCUMENT.title);
        assert.match(document.querySelector("[data-map-brain-pane] > header strong")?.textContent ?? "", /Otto \/ Tangent Brain/);
        assert.equal(document.querySelectorAll('#document-peek-layer [role="dialog"][aria-modal="true"]').length, 1, "the combined discussion exposes one modal surface");
        assert.equal(reader.getAttribute("role"), "region", "the retained reader is a named region inside the discussion modal");
        assert.equal(reader.hasAttribute("aria-modal"), false);
        assert.deepEqual(automaticBrainMutations(posts), []);
        if (window.innerWidth <= 900) {
          const documentSwitch = document.querySelector('[data-document-discussion-surface="document"]');
          await activateNamedControl(window, documentSwitch, /^Document$/);
          const close = reader.querySelector("[data-close-document-peek]");
          close.focus();
          const tab = press(window, "Tab");
          assert.equal(tab.defaultPrevented, true, "Tab wraps before a hidden Brain control");
          assert.equal(document.activeElement, documentSwitch, "the compact discussion wraps to its first visible switcher");
          await activateNamedControl(window, document.querySelector('[data-document-discussion-surface="brain"]'), /Brain/);
        }
        press(window, "Enter", { metaKey: true, shiftKey: true });
        await settle(window, 6);
        assert.equal(document.querySelector("#document-peek-layer .document-peek-surface"), reader);
        assert.equal(reader.getAttribute("role"), "dialog");
        assert.equal(reader.getAttribute("aria-modal"), "true");
        assert.equal(scroll.scrollTop, 29);
        assert.equal(document.activeElement, reader);
      },
    },
    {
      name: "Document → Map",
      /** Proves the Document-to-Map route and exact reader return. */
      async run({ window, document }) {
        const map = focusRouteMap(document);
        const { reader } = await openRouteDocument(window);
        const showMap = reader.querySelector("[data-show-document-on-map]");
        await activateNamedControl(window, showMap, /Show Map-first proof on Otto \/ Tangent Map/);
        assertRouteMap(document, map);
        await activateNamedControl(window, document.querySelector("#back-button"), /Document/);
        assert.equal(document.querySelector("#document-peek-layer .document-peek-surface"), reader);
        assert.equal(document.activeElement, showMap);
      },
    },
    {
      name: "Document → Work",
      /** Proves the Document-to-Work route and exact reader return. */
      async run({ window, document }) {
        const { reader } = await openRouteDocument(window);
        reader.focus();
        await openRouteWork(window);
        const opener = document.querySelector("#work-tab");
        assert.equal(document.querySelector("#document-peek-layer").hasAttribute("inert"), true);
        press(window, "Escape");
        await settle(window, 5);
        assert.equal(document.querySelector("#document-peek-layer .document-peek-surface"), reader);
        assert.equal(document.activeElement, opener);
      },
    },
    {
      name: "Work → Map",
      /** Proves the Work-to-Map route and exact row return. */
      async run({ window, document }) {
        const map = focusRouteMap(document);
        await openRouteWork(window);
        const { row, control } = focusRouteWorkRow(window, `area:${AREA}`);
        assert.equal(row.querySelector("[data-open-area-map]").getAttribute("aria-label"), "Show Otto / Tangent on Map");
        press(window, "m");
        await settle(window, 6);
        assertRouteMap(document, map);
        await activateNamedControl(window, document.querySelector("#back-button"), /Work/);
        assert.equal(document.querySelector("#work-lens-layer").hidden, false);
        assert.equal(document.activeElement, control);
      },
    },
    {
      name: "Work → Brain",
      /** Proves the Work-to-Brain route and exact row return. */
      async run({ window, document }) {
        focusRouteMap(document);
        await openRouteWork(window);
        const { control } = focusRouteWorkRow(window, `area:${AREA}`);
        press(window, "Enter", { metaKey: true, shiftKey: true });
        await settle(window, 6);
        const terminal = document.querySelector("[data-map-brain-pane] [data-terminal-standin]");
        assert.ok(terminal);
        assert.equal(document.querySelector("#work-lens-layer").hidden, true);
        assert.equal(document.activeElement, terminal);
        press(window, "Enter", { metaKey: true, shiftKey: true });
        await settle(window, 6);
        assert.equal(document.querySelector("#work-lens-layer").hidden, false);
        assert.equal(document.activeElement, control);
      },
    },
    {
      name: "Work → Document",
      /** Proves the Work-to-Document route and exact row return. */
      async run({ window, document }) {
        focusRouteMap(document);
        await openRouteWork(window);
        const { control } = focusRouteWorkRow(window);
        await chooseGoToWithKeyboard(window, { query: "map first proof", kind: "page", id: DOCUMENT.title });
        assert.equal(document.querySelector("#work-lens-layer").hidden, false);
        assert.equal(document.querySelector("#work-lens-layer").hasAttribute("inert"), true);
        assert.equal(document.querySelector("#document-peek-layer .document-peek-surface").getAttribute("aria-label"), DOCUMENT.title);
        document.querySelector("[data-close-document-peek]").click();
        await settle(window, 5);
        assert.equal(document.querySelector("#work-lens-layer").hasAttribute("inert"), false);
        assert.equal(document.activeElement, control);
      },
    },
    {
      name: "Go To → Area",
      /** Proves that Go To selects and announces the exact Area. */
      async run({ window, document }) {
        const map = focusRouteMap(document);
        await chooseGoToWithKeyboard(window, { query: "area tangent", kind: "Area", id: "Tangent" });
        assertRouteMap(document, map);
        assert.match(document.querySelector("#context-brain-button").getAttribute("aria-label"), /Otto \/ Tangent Brain/);
      },
    },
    {
      name: "Go To → Document",
      /** Proves that Go To opens the exact Document above Map. */
      async run({ window, document }) {
        const map = focusRouteMap(document);
        await chooseGoToWithKeyboard(window, { query: "map first proof", kind: "page", id: DOCUMENT.title });
        assert.equal(document.querySelector("#document-peek-layer .document-peek-surface").getAttribute("aria-label"), DOCUMENT.title);
        document.querySelector("[data-close-document-peek]").click();
        await settle(window, 5);
        assertRouteMap(document, map);
        assert.equal(document.activeElement, map);
      },
    },
    {
      name: "Go To → Brain",
      /** Proves that Go To opens the exact Brain and returns to Map. */
      async run({ window, document }) {
        const map = focusRouteMap(document);
        await chooseGoToWithKeyboard(window, { query: "brain tangent", kind: "Brain", id: "Tangent" });
        assert.match(document.querySelector("[data-map-brain-pane] > header strong")?.textContent ?? "", /Otto \/ Tangent Brain/);
        assert.equal(document.activeElement?.hasAttribute("data-terminal-standin"), true);
        press(window, "Enter", { metaKey: true, shiftKey: true });
        await settle(window, 6);
        assertRouteMap(document, map);
      },
    },
    {
      name: "Go To → Goal or agent",
      /** Proves Goal and agent selection with exact retained Work context. */
      async run({ window, document }) {
        const map = focusRouteMap(document);
        await chooseGoToWithKeyboard(window, { query: "continue routine", kind: "Goal", id: "Continue routine indexing" });
        assert.equal(document.querySelector("#work-lens-layer").hidden, false);
        assert.ok(document.querySelector(`[data-work-cursor="goal:${AREA}/goal-routine-progress.md"]`));
        press(window, "Escape");
        await settle(window, 5);
        assertRouteMap(document, map);
        map.focus();
        await chooseGoToWithKeyboard(window, { query: "map proof working", kind: "Agent", id: "map-proof-working" });
        const work = document.querySelector("#work-lens-layer");
        assert.equal(work.hidden, false, "the selected live Agent has a retained Work inspection state");
        assert.equal(work.hasAttribute("inert"), true, "the quick session alone accepts input above Work");
        const agentWorkRow = document.querySelector(`[data-work-cursor="goal:${AREA}/goal-routine-progress.md"]`);
        assert.ok(agentWorkRow, "Work selects the live Agent's owning Goal");
        assert.equal(document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor, agentWorkRow.dataset.workCursor);
        assert.equal(document.querySelector("#session-layer-terminal").dataset.session, "map-proof-working");
        assert.equal(document.querySelector("#session-layer [data-close-session-layer]").getAttribute("aria-label"), "Back to Work");
        document.querySelector("#session-layer [data-close-session-layer]").click();
        await settle(window, 5);
        assert.equal(work.hasAttribute("inert"), false);
        assert.equal(document.activeElement?.closest("[data-work-cursor]")?.dataset.workCursor, agentWorkRow.dataset.workCursor, "Agent Back focuses its exact Work inspection row");
        document.querySelector("[data-close-work-lens]").click();
        await settle(window, 5);
        assertRouteMap(document, map);
      },
    },
  ];

  for (const width of [1440, 800]) {
    for (const route of routes) {
      const proof = await bootRouteProof(width);
      try {
        await route.run(proof);
      } catch (error) {
        throw new Error(`${route.name} failed at ${width}px: ${error?.stack || error}`);
      } finally {
        proof.window.close();
      }
    }
  }
});

test("journey 9: restart opens Map and offers explicit discussion resume without automatic send", async () => {
  for (const width of [1440, 800]) {
    const first = await bootWorkTable(fixture(), { startSurface: "map", documentRecord: servedDocument(), terminalStandin: true, width });
    await openProofDocument(first.window);
    click(first.document, "[data-discuss-document]");
    await settle(first.window, 5);
    const retained = first.window.localStorage.getItem("agent-shell.resume-context.v1");
    assert.ok(retained, "the interrupted Document and Brain context has a clean resume marker");
    first.window.close();

    const restarted = await bootWorkTable(fixture(), {
      startSurface: "map", documentRecord: servedDocument(), terminalStandin: true, width,
      workState: "stale",
      localStorageEntries: { "agent-shell.resume-context.v1": retained },
    });
    const { window, document, posts } = restarted;
    assert.ok(document.querySelector("#screen [data-tangent-area-map]"), `restart opens the ${width}px Map first`);
    assert.equal(document.querySelector("#document-peek-layer").hidden, true, "recovery does not open context automatically");
    const offer = document.querySelector("[data-resume-context-banner]");
    assert.match(offer.textContent, /Resume Document discussion\?/);
    assert.match(offer.textContent, /Nothing was sent/);
    assert.deepEqual(automaticBrainMutations(posts), []);

    click(document, "#work-tab");
    await settle(window, 5);
    assert.equal(document.querySelector("#work-lens-freshness").dataset.state, "stale", "restart retains the last complete Work snapshot until a new publication exists");
    assert.match(document.querySelector("#work-lens-freshness").textContent, /Last known at/);
    click(document, "[data-close-work-lens]");
    await settle(window, 5);

    click(document, "[data-resume-document-context]");
    await settle(window, 6);
    assert.ok(document.querySelector(".document-discussion-workspace"), "only the explicit choice restores Document and Brain");
    assert.equal(document.querySelector("[data-brain-subject]").hidden, false);
    assert.equal(document.querySelector("[data-brain-subject] span").textContent, DOCUMENT.title);
    assert.deepEqual(automaticBrainMutations(posts), [], "explicit recovery still sends and starts nothing");
    window.close();
  }
});
