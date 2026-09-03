# Map-first main-surface workflows: design record

Date: 2026-09-02

Status: accepted for implementation in `map-first-main-surface`.

Lens: product experience. No persistence, server, vault, or tmux contract changes.

## Problem contract

Julian uses Map to locate an Area, Work to scan active work, and Brain to continue the responsible Area conversation.

The blocked outcome is a reliable route to the correct Brain without loss of Map or Work context.

This route is frequent. A wrong Brain label can send a message to the wrong Area. Duplicate routes also hide the active surface.

Observable success:

1. Map, Work, Go To, Area blocks, and Documents open one shared Brain presentation.
2. The global Brain action always names and opens the Brain for the active context.
3. The Map and Work routes retain selection, focus, filters, scroll, drafts, camera, and terminal state.
4. Each visible shortcut runs the same action as its pointer control.
5. Wide mode keeps both companion panes usable. At 800px, one retained pane is visible and the other is inert.
6. A transport interruption never claims that the Brain or tmux session ended.
7. Recovery feedback does not replace another toast, open a modal, or move focus.

Constraints:

- Map remains the durable home. Work remains a temporary lens above it.
- Brain remains contextual. It does not become a third primary work surface.
- Map and Work remain the two primary route controls.
- A retained pane must not remount for focus, resize, refresh, or compact presentation changes.
- Document discussion keeps its removable subject and sends nothing automatically.
- Terminal recovery keeps the last frame and never changes tmux lifetime.

Non-goals:

- This change does not alter Brain, Goal, queue, or session authority.
- This change does not redesign Excalidraw or the Work table.
- This change does not explain or suppress the macOS Terminal warning in `codex-clipboard-hZlaoE.png`.

The repository contains no matching warning text. Agent Shell does not launch Terminal.app. A separate reproduction is necessary before that warning can support a product change.

## Evidence

### Screenshots

**Observed:** `codex-clipboard-AA2vyl.png` retains a selected Neara / Designwarden Map beside its live Brain.

**Observed:** The same frame shows four Map labels or actions. It also shows both a Back route and two pane-local Map routes.

**Observed:** The pane names Neara / Designwarden Brain, but the global Brain action names Otto / Tangent Brain.

**Observed:** The pane navigation wraps and truncates at a wide viewport. The global Brain action has no visible shortcut.

**Observed:** `codex-clipboard-11AvsG.png` shows a global `Terminal reconnected.` toast. It does not name the transport layer.

**Observed:** `codex-clipboard-hZlaoE.png` shows a blocking macOS Terminal dialog. Available source evidence does not link it to Agent Shell.

### Current journeys

**Observed:** `shell-state.js` initializes `area-workspace` as the root. Work and Document use retained layers above it.

**Observed:** Map, Work, and Go To usually converge on `toggleMapBrain`. Work stores an exact return point before it opens Brain.

**Observed:** Area-block Enter calls the legacy `openOrStartBrain` route. It can show a different stopped-Brain presentation.

**Observed:** Document discussion portals the same Brain pane. It keeps the reader, subject, scroll, and focus.

**Observed:** The Brain pane adds `Map ⌘⇧↵`, `Show <Area> on Map`, and `Hide Brain` above the shared global navigation.

**Observed:** Work-to-Brain returns to Work, but the pane-local return label always says Map.

**Observed:** The global Brain label reads Map and Document state before it reads the active Brain Area.

**Observed:** The Map context row renders a second Brain action. CSS hides it below 1600px and exposes it at larger widths.

**Observed:** The global Brain action has no visible shortcut or `aria-keyshortcuts` value.

**Observed:** A WebSocket `open` event produces `Terminal reconnected.` before tmux attachment produces terminal data.

**Observed:** Close code `4404` means that tmux ended. Close code `4403` means that another Agent Shell owns the session.

### Internal precedents

**Observed:** The Map browser proof requires one global navigation row and no Map sub-header.

**Decision:** Brain uses the same pattern. Its local row contains metadata only, not cross-surface navigation.

**Observed:** Work derives labels, visible keys, ARIA shortcuts, and handlers from one command registry.

**Decision:** The global contextual Brain control reads the existing global key record for `⌘⇧↵`.

**Observed:** The split controller retains pane roots. It hides and makes the inactive pane inert below the combined minimum width.

**Decision:** The change keeps that controller and its 560px Map and 420px Brain minimums.

**Observed:** The runtime-resilience contract keeps the last terminal frame until a replacement connection produces a new frame.

**Decision:** Recovery becomes a terminal-local status. Replacement terminal data, not socket open, proves recovery.

## Candidates

### A. Hide duplicate controls with CSS

This option has low implementation cost. It leaves conflicting target rules, false labels, and divergent entry paths.

**Rejected:** Width cannot decide product meaning. Hidden duplicate handlers can still drift or affect accessibility.

### B. One global route row and one contextual Brain pane

The global row owns Map, Work, Back, and contextual Brain navigation. The Brain row keeps only identity, state, session metadata, and a Document subject.

All entry paths use the same Brain pane. One resolver selects the Brain Area from the active surface.

**Selected:** This option removes the screenshot defects and reuses existing retained state.

### C. Make Brain a primary surface

This option gives Brain a permanent top-level tab and independent route state.

**Rejected:** Brain authority is contextual to an Area. A primary Brain route cannot identify its target without another selection rule.

## Product decisions

### One primary route row

**Decision:** Map and Work are the two primary surface controls. Model moves to the Agent Shell menu as reference material.

**Decision:** The Map context row keeps breadcrumb, Find, Only, Starred, and Active. It does not render another Brain action.

**Decision:** A top-level Map shows the Agent Shell menu label. It does not print the Brain shortcut on the Back control.

**Decision:** A child route shows one truthful Back label and Escape. Focus changes between two visible wide panes do not create fake history.

### One contextual Brain action

**Decision:** The global Brain control is the only Map-level Brain entry control.

It prints the resolved Area name and `⌘⇧↵`. It also has `aria-keyshortcuts="Meta+Shift+Enter"`.

The control is visible while it can open or focus Brain. It does not compete with the active Brain or with Work agent-entry semantics.

**Decision:** The active surface selects the target in this order:

1. An active Document discussion selects its Document Area.
2. An active Brain selects `activeMapBrainArea`.
3. Work selects the Area command header that owns the current row.
4. Map selects its selected Area, located Area, then stored Area.

For a Goal row, Work resolves the nearest active parent Brain. For an Area row, Work keeps the exact Area.

**Decision:** Map Area-block Enter uses `toggleMapBrain`. A stopped Brain appears in the same pane and uses the same launch form.

### One Brain presentation

**Decision:** The Brain pane removes its leave, Show-on-Map, and Hide-Brain controls.

The pane metadata row can show the Brain name, lifecycle state, exact session tag, and Document subject. It has no route controls.

The global Map and Work controls own direct navigation. Back owns historical return.

**Decision:** Map entry and Work entry use identical Brain DOM and CSS. Only the truthful Back destination can differ.

### Responsive and accessibility behavior

**Decision:** At wide widths, Map and Brain can remain side by side. Pointer focus does not remount either pane.

**Decision (2026-09-03):** A split is the user's standing choice, never a side effect of a route. Reaching a pane enters it: the pane fills the workspace and its sibling closes but stays mounted. One control in the app bar opens or closes the second pane, and that choice is stored with the pane order and width (`companion` in `agent-shell.area-workspace-layout.v1`). While it is on, every route keeps both panes open and only moves focus.

**Decision:** At 800px, the split controller keeps both roots. It shows one root and marks the hidden root `inert`.

**Decision:** A compact header keeps Map, Work, contextual Brain, attention, and Go To controls in the viewport.

**Decision:** Hidden or retained layers cannot receive focus or appear as a current page.

### Terminal recovery

**Decision:** A short reconnect that completes before the delayed status appears produces no message.

**Decision:** A longer interruption shows `Terminal display disconnected · reconnecting` inside that terminal pane.

**Decision:** Socket open does not clear the status. The first replacement terminal data changes it to `Terminal display restored` and then clears it.

**Decision:** Codes `4403` and `4404` show persistent terminal-local errors and do not retry.

**Decision:** Recovery never uses the global toast or a modal. It never changes focus, drafts, scrollback, or pane identity.

## Complete journeys

### Map to Brain and back

Julian selects an Area. The global Brain control changes to that Area and shows `⌘⇧↵`.

He opens Brain. The existing Map stays mounted. Brain receives focus after the explicit action.

Back restores the selected Map control. The camera, selection, tool state, and draft remain unchanged.

### Work to Brain and back

Julian selects an Area or Goal row. The visible Work brain control opens the controlling Brain in the shared pane.

Brain uses the same metadata and terminal presentation as Map entry. Back says Work and restores the exact row, query, and focus.

### Brain to Map or Work

The primary Map and Work controls are direct destinations. They do not use a second pane-local navigation row.

Map keeps the Brain pane mounted. Work keeps the terminal and its draft below the retained lens.

### Interruption and recovery

The terminal transport closes. The last frame remains visible, and typing focus does not move.

If recovery is slow, a small local status appears. Socket open alone changes nothing.

When replacement terminal data arrives, the local status reports restoration and clears. No global toast appears.

## Risks and reconsideration conditions

**Risk:** A Work Goal and its nearest active Brain can have different Area paths. Browser proof must cover that owner resolution.

**Risk:** A session tag can be long. The metadata row must truncate or wrap without forcing a second navigation row.

**Risk:** A socket can open and never produce data. The reconnect state must remain visible in that case.

**Unknown:** The macOS warning source is outside the available Agent Shell evidence.

Reconsider the contextual resolver only if a new primary surface owns an Area independently from Map, Work, Brain, or Document.

## Proof contract

Focused browser proof must cover 2048px and 800px paths with production assets and an isolated HTTP/WebSocket fixture.

The fixture must use an ephemeral port. It must not read the real vault, use the real tmux namespace, or use port 4321.

Required assertions:

- only Map and Work appear as primary surface controls;
- one visible contextual Brain control has a working visible shortcut;
- active Map and Brain Areas cannot disagree in global chrome;
- Map, Work, Go To, Area-block, and Document entry use one Brain presentation;
- wide Brain metadata does not wrap into a second navigation row;
- 800px retains pane identity, focus, drafts, `inert`, and viewport bounds;
- socket open without data never reports recovery;
- replacement data clears a delayed local outage;
- `4403` and `4404` do not retry;
- the global toast never reports terminal reconnection.

Repository gates remain `npm run check`, `npm run test`, `npm run governance`, and `npm run build`.

## Sources

- Screenshots: `codex-clipboard-11AvsG.png`, `codex-clipboard-AA2vyl.png`, `codex-clipboard-hZlaoE.png`
- `packages/agent-shell/app/public/shell.html`
- `packages/agent-shell/app/public/shell.js`
- `packages/agent-shell/app/public/shell-event-bindings.js`
- `packages/agent-shell/app/public/area-brain-pane.js`
- `packages/agent-shell/app/public/split-workspace-controller.js`
- `packages/agent-shell/app/public/terminal-controller.js`
- `packages/agent-shell/app/terminal-transport.mjs`
- `packages/agent-shell/app/map-first-main-surface.test.mjs`
- `packages/agent-shell/app/area-board-browser.test.mjs`
- `docs/design/agent-shell-navigation-model/design-record.md`
- `docs/design/agent-shell-keymap/design-record.md`
- `docs/design/agent-shell-runtime-resilience/design.md`
