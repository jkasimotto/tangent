# Handover: One living Area map

Date: 2026-08-30

Replacement: `codex-otto/sol/ultra`

This handover stops the current implementation. Preserve all committed and uncommitted work.

## Goal contract

Goal: `goal-one-living-map-contains-the-complete-area-hierar`

Goal file:

`/Users/julianotto/.tangent/trees/otto/tangent/goal-one-living-map-contains-the-complete-area-hierar.md`

Done when:

> The Area map behaves as one coherent spatial hierarchy: opening any Area shows all of its ancestors and descendants as interactive nested regions; every region can be selected, moved, and resized; parents always expand or reflow to contain children; boundaries never disappear; and camera or Focus changes visibility without changing map authority.

The implementation step also requires these results:

- Opening any Area shows its complete ancestor and descendant hierarchy.
- Every visible Area region stays interactive.
- Parent containment holds during all edit, save, load, polling, Focus, drill, and Escape paths.
- Outlines and labels stay visible.
- Blocks visibly retain Area membership.
- Spatial movement never changes semantic ownership.
- The selected authority, migration, solver, camera, persistence, recovery, accessibility, and performance rules are implemented.
- Every named test is present.
- The Neara, Delivery, and Standards crossing is reproduced and fixed.
- The production server on port 4321 is rebuilt, restarted, and verified.
- Only scoped changes are committed.

## Design and source paths

Approved product design:

`/Users/julianotto/.tangent/trees/otto/tangent/design-one-living-map-contains-the-complete-area-hierar.md`

Approved engineering design:

`/Users/julianotto/.tangent/trees/otto/tangent/design-one-living-map-complete-hierarchy-engineering.md`

Reviewed predecessor design:

`/Users/julianotto/.tangent/trees/otto/tangent/design-make-nested-area-map-manipulation-coherent-reviewed.md`

Area notes:

- `/Users/julianotto/.tangent/trees/otto/tangent/tangent.md`
- `/Users/julianotto/.tangent/trees/otto/otto.md`

The product design selects one world from per-Area shards. It removes scope and locked ancestor projections.

The engineering design defines IDs, ownership, containment, loading, transactions, history, migration, recovery, and all named proofs.

## Repository state

Working directory:

`/Users/julianotto/Projects/otto-tangent`

Branch: `main`

HEAD:

`48a45019be947a2461250f021a440d4689a71e58` (`48a4501`)

Subject:

`feat: persist Area map operation telemetry`

The branch is 55 commits ahead of `origin/main` at handover time.

This is a shared checkout. Unrelated commits are interleaved with the Area-map commits.

No worktree was created.

The Git index is empty. Nothing is staged.

## Scoped Area-map commits

These commits belong to this implementation. The list is oldest first.

- `fd52257` `fix: enforce complete Area world authority`
- `48cc35f` `fix: make Area map gestures crash-safe`
- `7681190` `feat: rebase Area map conflicts by source ID`
- `12eef87` `fix: carry Area maps through explicit moves`
- `bea51de` `docs: record the composed Area map authority`
- `ea2548c` `governance: guard the Area map world authority`
- `7f08155` `feat: serve and mutate the complete Area map world`
- `31bd89f` `test: cover every Area map recovery phase`
- `95ec9ab` `perf: cache Area map scene parses by hash`
- `3223af0` `fix: serve complete Git maps during recovery`
- `32b54b0` `fix: route Area map authority through transactions`
- `6056622` `fix: serialize Area map readers with installs`
- `a74074f` `feat: persist Area map views by world`
- `d67eecd` `fix: contain block-driven Area growth`
- `01a34ed` `perf: enforce Area map preview budget`
- `12184a9` `feat: preserve cross-Area arrow endpoints`
- `b906a40` `fix: validate Area map source authority`
- `71926aa` `refactor: remove retired Area scope projections`
- `421679a` `fix: make Area moves reader-atomic`
- `a6a64d6` `fix: route Area moves through map transactions`
- `2ead294` `docs: publish the complete Area map world`
- `c4cd2cb` `fix: keep cross-Area bindings symmetric`
- `ad99a6b` `feat: keep one authoritative Area map world`
- `2f3e7d2` `test(agent-shell): prove one living Area map`
- `6124c7e` `feat: observe Area map transactions and migration`
- `a3dcba3` `feat: gate Area map world rollout`
- `48a4501` `feat: persist Area map operation telemetry`

The parent of the first scoped commit is `59780382fe04103f27efb7f781f584585f8bc53e`.

Do not rewrite or reorder the shared branch history.

## Unstaged Area-map work and ownership

Seven existing files contain unstaged Area-map work.

Kant owns these six files:

- `packages/agent-shell/app/browser/area-map-world.jsx`
- `packages/agent-shell/app/browser/area-board-excalidraw.css`
- `packages/agent-shell/app/public/area-map-world-controller.js`
- `packages/agent-shell/app/public/area-board.js`
- `packages/agent-shell/app/area-map-world-controller.test.mjs`
- `packages/agent-shell/app/area-map-world-load-plan.test.mjs`

Peirce and the root session own this test file:

- `packages/agent-shell/app/area-board-browser.test.mjs`

The seven-file diff has 501 additions and 141 deletions.

The six-file client slice is not ready to commit.

The browser test is also not ready to commit.

This handover file is new and unstaged:

- `handover-area-map-ultra.md`

### Temporary diagnostics that must not ship

`area-map-world.jsx` contains temporary `MAPTRACE` and `RAWCHANGE` `console.error` calls.

`area-board-browser.test.mjs` contains a temporary console listener and expanded geometry output.

Remove those diagnostics before any scoped commit.

Keep this required browser-test line:

```js
await page.waitForFunction(() => document.activeElement?.matches('textarea[data-type="wysiwyg"]'));
```

The crossing golden is clean and matches HEAD:

`packages/agent-shell/app/test-fixtures/area-map/near-delivery-standards-crossing.png`

Do not refresh it until the browser authority bug is fixed and the new image is inspected.

## Unrelated concurrent work

All files below contain other agents' work. Do not stage, restore, or edit them for this Goal.

Modified files:

- `packages/agent-shell/app/area-note-links.mjs`
- `packages/agent-shell/app/goal-detail.mjs`
- `packages/agent-shell/app/goal-presentation-routes.mjs`
- `packages/agent-shell/app/goal-presentations.mjs`
- `packages/agent-shell/app/goal-presentations.test.mjs`
- `packages/agent-shell/app/public/document-reader-controller.js`
- `packages/agent-shell/app/public/document-reader-view.js`
- `packages/agent-shell/app/server.mjs`
- `packages/agent-shell/app/vault-root-AGENTS.md`
- `packages/agent-shell/app/work-commands.test.mjs`
- `packages/agent-shell/app/work-table-ui.test.mjs`
- `packages/agent-shell/docs/architecture.md`
- `packages/agent-shell/docs/index.md`
- `packages/agent-shell/docs/public-api.md`
- `packages/agent-shell/src/cli/commands/area.ts`
- `packages/agent-shell/src/cli/commands/goal.ts`
- `packages/agent-shell/src/cli/spec.ts`

Untracked paths:

- `docs/design/agent-shell-navigation-model/`
- `docs/design/area-map-black-canvas/`
- `handover.md`
- `packages/agent-shell/app/area-presentation-routes.mjs`
- `packages/agent-shell/app/area-presentations.mjs`
- `packages/agent-shell/app/area-presentations.test.mjs`
- `packages/agent-shell/app/goal-cards.mjs`
- `packages/agent-shell/app/goal-cards.test.mjs`
- `prototypes/`

The current `server.mjs` diff belongs to presentation work. All Area-map server changes are already committed.

Stage only exact files. Always inspect `git diff --cached --name-only` before a commit.

## Completed committed behavior

The committed implementation contains these results:

- One complete structural world composes from per-Area source shards.
- Namespaced runtime IDs preserve source IDs and prevent owner collisions.
- Each source element has explicit Area ownership.
- Every Area edge produces one unlocked interactive region.
- Stored, recovered, provisional, deferred, and unreadable Areas keep visible boundaries.
- Opening any Area returns its ancestors, descendants, and required structural siblings.
- The client loads the current path and two descendant levels first.
- Selected and nearby deferred shards receive later priority.
- The bottom-up solver grows every required ancestor in the same preview.
- Sibling regions act as walls at every hierarchy level.
- Large pointer jumps cannot tunnel through a sibling.
- Tangential motion continues when one axis reaches a wall.
- Parent blocks stop at direct child regions.
- Block movement expands required containment.
- Free ink can cross walls and only expands the drawn outline.
- Direct shrink respects blocks, children, labels, and minimum sizes.
- Left and top resize do not scale descendants.
- Automatic growth does not write ancestor extents in the core solver.
- Cross-Area arrows store endpoint ownership without foreign source bindings.
- Deferred endpoints render at an Area edge and resolve after loading.
- Explicit Area moves preserve element IDs and rewrite endpoint owners.
- One gesture saves all changed shards in one durable Git transaction.
- Transaction recovery covers prepare, rename, stage, commit, and result phases.
- Readers and writers cannot observe partial installs or moves.
- Repeated operation IDs are idempotent and digest checked.
- Conflicts report every owner and support reload or Keep mine.
- World history groups pointer, text, paste, toolbar, and multi-shard commands.
- Draft recovery, retry, undo, and redo use world authority.
- Camera, Focus, fold, loading, and facts do not enter authored history.
- Private view state is stored by stable world identity.
- Structural polling can reconcile without replacing session view state.
- Migration reads 41 Areas without writing during open.
- Legacy boundaries do not render in the new world.
- The disabled feature path uses the transaction-backed format-2 editor.
- Source validation rejects runtime IDs, invalid children, duplicate IDs, and unsafe endpoints.
- Transaction and migration telemetry contain no authored text or coordinates.
- A 500-Area solver preview stays inside the specified test budget.
- Production scope, locked-region, and ancestor-projection paths are removed.

## Completed uncommitted behavior

The second client slice adds these incomplete improvements:

- Deferred loading prefers a selected shard before nearby shards.
- Deferred requests deduplicate while in flight and support retry.
- A second external conflict receives a fresh operation ID.
- Unchanged polls avoid another scene parse or Excalidraw update.
- The current 41-Area load plan has a measured budget test.
- The public flush waits for the pointer release fence.
- Excalidraw stays mounted behind stable React properties.
- Tangent controls render as a sibling overlay.
- Controller subscriptions coalesce through a microtask.
- Controller-to-canvas updates use a partial deferred fence.
- Text edits buffer until Excalidraw leaves its native editor.
- Claimed IDs remap to stable world IDs.
- Arrow lookup checks direct, claimed, and nearby endpoint targets.
- The selected-region gate stops the observed automatic-growth coordinate shift.

This slice still has an authority defect. Do not treat the listed behavior as complete.

## Current blocker and diagnosis

The latest focused generic browser journey is red on symmetric arrow binding.

The newest trace found the underlying pointer defect.

An element-bearing `no-change` projection runs after the first frame of a new element drag.

That projection resets Excalidraw to the controller's earlier zero-point or one-point element.

The reset truncates new rectangles, freehand strokes, and arrows.

The latest arrow had a valid start and a null end.

An earlier run had two null bindings.

The selected-region gate fixed the earlier coordinate shift in one observed run.

That run kept these world positions through the ink action:

- Root region `x=80`
- Tangent Goal `x=390`
- Authored rectangle `x=701`

The gate is not a complete authority boundary.

A region can remain selected during a fact, Focus, fold, load, or selection projection.

The current helper can still mistake that projection for a stored Area move.

Programmatic `updateScene()` calls also use several different timing guards.

One escaped callback can split projected facts or repaired bindings into source shards.

### Required authority fix

Implement one exact expected-projection token for every programmatic `updateScene()` call.

The token must include the expected scene fingerprint and selection.

Consume the token at the start of `onChange`.

Return before selection reconciliation or `publish()` for an expected projection.

Route `clearStaleEditingText()` and every direct selection update through the same fence.

Require explicit geometry-command provenance for non-pointer Area changes.

Selection alone is not sufficient provenance.

Pointer Area edits already use the pointer-baseline solver.

Keyboard region movement needs a dedicated command token or explicit `nudge` provenance.

Suppress the element-bearing `no-change` projection during a new-element pointer command.

Add the claimed owner to later pointer frames so those frames update the correct shard.

Then check arrow binding again. Do not add another geometric fallback before this authority fix.

### Required regression cases

- A selected region plus a projection callback does not change stored geometry.
- Fact, Focus, fold, load, and selection projections do not create source mutations.
- A selected region plus an explicit keyboard nudge changes stored geometry.
- Automatic hull growth never changes stored extents or existing world positions.
- A new rectangle keeps all pointer frames.
- A new freehand stroke keeps all points.
- A new arrow keeps both endpoints and both symmetric bindings.
- Programmatic fact and binding repairs never become source authority.

## Test evidence

### Current or recent green evidence

- The named non-browser matrix was green at 72 of 72 before the latest client slice.
- Controller, load-plan, and core tests are green at 25 of 25 with the current unstaged files.
- The controller and load-plan subset is green at 16 of 16.
- The disabled-feature rollback browser test is green at 1 of 1 after a fresh build.
- The rollback test took 782 milliseconds and the full command took 1.05 seconds.
- The strict world behavior cases were green at 10 of 10 before the latest diagnostics.
- The world browser suite was green at 11 of 11 twice on the earlier landed client state.
- The generic browser suite was green at 3 of 3 on the earlier landed client state.
- The exact generic journey was green twice on the earlier landed client state.
- The crossing behavior assertions pass on the recent client slice.
- The crash-recovery live case was green in 4.41 seconds.
- Kant reports the complete live-service suite green at 2 of 2 before the latest diagnosis.

Treat earlier browser evidence as stale after the final authority fix.

### Last failing proof

Focused test:

`real Excalidraw paths create text, ink, shapes, a Tangent block, manipulation, and a bound arrow`

Text focus, text content, nudge, identity, ink, shape, and Tangent block checks passed.

The symmetric arrow assertion failed.

The earlier failing arrow was at `x=665,y=405` with two null bindings.

Temporary tracing then exposed the new-element projection reset described above.

No browser rerun occurred after that final diagnostic edit.

### Golden state

Expected digest:

`63290d976f2117b6dea6a462e4d8d7591fec4dd883bd28f8d1facb1f63f759fe`

Recent actual digest:

`a38ccb809459eb27b61c71bd5adb60ac873baf79a9fa9b74ab70e5c30af32259`

The behavior assertions passed. Visual inspection found one antialias pixel difference.

An update run passed, but the golden was restored after the stop instruction.

The golden is now clean and unchanged from HEAD.

### Unrun or stale final checks

These checks are not valid for the final unstaged state:

- Ten repeated focused generic browser runs
- Full generic browser suite
- Full world browser suite twice
- Exact crossing twice against the final golden
- Full live crossing, save, reload, and restart after the final fix
- Full current migration and transaction matrix
- `npm run check`
- `npm run test`
- `npm run governance`
- Final `npm run build`
- Final live map acceptance on port 4321

The most recent workspace build completed with exit code zero.

That build occurred before the final temporary diagnostic edits.

## Exact verification commands

Run all commands from `/Users/julianotto/Projects/otto-tangent`.

First, remove diagnostics and complete the authority fix.

Then build the browser bundle:

```bash
npm run build --workspace=@tangent/agent-shell
```

Run the focused generic journey at least ten times:

```bash
TANGENT_BROWSER_TEST=1 node --test --test-name-pattern='real Excalidraw paths create text' packages/agent-shell/app/area-board-browser.test.mjs
```

Run the complete generic browser suite:

```bash
TANGENT_BROWSER_TEST=1 node --test packages/agent-shell/app/area-board-browser.test.mjs
```

Run the complete world browser suite twice:

```bash
TANGENT_BROWSER_TEST=1 node --test packages/agent-shell/app/area-map-world-browser.test.mjs
```

Run the exact crossing proof twice:

```bash
TANGENT_BROWSER_TEST=1 node --test --test-name-pattern='Standards never crosses Delivery while Delivery and Neara grow' packages/agent-shell/app/area-map-world-browser.test.mjs
```

Only after inspection, refresh an intentional golden change:

```bash
UPDATE_AREA_MAP_GOLDENS=1 TANGENT_BROWSER_TEST=1 node --test --test-name-pattern='Standards never crosses Delivery while Delivery and Neara grow' packages/agent-shell/app/area-map-world-browser.test.mjs
```

Inspect the refreshed PNG before staging it.

Run the rollback proof:

```bash
TANGENT_BROWSER_TEST=1 node --test packages/agent-shell/app/area-map-rollout-browser.test.mjs
```

Run the complete live-service proof:

```bash
TANGENT_LIVE_SERVICE_TEST=1 node --test packages/agent-shell/app/area-map-world-live-service.test.mjs
```

Run the named non-browser matrix:

```bash
node --test \
  packages/agent-shell/app/area-map-world-ids.test.js \
  packages/agent-shell/app/area-map-world-core.test.js \
  packages/agent-shell/app/area-map-containment-solver.test.js \
  packages/agent-shell/app/area-map-containment.property.test.js \
  packages/agent-shell/app/area-map-world-history.test.js \
  packages/agent-shell/app/area-map-world-load-plan.test.mjs \
  packages/agent-shell/app/area-map-world-controller.test.mjs \
  packages/agent-shell/app/area-map-world-routes.test.mjs \
  packages/agent-shell/app/area-map-world-transaction.test.mjs \
  packages/agent-shell/app/area-map-world-conflict.test.mjs \
  packages/agent-shell/app/area-map-area-move.test.mjs \
  packages/agent-shell/app/area-map-area-move-transaction.test.mjs \
  packages/agent-shell/app/area-map-world-migration.test.mjs \
  packages/agent-shell/app/area-map-world-view-store.test.mjs \
  packages/agent-shell/app/area-map-world-observability.test.mjs
```

Run the final repository checks:

```bash
npm run check
npm run test
npm run governance
npm run build
git diff --check
```

Before each commit, inspect exact staged ownership:

```bash
git diff --cached --name-only
git diff --cached --check
git diff --cached --stat
```

## Commit plan

Do not stage the shared tree broadly.

First, finish and commit the six client-owned files as one coherent slice.

Use exact `git add` paths for those six files.

Next, remove test diagnostics and retain the WYSIWYG wait.

Commit `area-board-browser.test.mjs` as a separate focused test change.

Refresh and commit the golden separately only if the final image change is intentional.

Do not include this handover or unrelated files in a product commit without an explicit decision.

## Live-service state

The health endpoint was green at handover time:

`GET http://127.0.0.1:4321/api/health` returned HTTP 200.

Gateway state: `ready`

Gateway PID: `80508`

Controller PID: `80510`

Gateway boot: `ed16b7fe-a50f-47d2-9135-f605c73782b2`

Controller boot: `5eac2269-f1e2-4526-bebf-d3357fe914a9`

The live server has not received a final rebuild after the latest unstaged edits.

Health is not final map acceptance.

After all commits and checks, use the existing rebuild lifecycle. Do not start a duplicate server.

The HTTP rebuild route is:

```bash
curl -fsS -X POST http://127.0.0.1:4321/api/shell/rebuild
```

Then poll health:

```bash
curl -fsS http://127.0.0.1:4321/api/health
```

Verify the complete world with a read-only request:

```bash
curl -fsS 'http://127.0.0.1:4321/api/areas/map-world?located=otto%2Ftangent'
```

Also open port 4321 and verify the real map UI.

Do not mutate the real vault during manual acceptance.

## Concurrent-work traps

- The checkout is shared by several active tasks.
- The index was empty at handover time.
- Never use a broad `git add` command.
- Never restore or reset unrelated files.
- Never rewrite shared branch history.
- `server.mjs` has unrelated unstaged presentation work.
- The docs and CLI files listed above have unrelated work.
- The untracked `handover.md` is not this handover.
- The crossing golden is clean. Do not regenerate it casually.
- Browser diagnostics exist in one production file and one browser test.
- A long-running shared `npm test` process was visible as PID `89587`.
- A Playwright Chromium tree was visible under agent process PID `88906`.
- Process IDs can become stale. Inspect ownership before stopping any process.
- Browser tests can fail inside the sandbox when Chromium receives `SIGABRT`.
- Use the approved browser commands outside the sandbox when required.
- The feature flag `TANGENT_AREA_MAP_WORLD` defaults to enabled.
- Disabled mode must continue to use the format-2 transaction path.
- Focus and camera are view state. They must never become source authority.
- Spatial movement must never change an element's owner.
- Automatic containment must never write ancestor stored extents.

## Tangent worker constraint

This stopped session did not run its one allowed Tangent command.

The replacement must not run Tangent discovery, service, Goal, Area, or vault commands.

At successful completion, run only this Tangent command:

```bash
tangent send brain --done "<scoped commits, exact proofs, and live 4321 result>"
```

No new design document was created during implementation. No `--present` argument is required.

Do not change the Goal frontmatter. The brain marks the Goal done.

## Finish condition for the replacement

Do not finish after one green browser run.

Finish only after the authority boundary is explicit, diagnostics are removed, and repeated browser proofs are stable.

Then complete all repository checks, commit only scoped files, rebuild the existing service, and verify live port 4321.
