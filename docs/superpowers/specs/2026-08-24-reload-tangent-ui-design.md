# Reload Tangent with committed changes

## 1. Problem contract

**Goal:** Make a Tangent update feel immediate, legible, and complete from the first click through the return to the updated app.

**Root problem:** Julian cannot tell whether Tangent accepted the reload action, what it is doing, or whether it failed. This uncertainty makes the control feel broken. The literal request concerns reload feedback. The root problem is the missing visible and reliable operation lifecycle.

**Constraints:**

- The blue indicator appears only for commits after the running Agent Shell revision.
- The action names the commits that it includes.
- A reload must not stop or restart agent sessions in tmux.
- The browser must preserve the current task context until the new Agent Shell is ready.
- The normal Agent Shell menu must keep separate actions for data refresh, page reload, and code update.
- A failed build must not replace a working Agent Shell.
- The design must work in the local browser and the native macOS wrapper.

**Non-goals:**

- This design does not add automatic updates.
- This design does not show uncommitted edits as an available update.
- This design does not redesign the repository build or package graph.
- This design does not add controls for individual package builds.
- This design does not redesign ordinary data refresh or browser page reload.

**Success criteria:**

- The first confirmed click changes a persistent status within 100 ms.
- The interface shows which commits the action will include before it starts.
- The interface distinguishes building, restarting, reconnecting, success, and error states.
- The browser checks an active reload at least once per second. It does not wait for the 30-second recovery poll.
- A successful operation reloads the page once and shows the deployed commit range after startup.
- An error leaves the old server available and shows an actionable explanation.
- A page reload or native-window reopen restores the active operation status.
- New commits that arrive during an operation remain available for the next operation.
- Agent sessions continue without terminal input loss or tmux restarts.

## 2. Evidence

### Current system

Agent Shell is the local web application at `http://127.0.0.1:4321`. The server lives in [`packages/agent-shell/app/server.mjs`](../../../packages/agent-shell/app/server.mjs). The browser interface lives in [`packages/agent-shell/app/public/`](../../../packages/agent-shell/app/public/).

The running server records the repository `HEAD` during startup. [`commit-change-monitor.mjs`](../../../packages/agent-shell/app/commit-change-monitor.mjs) compares that revision with the current `HEAD`. It returns the intervening commit hash, subject, and author. Uncommitted edits do not affect this result.

The browser reads this result from `GET /api/sessions`. [`shell.js`](../../../packages/agent-shell/app/public/shell.js) shows a blue dot when the commit list is not empty. The menu then shows `Changes · Reload Tangent`.

The update action opens a confirmation dialog. [`shell-interactions.js`](../../../packages/agent-shell/app/public/shell-interactions.js) lists the commits and says that tmux sessions continue. The primary action sends `POST /api/shell/rebuild`.

The server starts `npm run build` in a detached shell. It appends output to `~/.tangent/agent-shell-rebuild.log`. The shell command then stops the server. The command uses `;`, so it stops the server after build success or build error.

The browser sets its `rebuilding` flag only after the POST response arrives. It shows a status pill and a toast. The toast disappears after 3.2 seconds.

Normal updates use server-sent invalidation events. The server cannot send these events while it is offline. [`refresh-lifecycle.js`](../../../packages/agent-shell/app/public/refresh-lifecycle.js) uses a 30-second timer as its recovery path. Therefore, a successful restart can remain invisible until the next timer tick.

The `rebuilding` flag exists only in browser memory. The detached build owns the real work, but it exposes no operation identifier or phase. A page reload loses the flag. A new server cannot report the result of the operation that caused its startup.

The command-line workflow has a stronger completion rule. [`shell.ts`](../../../packages/agent-shell/src/cli/commands/shell.ts) checks the server every 500 ms. It returns only after the boot identifier changes. It reports a timeout and names the rebuild log when the server does not return.

### Current workflow and failure paths

The common workflow is:

1. A new commit causes the blue dot to appear after a data refresh.
2. Julian opens the Agent Shell menu.
3. Julian selects `Changes · Reload Tangent`.
4. A dialog lists the commits.
5. Julian confirms the action.
6. A short toast and a small header pill report that a rebuild started.
7. The server becomes unavailable during its restart.
8. The browser reloads after it detects a new boot identifier.

Three gaps make this workflow feel inert. First, the visible feedback is small and partly temporary. Second, the normal recovery timer can delay detection by 30 seconds. Third, no component reports an error result to the browser.

If the build fails, the detached command still stops the server. Launchd can start the old server again, but the browser cannot distinguish that outcome. The blue dot remains because the deployed revision did not change.

If Julian reloads the page during the build, the new page loses the `rebuilding` flag. It treats the server outage as a generic offline state. If another commit lands during the build, the operation has no durable target record.

### Internal precedents

The CLI rebuild is the closest internal precedent. It uses frequent checks, a boot identifier, a timeout, and a named diagnosis path. This pattern applies because both surfaces start the same asynchronous server operation.

Agent Shell already preserves task context during background refreshes. It avoids repainting an open editor, reader, or popover. This pattern applies because an update must not erase the work that Julian is viewing.

Agent Shell already uses `role="status"` for the header status pill and toast. This pattern provides a product-consistent place for non-blocking update progress.

### External precedents and standards

Electron models updates as distinct events for checking, availability, download completion, restart, and error. It permits restart only after the update is ready. This analogy applies because Agent Shell also prepares an update before it restarts its visible process. See the [Electron `autoUpdater` lifecycle](https://www.electronjs.org/docs/latest/api/auto-updater).

Service workers separate an installed update from activation and page control. This analogy applies because new code is not useful until a new process serves it and the page reconnects. See the [MDN service-worker update lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).

WCAG 2.2 defines waiting, progress, success, and error messages as status messages. These messages must be available to assistive technology without forced focus changes. See [WCAG 2.2, Understanding Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).

Nielsen's visibility heuristic requires prompt and continuous feedback after consequential actions. This analogy applies because the current control starts a multi-second operation and temporarily removes the server. See [Visibility of system status](https://www.nngroup.com/articles/ten-usability-heuristics/).

There is no applicable standard for mapping Git commits to a local application build. Tangent must define that product contract.

### State, ownership, and boundary analysis

The current browser boolean combines several different facts. It cannot represent a build error, a successful build before restart, or a reconnect after restart.

One durable reload operation must own the lifecycle. Its states are `building`, `restarting`, `reconnecting`, `succeeded`, and `failed`. The server exposes the operation. The browser displays it but does not infer it from network errors.

The operation captures one target commit and its commit list when it starts. This target gives later status messages one stable meaning. A new commit after that point belongs to the next update.

The POST boundary starts work and returns an operation identifier. A query boundary returns the current operation state. Expected errors include an active operation, no committed changes, build error, restart timeout, and unavailable status.

The build worker can survive the old server process. Therefore, the operation record must also survive that process. The new server reads the record and completes the same operation after startup.

## 3. Principles

1. One click must create one visible operation with a clear end state.
2. Progress must stay visible for the full operation, not only for a toast duration.
3. The interface must report known state instead of inferring build state from server availability.
4. The update target must stay stable while agents continue to commit other work.
5. A build error must preserve the current working Agent Shell and offer a direct recovery path.
6. The update must preserve Julian's place and every agent session.
7. The common committed-update path must be simpler than the manual recovery path.

## 4. Recommendation

Replace the current toast-led interaction with one durable **Tangent update** lifecycle.

Keep the blue dot as the quiet availability signal. Change the menu row to `Update available · N commits`. Selecting it opens a compact update dialog. The dialog lists the exact commits and has one primary action: `Reload with N commits`.

After confirmation, keep the dialog open and convert it into a non-modal status panel in the same location. Disable repeat submission. Show these phases:

```text
Update available
    -> Building N commits
    -> Restarting Tangent
    -> Reconnecting
    -> Tangent reloaded at <short commit>

Building N commits
    -> Build failed
```

The panel must not take focus after the action starts. Julian can close it and continue to inspect the current page during the build. A persistent header status remains available if the panel closes.

Create one durable operation record at confirmation time. The record contains the operation identifier, old revision, target revision, included commits, timestamps, phase, and result. The detached worker updates this record. The old and new server processes expose the same record.

Use a dedicated active-operation check at 500 ms to 1 second. Do not couple update completion to the normal 30-second recovery timer. When the server is offline after a successful build, show `Restarting Tangent` or `Reconnecting`, not a generic offline error.

Stop the server only after a successful build. If the build fails, keep the current server alive. Show `Build failed`, the failed command or final concise error, and actions for `Try again` and `Open build log`.

After the new server answers, reload the page once. Restore the existing navigation and draft state. Then show `Tangent reloaded · N commits` as a short status message. Remove the blue dot only when the running revision includes the operation target.

If commits arrive after the operation starts, the new update remains separate. After success, the blue dot stays visible with the later commit count.

```text
Current code exposes commits but no operation
-> one operation must own status
-> add a durable update record and query it from both server generations.

The normal recovery timer can delay feedback by 30 seconds
-> feedback must match operation latency
-> check the active operation frequently until it ends.

The current command stops the server after build errors
-> preserve a working system on error
-> restart only after build success.

Agent work lives in tmux
-> preserve task context
-> restart Agent Shell only and state this before confirmation.
```

## 5. Decisions

### Decision 1: Use a persistent operation panel after confirmation

The current toast and small pill do not show the complete lifecycle. The serious options are a toast, a blocking dialog, and a persistent non-modal panel.

Recommend the persistent non-modal panel. It provides continuous feedback and lets Julian continue to read the current screen. This choice supports Principles 1, 2, 6, and 7.

The strongest argument for a blocking dialog is clarity. It keeps the operation impossible to miss. It also prevents useful work during a build and makes normal latency feel more disruptive.

- **User impact:** direct
- **Change cost:** moderate
- **Uncertainty:** low
- **Reconsider if:** user observation shows that Julian regularly misses the persistent panel and starts duplicate recovery actions.

### Decision 2: Store one durable update operation

The browser, old server, worker, and new server all need the same operation facts. The serious options are browser-only state, log parsing, and a durable structured record.

Recommend a durable structured record under `~/.tangent/`. It gives each phase one authority and preserves causality across process restart. This choice supports Principles 1, 3, 4, and 5.

The strongest argument for log parsing is lower initial code cost. Logs do not provide a stable state contract. They also make errors and retries difficult to classify.

- **User impact:** indirect
- **Change cost:** moderate
- **Uncertainty:** low
- **Reconsider if:** Agent Shell gains a general local job system that can own the same operation without extra concepts.

### Decision 3: Check active updates separately from normal refresh

The normal 30-second timer is a recovery path for application data. An active update needs faster feedback. The serious options are that timer, server-sent events only, and bounded short polling.

Recommend bounded polling every 500 ms to 1 second while an operation is active. Events stop when the server stops, but polling recovers after restart. This choice supports Principles 1, 2, and 3.

The strongest argument for server-sent events is lower request volume. Events cannot report the new server until the browser reconnects, so a recovery mechanism remains necessary.

- **User impact:** direct
- **Change cost:** low
- **Uncertainty:** low
- **Reconsider if:** the native wrapper supplies a reliable process-lifecycle channel that remains available during server restart.

### Decision 4: Keep the old server alive after a build error

The current detached command stops the server after success or error. The serious options are unconditional restart and restart only after success.

Recommend restart only after success. A failed update must leave the known working interface available and show the error. This choice supports Principles 3 and 5.

The strongest argument for unconditional restart is process simplicity. It can clear transient server state. It also converts a build error into an avoidable application outage.

- **User impact:** direct
- **Change cost:** low
- **Uncertainty:** low
- **Reconsider if:** a future build changes shared runtime files in place and makes the old server unsafe to continue.

### Decision 5: Capture the target revision when the operation starts

Agents can create more commits during a build. The serious options are a moving `HEAD` target and a captured target revision.

Recommend a captured target revision. The included commit list and the completion message then refer to the same target. Later commits remain available. This choice supports Principles 3 and 4.

The strongest argument for a moving target is convenience. One operation can absorb commits that land during the build. The user can no longer know which changes the operation included.

- **User impact:** direct
- **Change cost:** moderate
- **Uncertainty:** medium
- **Reconsider if:** builds move to immutable deployment artifacts that can safely identify a later revision before activation.

### Decision 6: Keep manual recovery separate

The menu contains both a commit-driven update and `Rebuild and restart…`. The serious options are one merged action and two actions with different scopes.

Recommend two actions. `Update available · N commits` is the common path. `Rebuild and restart…` remains a recovery action and states that no new commit is required. This choice supports Principle 7.

The strongest argument for one action is a smaller menu. It hides the important difference between applying known commits and rebuilding the current deployed revision.

- **User impact:** direct
- **Change cost:** low
- **Uncertainty:** low
- **Reconsider if:** evidence shows that the manual action has no valid recovery use.

## 6. Risks and open questions

### Risk: The repository can change during a build

The target revision is stable, but the current build reads the shared checkout. Uncommitted edits or later commits can change files during compilation. This risk weakens exact commit provenance.

The recommendation assumes that the implementation can detect this condition or build from a stable snapshot without interrupting agents. If neither is practical, the UI must say `targeted commits`, not `included commits`.

### Risk: Durable state can become stale

A worker crash can leave an operation in an active state. The record needs a bounded timeout and a terminal `failed` result. The status must name the last known phase.

### Risk: Page restoration can overpromise

Agent Shell preserves several drafts and selections, but not every transient DOM state. The success message must not claim full restoration until tests cover focus, scroll, dialogs, readers, and terminals.

### Open question: Can the native wrapper open the build log safely?

If the wrapper supports a local-file reveal action, the error panel can offer `Open build log`. If it does not, the panel must show the exact path and a copy action.

### Open question: How long does the full build normally take?

The answer changes the progress treatment. If builds usually exceed 10 seconds, show elapsed time and coarse phase timing. Do not invent a percentage.

### Open question: Can the build use an immutable target without costly installation?

If a stable snapshot is cheap, use it to guarantee commit provenance. If it is expensive, detect repository movement and stop before restart.
