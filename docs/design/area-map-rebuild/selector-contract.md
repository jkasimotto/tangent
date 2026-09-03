# Map selector contract

The browser suites are the contract the rebuilt Map must satisfy unchanged (`code.md`, "Decision summary" and "Tests"). This file is the inventory of every selector those suites depend on: each `tangent-map-*` class, each `data-*` attribute, each role with its accessible name or name pattern, each id, each bridge function, and each event. A rebuilt component keeps every row. Nothing here is a design choice; it is what the tests already query at `45a68759`.

Every row names one suite that uses it. Where several suites use a selector, the row names the one that shows the usage most clearly. The suites are:

| Short name | File |
|---|---|
| world | `packages/agent-shell/app/area-map-world-browser.test.mjs` |
| resources | `packages/agent-shell/app/area-map-resources-browser.test.mjs` |
| nested | `packages/agent-shell/app/area-map-resources-nested-browser.test.mjs` |
| server | `packages/agent-shell/app/area-map-resources-server-browser.test.mjs` |
| figures | `packages/agent-shell/app/area-map-figure-images-browser.test.mjs` |
| rollout | `packages/agent-shell/app/area-map-rollout-browser.test.mjs` |
| ui | `packages/agent-shell/app/area-map-ui.test.mjs` |
| map-first | `packages/agent-shell/app/map-first-main-surface.test.mjs` |
| host | `packages/agent-shell/app/public/area-board.js` (not a test; the host contract the bridge serves) |

Two suites touch the Map only from outside. `ui` drives `window.areaMapView` from the shell bundle, the d3 Document map, and never loads the Excalidraw bundle; it depends on nothing listed here. `map-first` needs only the retained root element under `#screen` (see "Root and host"). Every other row comes from the six Playwright suites.

How the suites reach the Map: `world`, `resources`, `nested` and `figures` import `mountAreaBoardEditor` from `/agent-shell-map.js` and mount it into `<div id="map">` themselves, with no `area-board.js` between them and the bundle. `rollout` and `server` go through `area-board.js` (`mount` and the built shell). So the bundle alone must satisfy the mount options, the bridge, the keyboard entry and the `tangent:area-map` event listed below.

## Root and host

| Selector | Kind | What the suites need | Suite |
|---|---|---|---|
| `#map` | id | The host element the fixtures mount into. Keyboard tests dispatch `keydown` on this element (`page.locator("#map").dispatchEvent("keydown", {...})`), so the Map's one keydown listener must receive events dispatched on the host itself. | resources |
| `.TangentAreaMap` | class | The Map root inside the host. | resources |
| `.TangentAreaMap.resources-panel-open` | class | Present on the root while the wide Resources panel is open; the suites wait for it before measuring dialogs against the panel. | resources, nested |
| `[data-tangent-area-map]` | attribute | On the Map root. Value is the located Area key. `map-first` asserts `#screen [data-tangent-area-map]` is the same element before and after opening Work, a Document, a Session and Back, so the root must be retained, not remounted. `public/shell.js` and `shell-event-bindings.js` also query it. | map-first |
| `[data-tangent-area-map-world]` | attribute | On the Map root, value is the world id. Set by the old component beside `data-tangent-area-map`; no suite queries it, listed so the pair stays together. | none |
| `[data-tangent-area-map-legacy="format-2"]` | attribute | On the legacy (rollback) editor root. The suite waits for `[data-tangent-area-map-legacy="format-2"] .excalidraw canvas.interactive`. | rollout |
| `.tangent-map-ancestry` | class | Must be absent in the legacy editor (`count() === 0`). See "Toolbar" for the world usage. | rollout |
| `link[data-tangent-area-map-style]` | attribute | The stylesheet link `area-board.js` inserts for `/agent-shell-map.css`; `dataset.loaded === "yes"` once loaded. Host-owned. | host |
| `.area-board-loading`, `.area-board-empty[role="alert"]` | class, role | Host-owned loading and error placeholders rendered by `area-board.js` before and instead of the bundle. Not queried by the suites. | host |

Excalidraw-owned selectors the suites also rely on. The rebuild does not render these, but it must keep Excalidraw mounted inside the root so they exist:

| Selector | What the suites need | Suite |
|---|---|---|
| `.excalidraw` | Receives `inert` under a modal sheet or dialog and loses it on close; contains `document.activeElement` after Show on Map and after the Keys dialog closes (`activeElement.classList.contains("excalidraw")`). | resources, world |
| `.excalidraw canvas.interactive` | The readiness signal every suite waits for; pointer coordinates are derived from its bounding box. | world |
| `.excalidraw canvas.static` | Pixel reads and the theme filter (`getComputedStyle(...).filter` matches `/invert/`). | figures |
| `textarea[data-type="wysiwyg"]` | Excalidraw's text editor; must be the active element right after a Block is placed from the picker. | world |
| `.App-toolbar label.ToolIcon` | Excalidraw's tool buttons; none may sit under the open Resources panel. | nested |
| `role="radio"` named `/Text/i` | Excalidraw's Text tool in the legacy editor. | rollout |

## Toolbar

The control row at the top right of the Map.

| Selector | Kind | Accessible name or content | Suite |
|---|---|---|---|
| `.tangent-map-top-right` | class | The control row container. Its `button` children must all be clear of the open Resources panel (`box.right <= panel.left`, and `elementFromPoint` at each centre must not resolve inside `.tangent-map-resources`). | nested |
| `button` | role | `Resources` (exact). Opens the Resources panel. Carries `aria-expanded` and `title="Manage Map resources"`. | resources |
| `.tangent-map-resources-button` | class | On the Resources button. Focus returns to it when the panel closes (`activeElement.classList.contains("tangent-map-resources-button")`). | resources |
| `button` | role | `Outline` (exact). Toggles the Outline. Carries `aria-expanded` and `title="Outline"`. | nested, server |
| `button[title="Map keys (?)"]` | title | `getByTitle("Map keys (?)")` opens the Keys dialog. | world |
| `button[title="Place a Tangent block (B)"]` | title | The picker button; no suite clicks it, listed so the title stays with the key. | none |
| `role="group"` | role | `Actions for {current Block accessible name}`. The selected-Block action group. | none (container only) |
| `button` in that group | role | `{action label}. {Block accessible name}`, for example `/^Copy path\. Worktree: Checkout A\./`, `/Copy path.*Main checkout/`, `/Add to Area.*Link: example.com/`, `Details. {name}`, `Hide. {name}`. Absent when more than one element is selected. | world, resources |
| `.tangent-map-ancestry > button strong` | class | One crumb per ancestor of the restricted Area, innermost last, for example `["Neara", "Delivery", "Standards", "Clearance", "Rules"]`. Folding removes crumbs (`count - 3`) and unfolding restores them. | world |

## Canvas and labels

The HTML Area labels over the canvas and the runtime facts beside them.

| Selector | Kind | Accessible name or content | Suite |
|---|---|---|---|
| `button` | role | The Area label. Exact name `{Name}, child of {Parent / Grandparent or map root}, depth {n}, {folded or unfolded}, {ready or deferred or unreadable}, {n} block` or `blocks`. Example: `Standards, child of Neara / Delivery, depth 3, unfolded, ready, 1 block`. A title change (`Delivery polled`) replaces the Name. Areas outside the restriction have no label. | world |
| `[data-area-map-label="{area key}"]` | attribute | On the label. The suite reads `label.style.left` and `label.style.top` before and after a move and asserts they differ, so the label position must be an inline `left` and `top` on this element. | world |
| Label focus ring | style | On `focus()`, computed `outlineStyle === "solid"`, `outlineWidth >= 2`, and an opaque `outlineColor`. | world |
| text `folded · Space` | text | Exact text inside a folded label. | world |
| text `unreadable` | text | Appears in the label of an unreadable Area. | world |
| `[data-area-runtime-facts="{area key}"]` | attribute | The runtime facts group beside a label; `role="group"`, `aria-label="{Name} runtime"`. | world |
| `button` in that group | role | `Open Work for {Name}: {n} working`, `Open For you for {Name}: {n} for you`, `Open Problems for {Name}: {n} problem` or `problems`. Carries `data-area-runtime-action`. Absent when the count is zero. | world |
| text `Last known`, `Ready` | text | Exact text inside the runtime group for stale and ready facts. | world |
| `region` | role | `Complete Area hierarchy`, the label container in the old component. Not queried; listed so it is not confused with the Outline's `Area hierarchy`. | none |

## Save

| Selector | Kind | Accessible name or content | Suite |
|---|---|---|---|
| `.tangent-map-save` | class | The save status island. Must be clear of the open Resources panel, and so must every `button` inside it. | nested |
| `role="status"` | role | `Map save status`, `aria-live="polite"`. Text contains `Not saved` after a refused save and reads exactly `Saved` when clean (`/^Saved$/`). | nested, server |
| `button` inside it | role | `Reload saved` and `Keep mine` after a refused save. | nested |

## Location toast and live region

| Selector | Kind | Accessible name or content | Suite |
|---|---|---|---|
| `.tangent-map-location` | class | The visual toast; `aria-hidden="true"` and no role. Exact `textContent` such as `Placed {label} on the Map.` and `Suggestion dismissed.`. Must be fully inside the viewport and nothing may cover its centre (the suite sets `pointerEvents = "auto"` to probe, so the default is `none`). Absent (`count() === 0`) while a placement bar shows. The world drag helper reads its text as a diagnostic. | nested, world |
| `.tangent-map-live` | class | The announced copy of the toast; `role="status"`, `aria-live="polite"`, `aria-atomic="true"`. Must not contain `stopped at hackathon` after an automatic reflow. | world |
| `role="status"` | role | `Map kinds status`, `aria-live="polite"`. Exact text `Map kinds: worktree: icon worktre not found` for a broken kind. | world |
| `role="status"` (unnamed) | role | Announcements filtered by text: `Copied {label} path.`, `{label} is now Closed.`, `Saved`. The server suite reads every `[role="status"]` `textContent`. | resources, server |

## Find

| Selector | Kind | Accessible name or content | Suite |
|---|---|---|---|
| `role="search"` | role | `Find on the map`. Opened by `/` dispatched on `#map`. | world |
| `textbox` inside it | role | Unnamed; `fill()` with a label or id fragment. | world |
| `option` inside it | role | Name contains the match label, for example `/Checkout B/`, `/Checkout C/`. | world |
| `#tangent-map-find-results`, `#tangent-map-find-{index}` | id | The listbox and its options in the old component (`role="listbox"`, `role="option"`, `aria-selected`). Not queried by id; keep the roles. | none |

## Picker

| Selector | Kind | Accessible name or content | Suite |
|---|---|---|---|
| `dialog` | role | `Place a Tangent block`, `aria-modal="true"`. Opened by `b` (key press or `#map` keydown). Escape closes it without calling `onBack`, and closes it before closing an open Resources panel. | world, resources |
| `.tangent-map-picker` | class | The dialog element, measured against the open panel (`onScreen`, `clearOfPanel`, `underPanel: false`). | resources |
| `heading` inside it | role | `Place from the whole vault`. | world |
| `textbox` inside it | role | Unnamed; `fill()` then Enter places the first match. | world |
| `.tangent-map-dialog-backdrop` | class | The backdrop under a docked dialog. | resources |
| `.tangent-map-dialog-backdrop.dock-right` | class | Exactly one when the pointer is on the left half of the canvas. | resources |

## Outline

| Selector | Kind | Accessible name or content | Suite |
|---|---|---|---|
| `.tangent-map-outline` | class | The Outline panel. After Escape the world suite waits for `!document.querySelector(".tangent-map-outline")`, so closing removes it from the DOM. | world |
| `.tangent-map-outline.visible` | class | The open Outline; the nested and server suites wait for it and for its `hidden` state. Its `button` children must be clear of the open panel. | nested, server |
| `region` | role | `Area hierarchy`. Opened by `Meta+Shift+o`. Contains only the restricted scope (five treeitems in the deferred fixture). | world |
| `[role='treeitem'][data-outline-area]` | role, attribute | One per Area, `data-outline-area="{area key}"`, `aria-label` equal to the label name above, `aria-level`, `aria-selected`, `aria-expanded`. The first is `document.activeElement` when the Outline opens, and each becomes active in turn; Enter selects and fits its Area. | world |
| `treeitem` (Area rows in the built shell) | role | `/^tangent, .*3 blocks$/`, `/^tangent, .*4 blocks$/`. | server |
| `treeitem` with `data-outline-block` | role, attribute | One per Block. `aria-label` starts `{Kind}: {label}.` (`/^Worktree: Checkout A\./`, `/^Repository: Shared repository\./`), contains `Area {owner key}`, contains `Target {exact path}.`, contains the provider state (`Merged`), and ends `Copy path with Enter.`. `aria-level` is the owner's depth plus one (`"4"` under a depth 3 Area). Enter runs the verb and keeps focus on the row. | world, server |
| `button` inside it | role | `Close` (exact). | server |

## Help

| Selector | Kind | Accessible name or content | Suite |
|---|---|---|---|
| `dialog` | role | `Map keys`, `aria-modal="true"`, named through `aria-labelledby="tangent-map-help-title"`. Opened by the `Map keys (?)` button or `?` on `#map`. Text matches `/B block/` and `/named Brain control/` and not `/b brain beside/i`. On close, focus returns to `.excalidraw`. | world |
| `#tangent-map-help-title` | id | The heading the dialog is labelled by. | world (through the dialog name) |
| `.tangent-map-help` | class | The dialog element, measured against the open panel. Carries no dock class. | resources |
| `button` inside it | role | `Close`. | world |

## Placement

| Selector | Kind | Accessible name or content | Suite |
|---|---|---|---|
| `role="status"` | role | `Place {label} on the Map`. The placement bar. Enter commits, Escape cancels, `ArrowRight` nudges, a pointer click on the canvas commits. Hidden after commit. | resources, nested, server |
| `.tangent-map-resource-placement` | class | The bar element; must be clear of the open panel and must replace `.tangent-map-location`. | nested |
| `.excalidraw` `inert` | property | `false` while a placement is open, even when the narrow sheet was the opener. | server, resources |

## Resources panel

| Selector | Kind | Accessible name or content | Suite |
|---|---|---|---|
| `.tangent-map-resources` | class | The panel or sheet. Wide: `role="region"`. Narrow (800px): `role="dialog"` with `aria-modal`, and `.tangent-map-resources[role='dialog']` counts exactly one. Hidden after Show on Map and after placement from the narrow sheet. `scrollWidth <= clientWidth` with long targets. axe runs inside it with no serious or critical violation. | resources, nested |
| `region` | role | `Map resources · {Area name}` (wide). | resources |
| `dialog` | role | `Map resources · {Area name}` (narrow), labelled by `#tangent-map-resources-title`. Under it `.excalidraw`, `#brain-pane` and `#global-controls` are `inert`, and prior `inert` values (`#pre-inert`) are restored on close. | resources |
| `heading` | role | `Map resources · {Area name}`, examples `Map resources · Tangent`, `Map resources · Otto`, `Map resources · Nested`, `Map resources · tangent`. | resources, nested, server |
| `#tangent-map-resources-title` | id | The heading. It is `document.activeElement` when the sheet opens. | resources |
| `navigation` | role | `Resource Area breadcrumb`, with one `button` per Area named by its display name (`Tangent`, exact) and `aria-current` on the viewed Area. | resources |
| `button` | role | `Close` (exact). Focus returns to `.tangent-map-resources-button`. | resources |
| `button` | role | `Add Worktree` (exact), enabled once the problem clears. | resources |
| `button` | role | `Discover worktrees`. | resources |
| `button` | role | `Reload resources`. | resources |
| `button` | role | `Retry` (exact) inside `.tangent-map-resource-problem`. | resources |
| `.tangent-map-resource-problem` | class | The panel-level problem block; absent once the reload succeeds. | resources |
| `role="alert"` | role | Panel and editor errors, filtered by text (`Injected catalog conflict`). | resources |
| text | text | Exact strings: `No confirmed Map resources in this Area yet.` (absent while facts are partial or review is pending), `Some source facts are unavailable. Counts are lower bounds; Copy and Open remain available.`, `Could not refresh Map resources · Last known.`, `Newest projection`, `Direct`, `From otto`, and the exact target path. | resources |
| `heading` | role | `Legacy resources to review`. | resources |
| `.tangent-map-resource-review li` | class | One Suggestion per `li`, with one `code` that stays on one line and a height of at most 140px; buttons in order `Add to Area`, `Dismiss` for a direct Suggestion and `Review in {Owner}` for an inherited one. Absent after dismissal. | nested |
| `button` | role | `Review {name} in {owner}`, `Add {name} to Area`, `Dismiss {name}`. | nested |
| `.tangent-map-resource-undo` | class | The undo strip with `button` `Undo` (exact). | resources |

### Resource rows

| Selector | Kind | Accessible name or content | Suite |
|---|---|---|---|
| `.tangent-map-resource-row` | class | One per resource, `role="listitem"`, `aria-label` is the row name. Filtered by `hasText` on the label. | resources |
| row `aria-label` and button `aria-label` | attribute | Together contain the kind, label, state, owner and exact target tokens, for example `Worktree`, `Removed checkout`, `gone`, `otto/tangent`, `/private/tmp/tangent-map-resource-fixture/removed`. | resources |
| `button` | role | `Place on Map. {…}{label}` (`/^Place on Map\. .*Nested docs/`, `/^Place on Map\./`), `Show on Map` and `Show on Map. {…}{label}`, `Restore on Map`, `Place in {owner}` (`Place in otto`, disabled while transport is stale). | resources, nested, server |
| `[data-resource-show="{encodeURIComponent(key)}"]` | attribute | On the Show and Restore buttons. After Show on Map then Escape, `document.activeElement.dataset.resourceShow` equals the encoded key. | resources |
| `[data-resource-place="{encodeURIComponent(key)}"]` | attribute | On the Place buttons. After a cancelled placement, `document.activeElement.dataset.resourcePlace` equals the encoded key. | resources |
| `button` | role | `Details` and `Details. {…}` (`/^Details\./`). | resources, server |
| `button` | role | `Copy path` and `Copy path. {…}` (`/^Copy path\./`). | resources, server |
| `button` | role | `Refresh status`; while in flight the same control reads `/^Checking\./` and is disabled. | resources |
| `button` | role | `Remove from Area`, `Add back to Area`, `Change to Repository`. | resources |
| text | text | Exact provider state such as `Closed`. | resources |

## Details

| Selector | Kind | Accessible name or content | Suite |
|---|---|---|---|
| `.tangent-map-resource-details` | class | The details view inside the panel. | resources, server |
| `heading` | role | The resource label (`Main checkout`, `Review checkout`). | resources, server |
| `textbox` | role | `aria-label="Exact target"`; `inputValue()` is the exact path. | resources, server |
| `code` | element | Contains the repository path. | resources, server |
| text | text | Exact facts: the locator id, the `checkedAt` timestamp, `No`, `Worktree · Branch legacy/main`. | resources |
| `button` | role | `Back to resources`. | resources, server |
| `button` | role | `{action label}. {accessible name}`, and `Show on Map.`, `Restore on Map.` or `Place on Map.` with the same `data-resource-show` and `data-resource-place` attributes as the row. | none (source only) |

## Editor

| Selector | Kind | Accessible name or content | Suite |
|---|---|---|---|
| `.tangent-map-resource-editor` | class | The edit form; present after `Reload resources` recovers a conflict and absent after a successful `Save`. | resources |
| labelled control | label | `Kind`, a select whose `inputValue()` is the kind id and which is enabled. | resources |
| labelled control | label | `Label (optional)`. | resources |
| `button` | role | `Save` (exact). | resources |

## Discovery

| Selector | Kind | Accessible name or content | Suite |
|---|---|---|---|
| `region` | role | `Worktree discovery results`. | resources |
| `heading` inside it | role | `Discovery sources`. | resources |
| `button` inside it | role | `Copy repository path`. | resources |
| text inside it | text | The repository label and the exact source problem `Could not inspect the recorded repository.`. | resources |

## Recovery dialogs

| Selector | Kind | Accessible name or content | Suite |
|---|---|---|---|
| `.tangent-map-resource-recovery` | class | Any resource recovery dialog; the suites wait for it to be gone. | resources |
| `dialog` | role | `Copy {label} path` (`Copy Main checkout path`) when the clipboard fails; `aria-modal="true"`, labelled by `#tangent-map-resource-recovery-title`; `button` `Close` (exact). `#brain-pane` and `#global-controls` are `inert` while it is open. | resources |
| `dialog` | role | `Add {label} back to Area?` with `textbox` `Exact Last-known target` holding the last-known path and `button` `Confirm add back`. | resources |
| `dialog` | role | `Map resource was not saved`, labelled by `#tangent-map-resource-scene-recovery-title`, with `button` `Retry same operation`. | resources |
| `role="alert"` inside a recovery dialog | role | The cause text. | resources (through axe) |

## Transaction

| Selector | Kind | Accessible name or content | Suite |
|---|---|---|---|
| `role="status"`, `aria-live="polite"` | role | The transient transaction announcement in the old component (`Copied {label} path.`, `{label} is now Closed.`). Reached through the unnamed status rows above. | resources, server |

## Live region

The suites read four `role="status"` regions: `.tangent-map-live` (the announced toast), the `Map save status` island, the `Map kinds status` notice, and the `Place {label} on the Map` placement bar. `.tangent-map-location` is the visual toast and is `aria-hidden`. See "Location toast and live region", "Save" and "Placement".

## Shell elements the fixtures provide

These are in the fixture HTML, not in the Map, and the Map must set and restore `inert` on them under a modal surface.

| Selector | Suite |
|---|---|
| `#screen`, `#app`, `#brain-pane`, `#global-controls`, `#splitter`, `#pre-inert` (starts `inert`), `[data-split-pane="map"]`, `[data-split-pane="brain"]`, `[role="separator"]` | resources |

## Keys the suites send

Sent with `page.keyboard.press` (focus on the Map) or as `keydown` dispatched on `#map`. The dispatcher must handle both paths.

| Key | Meaning | Suite |
|---|---|---|
| `b` | Open the picker. | world, resources |
| `?` | Open the Keys dialog. | resources |
| `/` | Open Find. | world |
| `Meta+Shift+o` | Toggle the Outline. | world, resources |
| `Escape` | Pop the top surface, then leave the Map through `onBack`. | world, resources |
| `Enter` | Run the selected Block's verb; select in the Outline; commit a placement. | resources, world |
| `Space` | Fold and unfold the selected Area. | world |
| `x` | Hide the selected Block. | resources |
| `ArrowRight` | Nudge a placement. | resources |
| `Meta+z`, `Meta+Shift+z`, `ctrl+z`, `ctrl+shift+z` | Undo and redo. | world, resources |
| `Tab` | Move into the picker's controls. | world |
| `Shift` held (`keyboard.down`) | Additive selection during a pointer press. | world |

## Bridge functions

`mountAreaBoardEditor(host, options)` is the one export the host and the fixtures import from `/agent-shell-map.js`. It returns the bridge below. Every function must exist; the host guards most with `?.` but the suites call them directly.

| Function | Who calls it | What it must do |
|---|---|---|
| `current()` | world, rollout, host | The composed scene (`elements` with `customData.tangent` roles). |
| `rendered()` | world, resources, figures, host | The elements Excalidraw holds now, or `null` before mount. |
| `appState()` | world, resources, figures | Excalidraw's app state; suites read `selectedElementIds`, `zoom.value`, `scrollX`, `scrollY`, `editingTextElement`. |
| `controller()` | world, resources, nested, figures | The kernel controller; suites call `snapshot()`, `world()`, `setSelection`, `setRestriction`, `reload`, `toggleFold`, `flush`, `fitArea`, `captureView`, `selectArea`, `setFocus`, `commitWorld`. |
| `fitArea(area, settings)` | world, host | Fit one Area without changing the restriction. |
| `navigateArea(area, settings)` | host | Fit one Area and retarget the restriction. |
| `selectArea(area)` | old entry | Select without fitting. |
| `openFind()` | host | Open Find. |
| `toggleRestriction(area)` | host | Toggle Only. |
| `escape()` | resources, host | Run the Map's Escape order and return what closed, for example `{ kind: "resource-locate" }`. |
| `flush()` | world, rollout, host | Wait for pending saves. |
| `refreshFacts(documentsOrFocus, maybeFocus)` | world, host | Reconcile polled facts or a changed tree. The world suite falls back to `updateFacts(documents, focus)` if `refreshFacts` is missing; keep `refreshFacts`. |
| `setFocus(value)` | host | Change the render-only Focus mask. |
| `setSaveState(state)` | host (legacy) | Reflect the rollback editor's save state. |
| `reload()`, `keepMine()` | old entry | The two ways out of a refused save; the buttons in the save island call the same paths. |
| `destroy()` | world, host | Unmount. |
| `captureView()`, `restoreView(value)`, `focus()` | host | Optional in the old entry (the host falls back to the controller). Implementing them on the bridge is consistent with the host contract. |

Mount options the suites pass: `world`, `scene`, `getDocuments`, `api`, `focus`, `onWorldChange(nextWorld, changedAreas, changedOwners)`, `loadShard(area)`, `reloadWorld()`, `onEntityVerb(action)`, `onBack()`, and optionally `onEditorError`. The host passes `world`, `controller`, `scene`, `getDocuments`, `searchDocuments`, `api`, `onEntityVerb`, `onEntityAction`, `onViewState`. The legacy host passes `legacy: true`, `area`, `scene`, `onBack`, `onSceneChange`, `onSaveNow`, `onRetry`, `initialSaveState`. When no `controller` is passed the bundle creates its own and must emit its events (next section).

## Events

| Event | Where | Detail | Suite |
|---|---|---|---|
| `tangent:area-map` | `window` `CustomEvent` | `detail` is one coordinate-free diagnostic with a `name`. Names the suites filter: `area_map_pointer_down`, `area_map_projection` (with `phase`, `projectionId`), and `map-icon-files` with `files: [fileId, ...]` for every icon file registered with Excalidraw. `area-board.js` dispatches it for the host's controller; the bundle dispatches it for the controller it creates itself, which is the path the direct-mount suites use. | world, figures |
| `keydown` on `#map` | host element | See "Keys the suites send". | resources, world |
| `dblclick` on `.excalidraw canvas.interactive` | canvas `MouseEvent` | An empty-canvas double click must leave `defaultPrevented === false` so Excalidraw handles it; a double click on a selected Block runs its verb once. | resources |
| `pointerup` on `window` | listener added by the test | The world drag helper listens for its own bookkeeping; no Map obligation beyond bubbling pointer events. | world |
| `load` and `error` on the stylesheet link | host | `area-board.js` waits for `/agent-shell-map.css`. | host |

The legacy editor saves through `/api/areas/canvas` only and must never call `map-world` or `map-gestures`; the rollout suite asserts the call list.
