# Delegated threads: file-native orchestration for people, branches, and agents

Date: 2026-07-16
Status: revised 2026-07-17 after two days of dogfooding (product vision and invariants added; endpoint moved to validate-ready; signal design tightened; /cleanup added)
Owner: Julian Otto
Related: [[2026-07-05-mark-loop-design]] (shares the vault, the usage index, and the humans-confirm-every-step principle). Supersedes the orchestrator-agent idea noted at `~/.tangent/trees/otto/tangent/2026-07-16-orchestrator-agent-idea.md`. Day-two feedback notes in the vault under `otto/tangent/2026-07-17-*`.

## TL;DR

Julian coordinates a parallel portfolio of delegated threads: people (Will on guy wires, Chris and Troy on autodesign), branches, and coding agents. All of that state lives in his head, so every act of coordination passes through his working memory, and the overhead (re-deriving state, ten-step dispatch rituals, polling delegates, answering "how's it going" for everyone else) is what exhausts him, not the work. This design externalizes the portfolio into the tangent vault and routes his attention instead of relying on his memory. It is deliberately not an app: state is markdown maintained by a deterministic daemon, the verbs are global skills in the proven /tangent pattern, and the only push surfaces are macOS notifications and a statusline badge. A new small package `@tangent/threads` provides the daemon (`tangent threads sweep`) because it needs live agent-session state from the usage index. Three verbs match the three moments a thread touches Julian: **/dispatch** (prose in), **validate** (verdict out; normally arrives as a staged summons rather than being typed), and **/cleanup** (one command, done). Shipping (PR, merge, or just a filed note) is a situational route named by the ritual, not a universal verb; /attach and /threads exist but are conveniences, not load-bearing. Nothing auto-sends, auto-pushes, or auto-merges. A dispatched thread's endpoint is validate-ready (the validation surface open in front of Julian with a verdict question), not worker-done. v1 is the sweep plus single dispatch, dogfooded on the live PG&E node.

## The problem

The root problem: the state of the PG&E project and its threads exists only in Julian's head, so he is the single scheduler for everything, and scheduling runs on memory and interrupts. Four taxes follow:

1. **Re-derivation.** Every context switch starts with rebuilding "where is this thread, what state is it in, what's next", at exactly the moments he is most fried.
2. **Dispatch.** Starting one unit of delegated agent work is a ten-step manual ritual (two worktrees with naming conventions, compiler linking, agent launch, model selection, re-explaining the task and tooling, plan approval). The setup costs more attention than the delegation saves, so delegation happens less than it should.
3. **Polling.** Delegated work (human or agent) gives no signal when it needs him. He either interrupts himself to check and mostly finds nothing, or does not check and a person drifts for days while a finished agent sits idle.
4. **Visibility.** Because the state is in his head, the team, Tokes, and the CEO (via the bet entity) can only get it by asking him, which is one more interrupt on the same working memory.

Constraints learned from prior attempts, all binding on this design:

- **No new places, only new verbs.** The /tangent skill succeeded because it is a verb inside the session Julian already occupies. The plate file, a previous orchestrator-agent-in-a-tab, and tangent ui all failed or went unused because they are destinations. Julian does not use tangent ui and does not want to; nothing load-bearing may live in a web surface.
- **No schema growth.** Hardcoded frontmatter routing has been frustrating before. State stays prose; agents derive meaning. This extends the vault's LLM-as-UI founding rule to orchestration.
- **Everything inspectable by hand.** Ordinary worktrees, ordinary branches, readable markdown. No moment where the system knows something Julian cannot see with git and NeoVim.
- **Calm by default.** Interrupt only when his judgment is actually possible and needed: a worker blocked on a question, a due check-in, or a staged deliverable ready to validate. Everything else waits for a glance. (Revised 2026-07-17: originally blocked-only, but a validate-ready thread he is not told about silently degrades into polling.)
- **Humans confirm outward actions.** Messages to people are drafted, never sent. Merges happen on request. Same principle as the mark loop.
- **Token economics.** Haiku for sweeps, Sonnet for execution, Fable at judgment moments. Judgment moments include dispatch-time model routing itself: a task needing spec interpretation goes to Fable from the start (learned on day two, see below). The vault is the cheap handoff between models.
- **Single point of contact.** One place Julian sits; everything comes to him there. Workers in separate tmux windows are an implementation detail he should never have to tour. This is the same principle that made check-ins arrive pre-drafted instead of being a verb he runs. (Added 2026-07-17 from live feedback.)

## Product vision and invariants

Julian sits in one place. The system runs the portfolio: every delegated thread, human or agent, moves through its lifecycle with the system observing every transition, and the only work that reaches him is the work only he can do. Success is two numbers driven toward zero: minutes per day spent on meta-work (setup, staging, bookkeeping, cleanup), and times per day he had to remember to check on something.

Three invariants define the working system. Every design decision below should be defensible as serving one of them, and every dogfooding failure so far has been a violation of one of them.

1. **Attention is spent only on judgment.** The only things that genuinely need Julian are decisions: specs, verdicts on staged work, calls on what ships, relationships with people. Every mechanical step (worktrees, cdev instances, URLs and their query params, module pushes, tmux naming, status bookkeeping, cleanup) belongs to the system. Concretely: a dispatched thread's endpoint is validate-ready, not worker-done. "The diff exists" is a system-internal event, not a Julian-facing one.
2. **Attention is summoned, never spent searching.** He never polls, never scans tmux, never remembers to check. A summons carries identity (which thread), reason (why now), and verb (what resolves it). A signal missing any of the three converts a push interrupt back into a pull investigation, which is the failure mode the system exists to kill.
3. **Signals are true.** State transitions are observed by the system at the moment they happen (worker finishes, branch merges, deadline resolves), never maintained by anyone's memory, his or an agent's. An ambient layer that lies once teaches him to ignore it, and then he is back to polling with extra steps. Trust in the glance is the foundation the other two invariants stand on.

The invariants compress into a three-moment mental model (Julian's own, 2026-07-17): a thread touches him exactly three times. **Dispatch** (prose in), **validate** (verdict out, arriving pre-staged), **cleanup** (one command). Any additional touch is either a violation to fix or a situational extra (shipping route, a mid-flight question) that must justify itself.

## What two days of dogfooding showed (2026-07-17)

The front leg works: well-scoped prose to a running worker to a finished diff is now cheap, and that reduction is real. Every gap found sits on the back leg or in the signal layer, and each maps to an invariant violation. Vault notes: `otto/tangent/2026-07-17-*`.

- **Endpoint too early** (invariant 1). After worker-done, Julian still opened the cdev tab himself, had to know and request the `org=` and `cli=` query params, pushed the module with the matching `--cli` tag, and asked for cleanup piecemeal across several messages. The system's job ended four steps before his judgment was actually possible.
- **Unreviewed output reached him** (invariant 1). A sonnet worker misread judgment-heavy feedback ("similar to Loading") and Julian spent his own time fixing delegated work. A thread must not read ready-for-you until its output has been reviewed. Mitigation tried first: Fable-first dispatch for judgment-heavy tasks (rituals.md and the dispatch skill updated 2026-07-17); an explicit reviewer stage is the build fallback if that proves insufficient.
- **Signals uninformative** (invariant 2). The statusline badge fired as a bare red dot: no slug, no reason, no verb. He fell back to manually scanning tmux sessions (`ctrl-b s` as the stopgap), which is polling again.
- **Signals false** (invariant 3). The dot was nagging a past deadline on a thread whose work had already landed via PR the day before. The sweep derives needs-you from deadlines but cannot see "landed", so the one signal it sent was wrong.

## The conceptual model: the delegated thread

Everything Julian coordinates is the same object. A person on a workstream and a sonnet in a worktree differ only in check-in cadence. A **delegated thread** has an owner, a home node in the vault, an outcome, and one of a small set of states:

| State | Meaning | Derived from |
|---|---|---|
| working | needs nothing from Julian | dispatched session active and producing events; or human-owned with cadence not yet elapsed |
| blocked-on-you | interactive: a question is waiting | dispatched session idle at a question or permission prompt for more than 5 minutes |
| finishing | system-owned: worker done, review and validation staging in progress; still needs nothing from Julian | dispatched session ended, summary filed, but the stage-for-validation checklist (below) has not completed |
| ready-for-you | async: a reviewed, staged deliverable awaits a verdict; the validation surface is open or one command away | staging complete: review passed, app instance up, tab openable with the right params, verdict question drafted |
| needs-you (check-in) | a timer or deadline hit | a deadline date in prose is today or past; or the check-in cadence has elapsed since the node's last captured note |
| parked | waiting on a condition, not a time | body prose declares a wake condition not yet met |
| done | closed | thread frontmatter `status: done` or `dropped`; removed from the view. The sweep also detects the thread's branch merged into its base and, rather than nagging a stale deadline, surfaces "looks landed, close it?" as the thread's why-line; closing stays a human-confirmed act |

The `finishing` state is the 2026-07-17 endpoint correction: worker-done is a system-internal transition, and a thread must not read ready-for-you while mechanical steps (or an unreviewed diff) still stand between Julian and a verdict.

States are derived deterministically. A model describes threads (why-lines, drafts); it never decides their state. This mirrors the mark-loop rule that models describe findings and never discover them.

## Vault conventions (extended, not invented)

The vault already defines threads: `thread-<slug>.md` in a node, frontmatter `outcome`, `status` (`open`/`done`/`dropped`), `opened`, `closed`, body as working log. This design reuses that convention unchanged. Owner, check-in cadence, deadlines, and wake conditions are written in the body as prose, for example: "Owner: Will. Check in every 2 days. Guys on the staging instance by EOD 2026-07-17." No new frontmatter fields.

Two new conventional files:

- **`<node>/rituals.md`**: the dispatch runbook for a project. Contains, as prose: worktree naming (`otto-<shared-branch>`), base branches (pgande-staging vs pgande-dev), the delivery-to-polez compiler link step, validation commands (delivery CLI), and how to boot the app instance so "check it out" resolves to a URL. Maintained by correction: when dispatch gets routing wrong, Julian says "you missed X, add it to the rituals" and the sentence is added. The correction gesture is the maintenance mechanism.
- **`~/.tangent/trees/threads.md`**: the generated view. Like plate.md it is marked do-not-hand-edit and regenerated by every sweep. One section per state, one line per thread: slug, owner, why-line, age. Newest-urgent first.

Target render, derived from the pgande node as it stands on 2026-07-16 (illustrative: some of these threads exist today only as overview items and would need thread files to carry owners and cadences):

```
pgande                                            Wed 16 Jul, 17:40
● NEEDS YOU (2)
  guy-wires       Will        deadline TOMORROW: guys on staging by EOD.
                              Nothing captured from Will since 07-14.
  staging-merge   you         needs someone else to push, you approve. Draft PR ready.

◐ WORKING (4)
  autodesign      Chris+Troy  handover done today; check-in due Fri. Outcome to hold
                              them to: simple clearances+structural, direction =
                              options/phat-picker, not full search.
  snap-points     TomW        pxp review handed over today; check-in due Mon.
  stay-tool       Will        sidewalk guys in library first, then phat picker.
  clearances-tmpl Mara/Nira   not started; nudge drafted, awaiting your send.

◌ PARKED (2)
  error-remediation   wake when pgande-staging lands on main (plan doc ready).
  branch-triage       otto-pgande-autodesign land-vs-drop; dispatchable any time.

⚠ UNOWNED (3)
  dim-fixups backlog · mid-span-taps first user · oscar-lint adoption
```

## The daemon: `tangent threads sweep`

A new package `@tangent/threads` in otto-tangent provides the CLI: `tangent threads sweep|list|register|attach`. launchd runs `sweep` every 15 minutes during waking hours (a LaunchAgent with `StartCalendarInterval` or `StartInterval`; exact plist in the implementation plan).

A sweep does, in order:

1. **Deterministic state derivation.** Scan open `thread-*.md` files across the whole vault, dated items in overviews (the existing `📅 YYYY-MM-DD` markers), live dispatched sessions (via the `@tangent/usage/core` SDK against the global index), and git activity in registered worktrees. Apply the state table above. Invariant 3 makes this step the load-bearing one: every transition the system can observe, it must observe, so a deadline nag is suppressed when the same thread's branch is already merged into its base (check the registered worktree's branch against the base named in rituals.md), and a session that ended flips the thread to finishing without anyone editing a file. Overview `## On me` items with no owning thread file render in a trailing UNOWNED section, so backlog without an owner stays visible without requiring thread files for everything. Note-recency for check-in cadence comes from note timestamps in the thread's node, so capturing a reply with /tangent resets the timer with no extra bookkeeping.
2. **Haiku pass.** One cheap model call per sweep writes the why-lines and any due check-in drafts from node prose (the draft includes the outcome from the thread file, so it focuses the person as well as nudging them). Haiku sees the derived states as input and cannot change them. If the haiku call fails, the sweep still completes with templated why-lines.
3. **Outputs.** Rewrite `threads.md`; write `~/.tangent/threads-status.json` (state counts, the attention-worthy slugs each with a short reason class, sweep timestamp) for the statusline; fire `terminal-notifier` once per thread that is *newly* blocked-on-you, needs-you, or ready-for-you compared to the previous sweep (dedup state kept in the JSON sidecar). Every notification carries the summons triple from invariant 2: identity (slug), reason (why-line), and verb (the command that resolves it, e.g. `/attach clearances` or `/threads`). A notification that only says something is wrong is a defect.

Failure behavior: a failed sweep exits nonzero, leaves the previous `threads.md` and sidecar untouched, and the statusline shows sweep age, so staleness is visible rather than silent. The daemon writes only `threads.md`, the sidecar, and notifications. It never edits notes, overviews, or thread files.

## The verbs: three moments, plus conveniences

Skills live in `~/.claude/skills/` (global, like /tangent), are short prose in the /tangent style, never interrogate, and shell out to `tangent threads` for the deterministic parts. The core verbs are /dispatch, /validate, and /cleanup, matching the three moments a thread touches Julian; /attach and /threads are kept as conveniences but nothing depends on him using them (2026-07-17 verb-model decision).

**/dispatch `<prose task>`**

1. Infer the node from context (repo, branch, conversation) the same way /tangent does, and read that node's `rituals.md` plus overview and relevant notes.
2. Infer the worktree shape: polez-only, delivery-only, linked pair, or none (analysis-only tasks that output a markdown note). State the full routing guess in one line ("sonnet, delivery worktree otto-clearances-structure-tab linked to polez worktree of the same name off pgande-staging, validating with delivery CLI") and proceed; ask at most one question, and only when the runbook genuinely cannot answer it.
3. Create the worktree(s) per the ritual. Write `thread-<slug>.md` in the node with the outcome and `status: open`.
4. Start the worker (see runtime below) with an injected prompt: the task, the node overview, the relevant notes, and `rituals.md`. If the dispatching session is itself in tmux, rename its session to `<slug>-orchestrator` so a session list reads as thread names, not mystery windows.
5. `tangent threads register <slug> --worktree <path> --tmux tg-<slug> --session <claude-session-id>` records the linkage the sweep and /attach need (stored in the JSON sidecar's registry section). Registration distinguishes resources *created* for the thread from resources *reused* by it (worktrees, branches, cdev instances): /cleanup may only tear down what dispatch made. Learned the hard way on 2026-07-17, when a naive cleanup would have deleted a pre-existing 534-commit worktree with uncommitted WIP that a thread had merely pointed a cdev instance at.
6. Confirm in one line: what is running where, and that threads.md will track it.

What dispatch knows without being told, and where that knowledge lives: repo rituals in `rituals.md` (per node); model routing (sonnet for mechanical execution against a tight spec; Fable whenever the task needs spec interpretation or judgment, decided at dispatch time, since a misrouted sonnet costs Julian the review-and-fix time delegation was meant to save); node context from the vault; what "done" means (the stage-for-validation checklist below completes, and only then does the thread flip to ready-for-you).

**Stage-for-validation: the last mile.** When a worker finishes, the system owns everything between the diff and Julian's verdict. The closing checklist, driven by `rituals.md` (which names the validation surface per project) and executed by the worker itself as its final steps, with the dispatching agent or a fresh reviewer as the judgment fallback:

1. Review: the diff is checked against the thread's outcome before anything reaches Julian. v1.1 satisfies this via Fable-first routing for judgment-heavy tasks; an explicit reviewer-agent stage gets built only if misreads keep happening.
2. Boot or reuse the app instance the ritual names (usually cdev in a polez worktree).
3. Push the changes onto the validation surface (e.g. `neara push --module <m> --cli <tag>`), using the same `<tag>` the tab will carry.
4. Open the tab with the full URL: instance plus `org=<org>` (derivable from the customer folder) and `cli=<tag>` (defaults to the thread slug). The `cli` tag and the push tag are one mechanism; the system remembers this so Julian never has to.
5. Draft the verdict question ("check the clearances panel matches Neil's items 1/3/4; anything off?") into the thread file, flip to ready-for-you, and notify with the summons triple.

**/validate `<slug>`**: normally never typed, because staging runs automatically on worker-done and validation arrives as a summons. The verb exists for re-entry: it re-runs the stage-for-validation checklist and reopens the tab, for when a tab was closed, work was revised after a correction, or a thread predates the automation.

**/cleanup `<slug>`** (added 2026-07-17): tear down a finished thread's runtime; standalone, never gated on how the thread shipped. Four steps, in order, reporting found/did/skipped at each: kill the tmux session (`tg-<slug>`), tear down cdev instance registrations the thread created (`plz cdev rm` leaves worktrees untouched), remove worktrees the thread created, and delete branches the thread created only if merged into their base (skip with a warning otherwise). "Created" comes from the dispatch registry's created-vs-reused record; anything the thread merely reused is never touched.

**Shipping is a route, not a verb** (revised 2026-07-17: /land demoted from the core lifecycle). How approved work ships depends on the situation: a GitHub PR from the worktree (how the clearances panel actually shipped), a merge into Julian's current branch, or nothing at all (analysis threads end as a filed note). `rituals.md` names the project's route(s), and the verdict summons offers the applicable one. /land survives as the skill for the merge-into-current-branch route only: cheap model, merge, run the ritual's validation commands, close the thread file. It never pushes anywhere.

**Conveniences, not load-bearing:**

- **/threads**: run `tangent threads list` and render it in the current session; same content as `threads.md`, readable in NeoVim or Obsidian. Day-two reality: unused, and that is fine. Likely earns its keep at higher thread counts; nothing in the core loop requires it.
- **/attach `<slug>`**: resolve the tmux session from the registry and open it. Day-two reality: tmux's native session switcher (`ctrl-b s`) covers this well given the naming conventions, which is why session naming (`tg-<slug>` workers, `<slug>-orchestrator` dispatchers) matters more than the skill itself. Kept for the blocked-question case where the summons names the verb.

**Check-in is not a verb.** Due check-ins are daemon output: they arrive in `threads.md` and as a notification with the message already drafted. Julian sends, edits, or ignores; the reply gets captured with /tangent as usual, which resets the cadence. Nothing is ever sent on his behalf.

## Worker runtime and attach

Every dispatched worker runs as **interactive `claude` (sonnet) inside a tmux session named `tg-<slug>`**, cwd'd to its worktree. Interactive rather than headless is deliberate: an interactive session waiting at a question is exactly the blocked-on-you signal, attach preserves the full scrollback, and no hooks are needed anywhere (blocked detection comes from session telemetry the usage index already captures; this respects the no-provider-hooks rule).

Attach opens a new iTerm tab running `tmux -CC attach -t tg-<slug>`, which materializes as native iTerm panes: the worker on the left, a file-tree pane on the right cwd'd to the worktree (layout set by a small tmux session script at dispatch time). Detach leaves the worker running. `tangent threads attach <slug>` prints or execs the command so the skill stays trivial.

## Package boundaries and governance

`@tangent/threads` needs `@tangent/usage/core` (public export only) for session state, so the vertical-dependency rule amends from "rollup/eval → usage" to "rollup/eval/threads → usage", recorded as an ADR in `docs/decisions/` with the governance lint updated to match. Threads never imports eval or rollup, and reaches the vault by path convention only (same as the tangent skill), so the vault stays a plain vault with no code dependency on it. ARCHITECTURE.md, `docs/architecture/package-boundaries.md`, `docs/architecture/dependency-graph.md`, and the package's own docs are updated as part of the build. The package reuses `@tangent/core` (CLI specs, args) and `@tangent/repo` (git and worktree helpers); it must not duplicate parseArgs, runProcess, or worktree logic.

## Statusline badge

Julian's existing statusline command is extended to read `~/.tangent/threads-status.json` and append a badge. A bare count failed dogfooding on day two (a lone red dot with no identity, reason, or verb sent him hunting): the badge must carry the summons triple in miniature. Shape: most urgent slug plus reason class, then the overflow count, for example `●2 clearances(deadline) +1`; the verb is implicit and constant (/threads shows all, /attach the named one). A staleness marker appears if the last sweep is older than an hour, so a lying-by-omission badge is impossible. The identical script ships to every Claude profile (`~/.claude` and `~/.claude-otto` today), verified by opening a live session in each, since the badge is only ambient if it is everywhere he sits.

## Non-goals

- No web UI and no tangent ui involvement anywhere.
- No auto-send of messages to humans, no auto-push, no auto-merge to shared branches, no auto-edit of vault notes by the daemon.
- No new frontmatter schema; existing thread frontmatter only.
- No batch dispatch, no recurring dispatch, no shared state-of-play generation, and no bet-entity drafting in v1 (all v2, below).
- No always-on orchestrator agent. The scheduler is dumb; all judgment lives in the agents invoked per sweep or per verb.

## v2 candidates (explicitly deferred)

- **Batch dispatch**: paste a list (the DIM-fixups backlog), a Fable scoping interview, fan-out of N workers, sub-threads in the view.
- **Recurring dispatch**: launchd-timed /dispatch with a SOP note as the spec. First two: the daily rebase per the 2026-07-14 staging-rewrite SOP (its abort condition "stop and talk to Troy" maps to blocked-on-you), and periodic bet-entity draft updates.
- **Shared visibility**: the sweep additionally maintains `state-of-play.md` in a node's `shared/` repo (team-facing) and drafts bet-entity updates from its delta. This is the central-visibility-for-everyone goal, deferred so v1 stays private-vault only.
- **Parked-thread wake conditions** evaluated automatically (e.g. "wake when pgande-staging lands on main" checked against git); in v1 parked threads are listed but woken manually.
- **Reviewer-agent stage**: a fresh agent reviews the worker's diff against the thread outcome before ready-for-you. Deferred deliberately: Fable-first dispatch routing is the cheaper mitigation being tried first (2026-07-17); build this only if misreads keep reaching Julian.

## Build order and proof gates

Each step gates the next; if a gate fails, stop and rethink rather than building forward.

1. **Sweep + threads.md + notifications + statusline badge.** Dogfood target: the live pgande node exactly as it stands. Gate: after one week, the badge and notifications are routing Julian's attention; he has stopped discovering stale threads by memory. *(Built 2026-07-16; day-two dogfooding failed this gate on signal truth and signal legibility, which is why steps 1a and 1b now exist.)*
2. **Dispatch + attach + land** for single dispatch. First real task: the reports-bottom-left UI touch-up (low risk); real test: clearances into the structure analysis tab (linked pair). Gate: one dispatch end-to-end where Julian's total involvement was the prose, at most one attach, and one land. *(Built 2026-07-16; the front leg passed, the back leg did not, hence steps 1c and 1d.)*
3. **rituals.md hardening.** Gate: a week of dispatches with no routing corrections needed.

Revised order after day two, worst violation first. Signal truth precedes everything: an untrusted glance makes every other feature unused.

- **1a. Signals true.** Sweep detects merged branches and ended sessions; the stale-deadline false positive class is gone. Gate: a week with zero badge appearances Julian judged wrong.
- **1b. Signals informative.** Badge shows slug and reason class; notifications carry the summons triple; identical statusline verified live in both profiles. Gate: no tmux scanning (`ctrl-b s` untouched for a week).
- **1c. Validate-ready endpoint.** Stage-for-validation checklist runs on worker-done: finishing state, review, cdev, push, tab with `org=`/`cli=`, verdict question, then ready-for-you. Gate: one dispatch where Julian's first contact after the prose is a staged tab and a question.
- **1d. /cleanup** with created-vs-reused discipline. Gate: one thread closed with a single command and nothing reused harmed.

## Testing

- State derivation is pure and unit-tested in `@tangent/threads`: fixtures pair a synthetic vault (thread files, overviews with dated items) with synthetic session states and assert the derived state per thread, including the notification dedup case (a thread blocked in two consecutive sweeps notifies once).
- The haiku pass is tested only for the invariant that it cannot change states (its output is why-line text keyed by slug; anything else is discarded), never for prose quality.
- The sweep's failure path is tested: a scan error leaves the previous outputs untouched and exits nonzero.
- Skills are verified by dogfood, the same way /tangent was. The usual repo gates apply: `npm run check`, `npm run test`, `npm run governance`, `npm run build`.

## Risks

- **Derivation quality.** Will deterministic signals plus prose really capture state? Mitigation: states come from dates, session liveness, and git activity, which are unambiguous; prose only supplies why-lines. Step 1's gate tests exactly this for a week before anything else is built.
- **Notification fatigue.** Mitigation: notify only on newly blocked or newly due threads, deduped across sweeps; everything else waits for a glance.
- **Runbook drift.** rituals.md can go stale like any doc. Mitigation: it is read fresh on every dispatch and corrected in the moment it fails, which is the same loop that keeps the vault itself accurate.
- **tmux/iTerm coupling.** `tmux -CC` is iTerm-specific. Acceptable: this is personal tooling for one user who uses iTerm; plain `tmux attach` remains the portable fallback.
