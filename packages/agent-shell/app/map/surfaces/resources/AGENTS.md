# Agent Notes

Purpose: the Resources panel. It is the Area's resource inventory: the confirmed rows, their Suggestions, the legacy review list, worktree discovery, one row's details, the Add and Edit form, the undo strip, and the three recovery dialogs. This directory replaces twenty-one `useState` calls and eighteen refs of the old component with one reducer, one effects context and one set of named commands. Design: `docs/design/area-map-rebuild/code.md`. The contract is the browser suites `area-map-resources-browser.test.mjs`, `area-map-resources-nested-browser.test.mjs` and `area-map-resources-server-browser.test.mjs`, and the selectors in `docs/design/area-map-rebuild/selector-contract.md`.

## The one rule of this directory

Facts are not authority. Reading resource facts never enters Map history, never changes the save state, and never rewrites a source scene. The only writes that touch a Map source are the two scene-coupled mutations in `resources-scene-mutations.ts`, and each waits for the canonical Map to be saved, fences the exact source hash, and installs the server's source update.

## The modules

State and its reducer:

- `resources-state.ts` is the panel's whole state as one typed record, with `INITIAL_RESOURCES_STATE`, `resourceWritesAvailable()` (current projection over current transport, not busy) and `resourcesHoldModal()` (the narrow sheet, a recovery dialog or the transaction veil owns the screen).
- `resources-store-actions.ts` is the closed action union, grouped by what the person or the server did. Every action carries data only: the effects mint operation ids and read the clock before they dispatch.
- `resources-store.ts` is the pure reducer. It never fetches, never reads a clock, never mints an id, and every map and set it returns is new. Each action is one named function, so the switch reads as the list of what can happen to the panel.

Wire shapes and drafts:

- `resources-wire.ts` holds the mutation envelope and every answer shape of `/api/areas/map-resources/*`, plus `readResourceFailure()`, `suggestionReference()`, `resourceMutationOwners()` and `catalogFencesFor()`. Nothing here is state.
- `resources-draft.ts` is the Add, Edit and Suggestion draft as data: how one opens from a row or a Suggestion, which catalog revisions fence it, and the mutation it becomes once its target is inspected.
- `resource-rows.ts` is every pure helper over one row: its entity, its resolution, its Map state, its words, its group, its order and its filter match. The panel, the details view and the Outline read rows only through here.

Effects and commands:

- `resources-effects.ts` owns every request that reads facts, and the cadence. `createResourceEffects(deps)` builds the context each function takes first; the in-flight fences the old component kept in refs live in it beside the request function. Only the newest inventory read lands, and a failed re-read keeps the rows it had as last known.
- `resources-mutations.ts` owns the catalog commands: one revision-fenced envelope with one stable operation id, so a retry after an interruption resends the same bytes and the server replays its receipt.
- `resources-scene-mutations.ts` owns the two commands that rewrite a Map source with the catalog, their undo, their retry, and the Hide command.

## Public API

Read and cadence, from `resources-effects.ts`: `createResourceEffects`, `requestResource`, `installResourceProjection`, `isInstallableProjection`, `cancelResourcePanelLoad`, `cancelResourceRequests`, `loadResources`, `refreshResourceFacts`, `resolutionsOf`, `sceneResourceLocators`, `resolveSceneResources`, `resourceCadenceInterval`, `installResourceCadence`, `refreshOpenPanel`, `discoverResources`, `inspectTarget`, `inspectResourceDraft`, `resourceSourceShard`.

Catalog commands, from `resources-mutations.ts`: `applyResourceMutation`, `retryResourceMutationRecovery`, `chooseLegacyBranch`, `importSelectedLegacy`, `editResource`, `saveResourceDraft`, `removeResource`, `dismissSuggestion`, `openRecoveryResource`, `recoveryOwner`.

Scene commands, from `resources-scene-mutations.ts`: `applySceneResourceMutation`, `associateGenericLink`, `requestAddBack`, `confirmAddBack`, `retrySceneResourceMutation`, `undoResourceChange`, `hideResourceOnMap`, `sourceResourceBlock`, `representationForRow`.

Show, Place and Restore on Map are not here. They open a view layer over the canvas and belong to `../placement/`.

## The views

The views are thin `.tsx` files that compose `../../ui/` and read the state through `resource-rows.ts`. They hold no state of their own and call the commands above.

- `ResourcesPanel.tsx` renders the surface through `../../ui/Surface.tsx` with the registry id `resources`: `../../ui/Panel.tsx` when wide, `../../ui/Sheet.tsx` when `state.narrow`. It carries `.tangent-map-resources`, the heading `#tangent-map-resources-title`, the breadcrumb `navigation` named `Resource Area breadcrumb`, the filter, Close, Add, Discover worktrees, Reload resources, the transport problem block `.tangent-map-resource-problem` with its `Retry`, the groups from `groupPanelResourceRows()`, and the undo strip `.tangent-map-resource-undo`.
- `ResourceRow.tsx` is one `.tangent-map-resource-row` with `role="listitem"` and the `aria-label` from `RESOURCE_ROW.name()`. Its buttons carry `data-resource-show` and `data-resource-place` keyed by `encodeURIComponent` of the locator key.
- `ResourceDetails.tsx` is `.tangent-map-resource-details` over `resourceDetailsFacts()`, with `Back to resources`, the exact target textbox and the same action buttons as the row. It is the surface `resourceDetails`, whose Escape is `back-step`.
- `ResourceEditor.tsx` is `.tangent-map-resource-editor`: the `Kind` select, the `Label (optional)` field, the missing-path confirmation and `Save`. It is the surface `resourceEditor`, also `back-step`.
- `Discovery.tsx` is the `region` named `Worktree discovery results` with the heading `Discovery sources`, and `Suggestions.tsx` renders `.tangent-map-resource-review`, one Suggestion per `li` with one `code` on one line.
- `ResourceRecovery.tsx` renders the three dialogs through `../../ui/Dialog.tsx`: the blocked copy or open (`resourceRecovery`), the Add-back confirmation and the failed transaction (`sceneRecovery`). Both are modal surfaces; `../surface-stack.ts` decides what Escape closes, so no view handles a key.

## Tests

`*.test.ts` beside each module, run with `node --test packages/agent-shell/app/map/surfaces/resources/*.test.ts`. `resources-store.test.ts` covers every action in the union. The effects, mutation and scene tests run against a real controller from `../../kernel/kernel-boundary.ts` and a routed fake server, so a fence, an operation id and a source update are proved against the kernel rather than a stub.

Read next:
- `../AGENTS.md`
- `docs/design/area-map-rebuild/code.md`
- `docs/design/area-map-rebuild/selector-contract.md`
