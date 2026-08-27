# Agent Shell native work contract

Date: 2026-08-27

## Problem contract

Agent Shell must make tmux agent work reliable, recoverable, and keyboard-first.

Actions must be visible on the object they affect. Pointer actions teach their shortcuts. Every shortcut also has a pointer action.

The browser terminal must act as a transparent tmux client. Tangent must not attach at xterm's unmeasured 80-by-24 default.

Every assignment must remain discoverable after an agent exits or Julian changes the harness. A one-time launch prompt cannot be the only copy.

Every worker result for a brain must become durable before wakeup. Delivery must not depend on one recognized harness screen.

Work must lead directly to current work and Area brains. Duplicate entry points must not compete with that path.

Observable success:

- The first terminal attachment uses dimensions measured from the visible frame.
- Later frame changes resize the same tmux client once per dimension change.
- No interface change stops, restarts, replaces, or kills a working agent.
- `Command-K`, an Area name, and Enter open that Area's brain path.
- Work no longer offers Browse Areas or Describe work.
- Escape removes the latest search, focus, or filter constraint before it leaves Work.
- A Goal title opens its active session. The row shows the Goal above the agent and assignment metadata.
- Brain settings and stop remain available from both keyboard and pointer paths.
- Brain and worker launch surfaces use the same harness, model, effort, default, and one-launch override model.
- Every launch and defaults chooser supports Tab, Vim movement, arrows, Enter, Escape, and matching pointer controls.
- Pointer Back and browser-managed Escape leave through one shared route and restore the exact opener.
- Any replacement harness can recover its session, Area, every co-assigned Goal, assignment, prior reports, and opening context with one command.
- An agent that exits to its shell produces one durable brain event.
- The configured brain default controls each new attempt. The launch surface shows the exact resolved choice before start.
- Julian's explicit instructions remain authoritative. Tangent protects live owners and durable records instead of rejecting work by category.

## Evidence gathered before implementation

This section records the faults that selected the design. The implementation outcome below supersedes these runtime statements.

### Terminal attachment still has a readiness race

`public/terminal-controller.js` creates xterm at 80 columns by 24 rows. It waits one timer turn, calls `fit()`, and then connects.

FitAddon returns no proposal while xterm cell measurements are unavailable. A visible parent is required before xterm can measure its cells.

The resize observer watches the host rectangle. It does not observe delayed cell-metric readiness. It can therefore miss the later usable state.

The transport otherwise uses the correct model. It starts a real `tmux attach-session` client through a PTY and forwards terminal bytes.

`terminal-transport.mjs` gives the PTY its initial dimensions. Later resize frames call `node-pty.resize`.

The current regression test checks source-text order only. It cannot prove that a WebSocket waited for measurable cells.

The terminal also differs from a normal PTY in several places:

- `convertEol` rewrites PTY output.
- Shift-Enter has a custom translation.
- Selection code changes primary mouse input into an Option selection.
- Reconnect text is injected into the terminal stream.
- global Agent Shell shortcuts run above terminal input.

Literal iTerm rendering is not available inside the current WKWebView. The achievable contract is compatible input bytes, tmux behavior, geometry, and stable rendering.

### Brain delivery is partly durable

Worker handovers now write an authoritative Goal queue receipt and an exact-Area brain notice. Reconciliation repairs a missing notice.

Brain notices remain unread until their text reaches a brain composer. This protects worker results across controller restarts.

Generic `tangent agent send` messages remain in an in-memory map. They disappear on a controller restart or a dead target.

The current receipt proves presentation to the composer. It does not prove that the receiving model read the message.

Every wake depends on visual detection of a supported empty composer. An unknown configured harness can therefore retain a message forever.

A worker process can exit while its tmux session remains. The queue still calls that assignment running because the tmux session exists.

### Assignment context is durable but hidden

Tmux sessions carry Area, Goal, kind, phase, and assignment tags.

The Goal queue stores the exact assignment instruction, attempts, reports, and prior handovers.

`GET /api/goals/brief` can rebuild a complete Goal or pipeline-step prompt. Brain records can rebuild a brain prompt.

No supported command combines those facts for the agent inside the pane. A replacement harness must reconstruct them manually.

### Work already has a strong keyboard base

Work supports `j`, `k`, `gg`, `G`, `b`, `Command-J`, `/`, and `?`.

`Command-K` can open Documents and existing brains. It does not include an Area until that Area already has a brain record.

The Work toolbar still offers Browse Areas and Describe work. These routes duplicate the direct brain conversation.

Current and Planned already have a latent combined projection through `workFilter="all"`. Collapsing them affects many existing navigation tests.

### Brain defaults were corrected in the current revision

Commit `8687aa0` resolves `defaults.brain` for every attempt. It stores an immutable `resolvedLaunch` on that attempt.

The start surface shows the resolved harness, model, effort, command, and source. The request carries the displayed launch reference.

The server rejects a start when the default changed after display. This behavior meets the launch part of the contract and must remain.

## Implementation outcome

The browser now waits for measured terminal cells before it attaches tmux. It also keeps reconnect status outside the terminal byte stream.

Worker handovers retain their Goal receipt and exact-Area brain notice. Generic agent messages now persist before wake or presentation and survive controller restarts.

`tangent agent context` rebuilds a brain or worker assignment from durable records. Worker recovery includes every same-session Goal and the Goal queue's ordered extra Goals. A replacement harness can recover without a new tmux session.

Go To contains a Brain row for every Area. Work contains every open Goal and no longer exposes Browse Areas or Describe work.

One keyboard owner protects terminals, modals, text editors, Work, and Documents. Work commands share one registry across keys, pointers, help, and commands.

Brain starts support one registered harness, model, and effort override. The Area default remains unchanged.

## Design lenses

### UI and interaction

Work remains the home surface. `Command-K` becomes the complete keyboard route to any Area brain.

The finder contains one Brain row for every Area. Existing records enrich that row but do not create its identity.

Enter opens a live brain or opens the message composer for an inactive or missing brain. The composer uses a stable shell anchor.

The Work toolbar removes Browse Areas and Describe work. Existing sessions and old links remain readable during compatibility.

Brain default controls remain inside the brain composer. Area headers also expose the same settings through `d` and a pointer action.

Current and Planned become one ordered open-work view in this change. The row state identifies work that is running, waiting, stopped, or not started. The projection keeps all open Goals visible.

Empty and error states name the missing fact. An Area without a brain still opens the same composer and resolved-launch summary.

### Live keyboard and object-command amendment

Live use showed that shortcut ownership is as important as shortcut coverage.

One context owns each key event. The priority order is modal, Go To, quick Document, terminal session, transient surface, text editor, Work, and global chrome.

A terminal session gives every key to xterm and tmux except its visible `Command-J` leave action. Agent Shell does not run Work or global commands behind that layer.

A comment composer and every other text editor own normal editing keys. Escape cancels that editor. `Command-Enter` submits it when the surface displays that action.

Work Escape uses this visible order:

1. Close the top transient surface.
2. Cancel staged Area Focus changes.
3. Clear Goal selection.
4. Clear Work search.
5. Clear applied Area Focus.
6. Move focus to the Work tab.

Pointer Back and Escape use one screen router. A child view cannot define two different parents.

The router is a navigation stack, not a collection of tab shortcuts. Each child surface registers one Back adapter with its opener, draft policy, and focus-restoration target. The adapter removes exactly one visible layer and reports that it handled the action. Only an unhandled Back can reach the parent view's constraint order.

This makes navigation predictable everywhere:

1. An editor cancels its inner edit and preserves or discards its draft according to the visible action labels.
2. A popover, menu, or chooser closes and restores its opener.
3. A nested defaults or launch stage returns to its parent composer.
4. A top-level child screen returns to the exact Work row and scroll position that opened it.
5. Work then clears one selection, search, or Focus constraint at a time.

No child screen can use Escape to jump directly to a tab. The shared router owns both the key and the visible Back control, so pointer and keyboard users traverse the same path.

Escape never submits or saves. It cancels the innermost edit before it closes the containing surface.

The harness registry keeps its unsaved draft when Escape returns to Work. Save and Discard remain explicit actions.

The terminal remains the exception. Tmux owns Escape, and `Command-J` leaves its session frame.

One object-command registry defines each product action. It supplies keyboard matching, pointer labels, tooltips, `aria-keyshortcuts`, the `:` command sheet, and the `?` help sheet.

The registry must prove both directions. Every registered shortcut has a visible pointer action. Every command pointer shows its registered shortcut.

Work uses one open-work projection. It does not show Current and Planned buttons. Runtime state appears in each row and does not reorder stable work unexpectedly.

Each Area header owns its brain and Area commands. Its primary brain action uses `b`. Its menu exposes stop `s`, defaults `d`, new Goal `a`, Focus `f`, fold `z`, questions `r`, and note `n`. Decision 28 supersedes the `z` mapping.

Each Goal title is the primary route. It opens a live agent, opens the common launch composer for startable work, or opens Goal context when work cannot start.

A Goal row shows the Goal first. The agent and resolved launch appear below it. Small text names the assignment number and type.

Brain and Goal starts use the same launch catalog. `a` creates a durable Goal and then opens its agent chooser. The chooser shows harness, model, effort, command, and default source.

The chooser traps Tab. `j` and `k` move within a column. `h` and `l` move across Harness, Model, and Effort.

Arrow keys provide the same movement. Enter selects, and Escape restores the exact Work row after it closes.

Defaults use the same chooser. Escape first cancels a default edit, then closes the chooser on the next press.

`Shift-[` and `Shift-]` move to the previous or next real Area. Pointer and command-palette actions use the same records.

An Area default seeds the composer. An explicit picker choice applies to one attempt. It does not edit the Area default.

### Document collaboration amendment

The full and quick Document readers use a normal reading mode. Text controls and comment composers always take ownership away from that mode.

Reading mode supports `j` and `k`, half-page movement, `gg` and `G`, heading movement, Document history, comment movement, staged Escape, and contextual help.

The full reader adds comment actions. `c` creates a comment. `n` and `N` move between comments. An active comment exposes edit `e`, reply `r`, and resolve `x`.

Every comment renders explicit pointer actions. The comment body is readable text, not one large edit button.

Create caches its selection anchor before a pointer click can collapse the browser selection. Edit preserves author and anchor. A missing target never falls back to a whole-Document comment.

Reply adds an adjacent Julian note at the same existing anchor. It does not add a second thread schema.

Resolve uses the canonical resolve route and requires a short change note. A stale or ambiguous target keeps the draft open.

Comment focus uses semantic identity, not a mutable array index. Cancel, save, reply, and resolve restore a meaningful reader or comment focus target.

### Architecture, types, and data

Tmux owns process existence, terminal state, and session identity.

The Goal queue owns assignments, attempts, reports, and the current worker binding.

The brain inbox owns brain-directed events. An atomic session queue owns generic messages until pane-presentation settlement.

The vault owns Areas, Goals, Documents, and their human-readable history.

Agent context is a projection. It does not create a second stored assignment record.

The projection has these parts:

```text
session identity
  -> brain record and rebuilt brain prompt
  -> primary and co-assigned Goal records, current assignment, earlier reports, and rebuilt worker prompt
  -> unassigned session with an explicit no-assignment result
```

The immediate worker-shell event uses a stable source identity. Restarted reconciliation cannot create a second durable notice.

The later acknowledgement mailbox uses a logical recipient, not a runtime session name. Recipient examples are an Area brain or an assignment attempt.

Each future mailbox item has stored, presented, and acknowledged timestamps. A wakeup is only a retryable hint.

### API

Add this private, read-only route:

```text
GET /api/agents/context?session=<exact-name>
```

It returns the session projection and one rebuilt prompt. Unknown sessions return 404. Sessions without assignments return a valid empty context.

Add this CLI command:

```text
tangent agent context [session] [--json]
```

Without a name, the CLI reads the current tmux session. The CLI remains a thin client to the Agent Shell route.

Keep `/api/work/describe` during compatibility. Remove only its normal browser entry point now.

The generic queue remains private to the server. A future mailbox adds pull and model acknowledgement operations. It does not infer acknowledgement from terminal paint.

### Migration and compatibility

No durable data migration is required for the first release.

Virtual finder rows derive from the existing Area index. Existing brain rows merge into those derived identities.

Existing Describe work sessions remain visible. Old browser links and the HTTP route continue to work for one compatibility period.

Existing brain records and Goal queues already contain the context projection's source facts.

Generic messages use `agent-message-queue.v1`. They retain their exact resolved session, survive controller restarts, and settle after pane presentation.

The combined Work projection includes every open Goal. State remains a row fact, so removing the filter does not hide planned work.

### Operations and failure recovery

Terminal connection waits for measured cells. It does not use a timer deadline that can recreate the race.

A hidden or background browser can wait. Attachment begins after the frame becomes measurable.

Controller restart does not affect tmux sessions. The implementation and tests use no live-session stop or restart command.

The worker-shell event records first and wakes second. A failed wake leaves the inbox item available for reconciliation.

Context recovery is read-only. It can run from any supported harness in the existing tmux pane.

Focused terminal tests use fake transports or a private tmux socket. They never attach to or resize Julian's live sessions.

## Alternatives

### Terminal A: keep timer-first fitting

This option is small. It cannot prove that xterm cells are measurable.

It loses because another timing value only moves the race.

### Terminal B: open every session in iTerm

This option gives literal iTerm behavior. It removes the embedded frame that Julian wants.

It remains a useful optional escape hatch, not the main design.

### Terminal C: measured xterm attached as a real tmux client

This option keeps the embedded frame and current transport. It waits for valid FitAddon dimensions before attachment.

It wins because it fixes the observed fault at the ownership boundary.

### Delivery A: direct `tmux send-keys` as storage

This option is simple while the exact pane is ready. It loses messages during restarts, drafts, dialogs, and dead harnesses.

It loses because transport cannot own durable work.

### Delivery B: durable mailbox plus retryable pane wakeups

This option stores the work before any terminal action. The receiver pulls and acknowledges messages independently of its harness UI.

It wins as the target architecture. The first release reuses the durable brain inbox and adds recovery context.

### Recovery A: repeat the launch prompt

This option keeps no retrieval command. It loses after a dead harness and can duplicate completed work.

### Recovery B: project context from tmux tags and durable records

This option uses existing authorities and one read-only command. It wins because no new assignment store is required.

### Work A: retain Browse Areas and Describe work

This option keeps every old path visible. It preserves the navigation that Julian identified as redundant.

### Work B: make the finder the brain directory

This option gives every Area a keyboard brain path and removes both toolbar actions. It wins for the first release.

## Decisions

1. Gate the first terminal attachment on valid FitAddon proposed dimensions.
2. Keep the current PTY and real tmux attachment transport.
3. Stop rewriting PTY newlines. Audit other terminal exceptions against captured iTerm bytes before removing them.
4. Add a virtual Brain finder row for every Area.
5. Open inactive and missing brains directly from the finder.
6. Remove Browse Areas and Describe work from the Work toolbar.
7. Keep their old routes and live sessions during compatibility.
8. Add the read-only agent context route and CLI command.
9. Add a small recovery skill that runs the context command before work.
10. Record one durable brain notice when an assigned agent exits to its shell.
11. Preserve the corrected immutable brain-launch resolution.
12. Relax agent guidance so Julian's explicit direct-edit request can override the normal Goal Markdown tool path.
13. Superseded by decisions 43 to 46. Keep exact live-owner protection. Design explicit cross-Area delegation instead of silent ambient mutation authority.
14. Persist generic session messages before wake or presentation. Keep logical recipients and model-read acknowledgement as a separate release.
15. Use the same launch catalog picker for brains and workers. Seed it from the Area default and allow a one-attempt harness, model, or effort override.
16. Store the resolved brain launch on the new generation. A one-attempt override never changes the durable Area default.
17. Replace key-handler ordering with one explicit keyboard-context owner.
18. Generate shortcut dispatch, pointer teaching, and help from one object-command registry.
19. Use one open-work table and object-owned Area and Goal commands.
20. Add a Vim-style Document reading mode and a complete explicit comment lifecycle.
21. Use one shared back router for pointer Back and browser-managed Escape.
22. Use one keyboard chooser for brain, Goal, and default harness, model, and effort selection.
23. Add previous and next Area commands to the shared Work command registry.
24. Treat start, automatic recovery, handover, stop, and brain reconciliation as one serialized exact-Area lifecycle.
25. Persist stop before process termination, retry both pending and incomplete stops, and refuse resume until settlement.
26. Revalidate a post-snapshot brain attempt after entering the Area lifecycle queue. Only proved absence can consume a recovery attempt.
27. Require the current instance's durable sidecar before logically stopping an already-absent attempt.

## Implementation checklist

- [x] Add measured terminal readiness and real controller tests.
- [x] Remove PTY newline conversion.
- [x] Add and test virtual finder Brain rows.
- [x] Open finder brains without an Area-page detour.
- [x] Remove the two Work toolbar actions.
- [x] Combine Current and Planned into one open-Goal Work projection.
- [x] Add object-owned Work commands and staged Escape.
- [x] Add direct brain stop, defaults, and new-Goal keyboard paths.
- [x] Add keyboard launch and default selection with trapped Tab and staged Escape.
- [x] Add shared pointer Back and Escape routing for the harness registry.
- [x] Add previous and next Area keyboard, pointer, palette, and help actions.
- [x] Add and test `/api/agents/context`.
- [x] Add and test `tangent agent context`.
- [x] Add and validate the recovery skill.
- [x] Add and test the durable worker-shell brain event.
- [x] Persist generic agent messages before pane wake or presentation.
- [x] Add a one-attempt registered brain launch override.
- [x] Amend session guidance for explicit Julian-directed Markdown recovery.
- [x] Add Vim Document reading and comment create, movement, and edit safety.
- [x] Complete comment reply and resolve actions.
- [x] Update Agent Shell public and operator documentation.
- [ ] Run focused tests, package checks, and repository validation.
- [ ] Commit only this change. Do not rebuild or restart the live Agent Shell.

## Risks and unknowns

The browser cannot reproduce iTerm rendering exactly. Byte compatibility needs a captured iTerm acceptance fixture.

Shift-Enter and copy behavior can regress if current exceptions disappear without that fixture. This release keeps those exceptions.

A rebuilt prompt reflects current durable context. It is not a byte copy of the original launch prompt.

The context command can recover recorded work. It cannot recover unrecorded words that existed only in a dead model's memory.

Generic messages survive controller restarts. They settle after pane presentation, not after a model-read acknowledgement.

An unknown harness can keep a generic message queued because safe pane presentation still needs a recognized empty composer.

Superseded risk: Cross-Area authority still needs an explicit delegation record. Removing the check without that record could let one stale brain mutate another Area.

## Design amendment: coherent Work objects and permissive coordination

Date: 2026-08-27

Status: selected design. This section supersedes the conflicting clauses named below.

Live use found another connected set of failures. Work has keyboard commands, but several objects still use separate interaction and authority models.

This amendment covers Work tree movement, Goal reading, Goal status, launch editing, agent replacement, action menus, and cross-Area commands.

It does not change a live process. It does not rebuild Agent Shell. It does not stop any current agent.

### Evidence that selected the amendment

Work uses `z` as one Area fold toggle. Lowercase `h` and `l` are free in Work.

The launch chooser already owns `h` and `l` while that chooser is open. The Document reader owns uppercase `H` and `L`.

Keyboard contexts prevent these meanings from conflicting.

An Area name in Work owns `data-open-area`. Enter therefore opens the Area browser instead of the Area brain.

A Goal title has three different routes. It opens a launch chooser, a live session, or raw Goal Markdown based on runtime state.

There is no stable Goal reader. The existing Document reader can already render Goal Markdown and its comments.

Goal checkboxes only store browser selection. The selected Goals start one shared agent.

The durable queue already stores co-assigned Goals for brain dispatch and recovery. Removing checkboxes does not require removal of that data.

The repeated You and Dependency lines are folded-Area previews. They are not Goal state and are not dependency authority.

Goal status accepts only `open`, `done`, and `dropped`. Several readers recognize `deferred`, but no supported command writes it.

The launch chooser traps Tab, but Vim movement only covers Harness, Model, and Effort choices.

Draft steps support limited add and remove actions. Saved pending steps support limited edits. No route supports pending-step removal or reorder.

The queue already serializes mutations by Goal. It also supports revisions and idempotency keys.

Queue assignments have stable IDs. Session continuation still points to a mutable step number.

The Brain composer has two competing focus requests. An asynchronous launch-option repaint can move focus from the instruction to a radio option.

Typing then appears to do nothing.

Far-right actions use native `details` elements. A click can trigger a synchronous repaint before the browser toggles the element.

The browser then toggles detached markup. The replacement menu remains closed.

The server rejects edits to a started assignment. Its retired restart action returns 410.

The closest safe replacement pattern is the Brain handover transaction. It persists the replacement before launch and retires the source last.

The server also treats a brain's Area as a command permission. `exactBrainCaller` rejects every other target as `wrong-area`.

The same check guards Goal creation, start, advance, append, edit, dependencies, comment resolution, and some closure effects.

A Goal start without a caller still requires the exact target brain to be live. Omitting the caller does not solve the inactive-child case.

Generic agent messages first resolve a live runtime session. An inactive Area brain has no address for that message path.

The Area brain inbox already provides the correct opposite pattern. It stores a logical Area message before any attempt to wake a process.

### One surface and navigation contract

Every interactive surface has one state owner. Browser element state cannot be the only record that a surface is open.

Each surface declares these facts:

```text
surface identity
object identity
semantic opener
initial focus key
ordered focus keys
available commands
draft policy
Back action
```

A surface is open only after it registers all of these facts. Asynchronous data cannot select a different initial focus.

Repaint restores a semantic focus key. It does not rely on the old DOM node.

Escape and pointer Back call the same Back action. The action removes one visible layer and restores its exact opener.

The launch editor, Brain composer, settings editor, Goal status surface, and action surface use this contract.

The Brain composer gives its instruction field initial focus. A user can type immediately after `b`.

Provider choices receive focus only after the user enters that region.

### Work tree commands

Lowercase `h` and `l` replace `z` in Work.

`h` collapses the current expanded tree node. If that node is already collapsed, `h` moves focus to its parent.

`l` expands the current collapsed tree node. If that node is already expanded, `l` moves focus to its first visible child.

A leaf has no `l` action. Its command surface explains that it has no children.

The rule applies to Area groups and Goals with Subgoals. It also defines focus after a collapse.

The synthetic Other Areas group can collapse. Previous and next Area movement continues to skip that synthetic group.

Pointer disclosure controls invoke the same commands. Their labels show `h` or `l` for the action that is currently available.

The Work command registry removes `z`. It adds separate `collapse` and `expand` command records.

Work keeps `{` and `}` for previous and next real Area movement.

### Primary object actions

The following table defines the common Work actions.

| Focused object | Enter | `o` | `c` | `x` | `:` |
|---|---|---|---|---|---|
| Area | Open, resume, or start its Brain path | Read Area note | Not available | Not available | Area actions |
| Startable Goal | Open the launch editor | Read Goal | Choose agent | Goal status | Goal actions |
| Live Goal | Open the current agent | Read Goal | Change agent | Goal status | Goal actions |
| Blocked Goal | Read Goal and the disabled start reason | Read Goal | Not available | Goal status | Goal actions |
| Closed or parked Goal | Read Goal | Read Goal | Not available | Goal status | Goal actions |

The Area name in Work uses the Brain path. Work no longer routes the Area name to Browse Areas.

The Goal title remains the natural agent action. This preserves the successful Enter behavior for startable and live Goals.

`o` always reads the Goal. The pointer action is named Read Goal and displays `o`.

`c` opens Change agent for a live or stopped assignment. The pointer action displays `c`.

`x` opens Goal status. It no longer marks a Goal done immediately.

`:` opens one state-owned action surface for the current object. The far-right pointer action opens that same surface.

The action surface uses roving focus, `j`, `k`, arrows, Enter, and Escape. It returns focus to the exact row.

Native `details` elements leave the Work table. A repaint cannot silently close an unrecorded menu.

A pointer click can update the semantic Work cursor. It cannot repaint before the requested action is recorded.

### Simpler Work rows

The Goal checkbox column and the shared-selection bar leave Work.

The browser selection state, checkbox handlers, and selection-specific Escape stage also leave Work.

The queue keeps ordered co-assigned Goal references. Brains and recovery tools can continue to use them.

Work removes the folded You and Dependency preview lines.

Work also removes repeated dependency readiness text from the Goal state cell.

Dependencies remain durable. They still control order and whether Start is available.

A blocked Goal opens its reader. The reader shows the exact blocking Goals and any broken reference.

This design removes noisy presentation. It does not remove dependency behavior or data.

### Goal reader

Goal reading becomes a stable mode of the existing Document reader.

It renders the Goal Markdown, comments, done condition, current state, dependencies, related Documents, queue, and attempt history.

The reader uses the existing Document movement and comment commands. Goal actions appear in its object action surface.

It is not a second Area browser. It has one Back action to the exact Work row or Document link that opened it.

Add this read model:

```text
GET /api/goals/detail?goal=<file-or-slug>
```

The response includes the parsed Goal, dependency facts, queue, sessions, related Documents, and available commands.

The response reports disabled commands with a reason. The browser and CLI do not recalculate permission or readiness.

`tangent goal show` uses this read model. Its text output includes notes, state, done condition, dependencies, queue, and current agent.

Existing Goal show and brief routes remain readable during compatibility.

### Goal status

One Goal status surface contains Done, Won't do, Park, Reopen, and Cancel.

Inside that surface, `d`, `w`, `p`, and `r` select those actions. Pointer controls display the same keys.

Done remains a completed outcome. Won't do remains a terminal outcome and requires a reason.

Park is reversible. It records an optional short reason and removes the Goal from default Work.

Park does not delete the Goal, queue, reports, comments, or attempt history.

Reopen changes Done, Park, or Won't do back to open. It does not start an agent.

A parked prerequisite remains unresolved. Its dependent Goals remain blocked.

The durable status value is `parked`. Readers normalize legacy `deferred` to `parked`.

New writes never emit `deferred`.

Parking a live Goal requires confirmation. The server operates on the exact current attempt.

If that session has other open Goals, the server detaches only the parked Goal and keeps the session alive.

If that session only owns the parked Goal, the server retires the exact owned attempt after the status commit.

An ownership or cleanup failure leaves the Goal and agent visible. It never guesses a target from a session name.

Add these CLI actions:

```text
tangent goal park <slug> [--reason <text>]
tangent goal reopen <slug>
```

Done and Won't do keep their existing CLI names.

### Unified launch editor

Brain launch, Goal launch, and Area settings reuse one picker component and one focus contract.

The Goal launch surface becomes a Launch Editor. It has five ordered regions:

1. Assignment list.
2. Assignment instruction, type, path, and continuation source.
3. Harness, model, and effort.
4. Exact resolved command and source.
5. Save or start actions.

Tab and Shift-Tab move between regions. `j` and `k` move within a region.

`h` and `l` move across Harness, Model, and Effort only while that picker region owns the key.

Arrow keys provide the same movement. Enter opens or selects the focused item.

The assignment list adds these commands:

- `a` inserts a pending assignment after the current pending assignment.
- `e` edits the selected pending assignment.
- `d` removes the selected pending assignment.
- `J` moves the selected pending assignment down.
- `K` moves the selected pending assignment up.

Every command has a pointer action with its key. Escape cancels the inner edit before it closes the Launch Editor.

Running, waiting, completed, skipped, ended, and replaced attempts are history. The editor cannot rewrite that history.

The mutable pending suffix supports instruction, type, path, launch choice, and continuation source.

Display step numbers are projections. Mutations use stable assignment IDs.

Continuation stores `continueFromAssignmentId`. It does not store a position that changes after reorder.

One Save sends all local pending changes atomically:

```text
POST /api/pipelines/mutate

goal
expectedRevision
operationId
operations[]
```

Operations are `add`, `update`, `remove`, and `move`. Each existing target uses an assignment ID.

The server applies the batch under the existing per-Goal lock. It validates references before it writes any change.

A stale revision returns the current queue and a `stale-revision` code. The editor keeps the local draft.

The user can reload and reapply. Tangent never discards the draft because another caller changed the queue.

The current append and edit routes remain during compatibility. New browser code uses the batch route.

### Change agent without recreating the Goal

Change agent is a first-class attempt replacement. It is not Goal deletion, Goal recreation, queue restart, or a live-step edit.

The chooser starts with the current attempt's harness, model, and effort. It keeps every other assignment field.

The operation preserves these facts:

- Goal file and revision.
- Queue and assignment identity.
- Instruction, type, path, and continuation source.
- Co-assigned Goals and related Documents.
- Reports, handovers, comments, and earlier attempt history.
- Later pending assignments.

The chosen launch becomes the assignment's desired launch for later attempts. Each attempt keeps its immutable resolved launch snapshot.

The Area default does not change.

Add this route and CLI command:

```text
POST /api/goals/attempts/replace
tangent goal replace-agent <slug> --launch <harness[/model[/effort]]>
```

The request names `goal`, `assignmentId`, `expectedRevision`, `expectedAttemptId`, `launch`, and `operationId`.

The server derives the instruction, path, context, Documents, co-assigned Goals, and tmux tags. The caller cannot replace those fields.

The operation has these durable states:

```text
requested
replacement-starting
replacement-ready
source-retiring
complete
failed
rollback
retirement-incomplete
```

The server persists the operation before it starts a process.

It starts the replacement in a new owned tmux target. Changing a harness inside the old process is not a safe session edit.

The browser opens the new target automatically. The Goal identity makes the transition feel continuous.

The old agent remains alive until the new attempt proves process readiness and durable prompt availability.

A harness with no readiness receipt leaves the old agent alive. The surface offers an explicit Finish replacement action after Julian inspects the new agent.

Startup failure terminates only the exact replacement target. The old attempt remains current and untouched.

The server retires the source only after readiness or explicit confirmation.

If source retirement fails, both sessions remain visible. Tangent reports `retirement-incomplete` and does not kill by name.

If the source session owns other open Goals, it remains alive. Tangent detaches the replaced Goal and sends a durable scope-change message.

Late source reports remain attached to the old attempt as late evidence. They cannot advance the current queue.

Retries with the same operation ID return the same operation. They do not launch another process.

Immutable fencing includes Agent Shell instance, Area, Goal, assignment, attempt, and tmux target.

### Permissive command authority

Area paths organize records and message destinations. They do not grant command permission.

Caller identity becomes audit provenance. It is not an Area capability.

Any local Tangent caller can create, edit, queue, start, append, advance, inspect, message, or resolve work in any Area.

This rule applies to brains, workers, the browser, and a local shell outside tmux.

Parent, child, sibling, and unrelated Areas have the same command behavior.

The server removes `wrong-area` checks and the live-exact-brain requirement for normal Goal start.

A command acts on its target directly. It does not silently become a delegated request.

The target Area brain receives a durable event after the state commit. An inactive or missing target brain does not block the operation.

When the brain later starts, it reads that event from its logical Area inbox.

The queue remains the single writer for assignment state. Permissive callers do not create multiple queue authorities.

The existing per-Goal lock, expected revision, and idempotency key serialize concurrent callers.

Live ownership remains an invariant. A command cannot steal or terminate a different live owner through an ordinary start or edit.

Stop and replacement operations require the exact current attempt and immutable tmux target.

Schema checks, stale revisions, missing records, foreign sessions, and ownership conflicts remain valid errors.

Brain, worker, and Area identity alone are not valid denial reasons.

Agent guidance still states when Julian's words are required for Done, Won't do, or Area closure.

The server records the actor and target. It does not infer Julian's intent from the actor's Area path.

The Brain prompt replaces its exact-Area mutation boundary with this instruction:

```text
You can coordinate Tangent work in any Area. Area paths organize work; they do not grant permission.
Do not take over a live owner. Use revision and exact-attempt controls for conflicting work.
Follow Julian's status instructions and record the target Area on every mutation.
```

`tangent agent send` accepts a live session or an Area path.

A live session uses the durable session queue. An Area path uses the durable Area brain inbox.

A known stale brain session resolves to its logical Area inbox. A completely unknown target still returns not found.

The send operation stores first and wakes second. No live child brain is required.

### Authority supersession

Decision 13 above is superseded. Cross-Area work does not require a delegation record or capability grant.

The earlier cross-Area risk statement is also superseded. Revision and ownership fences address stale writers without an Area permission gate.

This amendment supersedes only the exact-Area mutation clauses in ADR-0034.

ADR-0034 remains authoritative for one Goal queue, typed reports, immutable attempt history, durable inboxes, and review-based automatic closure.

The implementation change must update ADR-0034 and the Brain prompt in the same atomic change.

### Compatibility and data change

Checkbox and dependency-preview removal have no durable data change.

The backend keeps `extraFiles` and ordered co-assigned Goal context.

Goal readers accept `deferred` and `parked`. They expose both as Parked.

Goal writers emit only `parked`. Existing `open`, `done`, and `dropped` values keep their meanings.

Queue readers accept numeric `continueFrom` and stable `continueFromAssignmentId`.

When only a number exists, the reader resolves it against the stored assignment order.

New writes use only the stable assignment ID. A normal queue mutation can persist the normalized form.

The current queue schema can receive an additive revision, or move to `area-goal-queue.v3` if strict readers require it.

Old append and edit routes remain for one compatibility period. They use the same queue lock and stable-ID conversion internally.

Attempt replacement adds operation state outside the vault. The queue remains authority for the attempt history.

Permissive command authority needs no data migration. It changes validation, prompt text, tests, and audit fields.

Area-addressed messages reuse the durable Area inbox. Generic live-session messages keep their current queue.

### Operations and failure recovery

Every material mutation log records actor session, actor Area when known, target Area, Goal, assignment, operation ID, and result.

Logs do not record full prompts or private Document text.

The UI shows saving, stale, starting replacement, ready, retiring source, failed, rollback, and incomplete retirement states.

The server owns retries for persisted operations. The browser can repeat the same operation ID after a lost response.

A controller restart resumes an unsettled replacement from its stored state.

A same-name tmux session is insufficient proof. Instance, Area, generation, assignment, attempt, and target tags must match.

If the proof fails, Tangent leaves every session alive and reports the exact mismatch.

No interface deployment needs a live-session restart. Tests use fake transports or a private tmux socket.

### Rejected alternatives

Keep `z` as a fold toggle. This loses because it does not express the tree direction or parent movement.

Make Enter always read a Goal. This loses because the Goal title is already the successful agent route.

Add another Goal detail application. This loses because the Document reader already owns Markdown, comments, and reading commands.

Keep native `details` menus and patch click order. This loses because browser state remains outside the shell state and repaint contract.

Keep Work checkboxes for rare shared assignment. This loses because brains own dispatch and the backend can keep the capability without table clutter.

Delete dependency data with its labels. This loses because execution order still needs the durable relationship.

Reuse `deferred` as the public Park value. This loses because the UI and CLI would expose a different noun from stored state.

Use separate create, update, delete, and move requests for pending steps. This loses because reorder and reference repair must commit together.

Replace the whole pending suffix on each Save. This loses because a stale editor can overwrite another caller's unrelated change.

Edit the running assignment launch in place. This loses attempt provenance and does not replace the live process atomically.

Kill the source before replacement launch. This loses the only viable worker when launch fails.

Delete and recreate the Goal. This loses Goal identity, comments, queue history, and relationships.

Route every cross-Area command to the target brain. This loses because an inactive child brain remains a coordination bottleneck.

Restore only ancestor authority. This loses because hierarchy is still an arbitrary command permission.

Require a one-action capability token. This loses because the local application gains grant, expiry, replay, and revocation work without a security boundary.

Remove all concurrency checks in the name of permissiveness. This loses because stale writes and live-owner replacement are data-loss risks, not role policy.

### Amendment decisions

28. Replace Work `z` with contextual `h` collapse and `l` expand commands.
29. Route an Area name and Enter to that Area's Brain path.
30. Keep Goal Enter as the primary agent route and add `o` as the stable Goal reader.
31. Replace native row menus with one state-owned object action surface.
32. Remove Goal checkboxes, shared-selection UI, and repeated dependency previews from Work.
33. Preserve co-assigned Goal and dependency data outside that presentation.
34. Add Park as a reversible Goal status and normalize legacy Deferred to Parked.
35. Put Done, Won't do, Park, and Reopen in one keyboard and pointer status surface.
36. Use the Document reader as the Goal reader and add one complete Goal detail read model.
37. Turn the Goal chooser into a complete pending-assignment editor.
38. Address assignment mutations and continuation links with stable assignment IDs.
39. Commit pending-assignment changes as one revision-guarded operation batch.
40. Add first-class Change agent as an atomic attempt replacement.
41. Start a replacement before retiring its exact source attempt.
42. Keep the source alive when readiness is unproved or retirement is incomplete.
43. Treat caller identity as audit provenance, not an Area command capability.
44. Permit any Tangent caller to coordinate any Area through the same commands.
45. Keep queue revision, idempotency, immutable target, and live-owner fences.
46. Let `tangent agent send` address an Area brain even when it has no live session.
47. Update ADR-0034 and Brain prompt authority text with the implementation.

### Acceptance evidence for the future implementation

- `h` and `l` operate Area and Subgoal tree nodes and restore the correct parent focus.
- Work has no `z` command, Goal checkbox, shared-selection bar, or folded dependency preview.
- Area Enter uses the Brain path. Goal Enter uses its agent path.
- `o`, `c`, `x`, and `:` have matching pointer actions and visible shortcut labels.
- A far-right pointer action opens after another transient surface closes.
- Delayed Brain launch options do not steal focus from the instruction field.
- Every launch region and pending-step action works without a pointer.
- Pending-step removal and reorder keep stable continuation references.
- Goal reading shows narrative, notes, done condition, dependencies, queue, and attempts.
- Park and Reopen preserve Goal history and do not affect unrelated live agents.
- Replacement startup failure leaves the source attempt alive and current.
- Replacement success preserves Goal and assignment identity and records both launch snapshots.
- A parent brain starts a child-Area Goal while the child brain is inactive.
- That start produces no `wrong-area` or exact-brain-active error.
- The inactive child Area receives a durable event about the operation.
- A stale revision, foreign target, or live-owner conflict still fails without process termination.

## Sources

- `docs/design/agent-shell-work-contract/user-intent.md`
- `packages/agent-shell/app/public/terminal-controller.js`
- `packages/agent-shell/app/terminal-transport.mjs`
- `packages/agent-shell/app/public/work-desk-view.js`
- `packages/agent-shell/app/public/work-commands.js`
- `packages/agent-shell/app/public/goal-launch-view.js`
- `packages/agent-shell/app/public/shell-event-bindings.js`
- `packages/agent-shell/app/public/keyboard-context.js`
- `packages/agent-shell/app/public/go-to-rows.js`
- `packages/agent-shell/app/public/shell-coordinator.js`
- `packages/agent-shell/app/message-delivery.mjs`
- `packages/agent-shell/app/message-queue-store.mjs`
- `packages/agent-shell/app/brain-inbox.mjs`
- `packages/agent-shell/app/pipeline-record.mjs`
- `packages/agent-shell/app/session-ownership.mjs`
- `packages/agent-shell/app/brain-record.mjs`
- `packages/agent-shell/app/server.mjs`
- `packages/agent-shell/app/agent-routes.mjs`
- `packages/agent-shell/src/cli/commands/agent.ts`
- `packages/agent-shell/src/cli/commands/goal.ts`
- `packages/agent-shell/src/cli/spec.ts`
- `packages/agent-shell/app/workspace/AGENTS.md`
- `docs/decisions/ADR-0034-audited-area-brain-workflow.md`
- `docs/decisions/ADR-0037-brain-attempt-launch-override.md`
- `docs/decisions/ADR-0038-agent-shell-keyboard-ownership.md`
- `docs/decisions/ADR-0039-durable-generic-agent-message-queue.md`
