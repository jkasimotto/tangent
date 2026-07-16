# Delegated threads: file-native orchestration for people, branches, and agents

Date: 2026-07-16
Status: draft for review
Owner: Julian Otto
Related: [[2026-07-05-mark-loop-design]] (shares the vault, the usage index, and the humans-confirm-every-step principle). Supersedes the orchestrator-agent idea noted at `~/.tangent/trees/otto/tangent/2026-07-16-orchestrator-agent-idea.md`.

## TL;DR

Julian coordinates a parallel portfolio of delegated threads: people (Will on guy wires, Chris and Troy on autodesign), branches, and coding agents. All of that state lives in his head, so every act of coordination passes through his working memory, and the overhead (re-deriving state, ten-step dispatch rituals, polling delegates, answering "how's it going" for everyone else) is what exhausts him, not the work. This design externalizes the portfolio into the tangent vault and routes his attention instead of relying on his memory. It is deliberately not an app: state is markdown maintained by a deterministic daemon, the verbs are global skills in the proven /tangent pattern, and the only push surfaces are macOS notifications and a statusline badge. A new small package `@tangent/threads` provides the daemon (`tangent threads sweep`) because it needs live agent-session state from the usage index. Four skills (`/dispatch`, `/threads`, `/attach`, `/land`) cover every interaction. Nothing auto-sends, auto-pushes, or auto-merges. v1 is the sweep plus single dispatch, dogfooded on the live PG&E node.

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
- **Calm by default.** Interrupt only for things blocked on Julian. Everything else waits for a glance.
- **Humans confirm outward actions.** Messages to people are drafted, never sent. Merges happen on request. Same principle as the mark loop.
- **Token economics.** Haiku for sweeps, Sonnet for execution, Fable only at judgment moments. The vault is the cheap handoff between models.

## The conceptual model: the delegated thread

Everything Julian coordinates is the same object. A person on a workstream and a sonnet in a worktree differ only in check-in cadence. A **delegated thread** has an owner, a home node in the vault, an outcome, and one of a small set of states:

| State | Meaning | Derived from |
|---|---|---|
| working | needs nothing from Julian | dispatched session active and producing events; or human-owned with cadence not yet elapsed |
| blocked-on-you | interactive: a question is waiting | dispatched session idle at a question or permission prompt for more than 5 minutes |
| ready-for-you | async: a deliverable is waiting | dispatched session ended, summary filed, thread not landed |
| needs-you (check-in) | a timer or deadline hit | a deadline date in prose is today or past; or the check-in cadence has elapsed since the node's last captured note |
| parked | waiting on a condition, not a time | body prose declares a wake condition not yet met |
| done | closed | thread frontmatter `status: done` or `dropped`; removed from the view |

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

1. **Deterministic state derivation.** Scan open `thread-*.md` files across the whole vault, dated items in overviews (the existing `📅 YYYY-MM-DD` markers), live dispatched sessions (via the `@tangent/usage/core` SDK against the global index), and git activity in registered worktrees. Apply the state table above. Overview `## On me` items with no owning thread file render in a trailing UNOWNED section, so backlog without an owner stays visible without requiring thread files for everything. Note-recency for check-in cadence comes from note timestamps in the thread's node, so capturing a reply with /tangent resets the timer with no extra bookkeeping.
2. **Haiku pass.** One cheap model call per sweep writes the why-lines and any due check-in drafts from node prose (the draft includes the outcome from the thread file, so it focuses the person as well as nudging them). Haiku sees the derived states as input and cannot change them. If the haiku call fails, the sweep still completes with templated why-lines.
3. **Outputs.** Rewrite `threads.md`; write `~/.tangent/threads-status.json` (state counts, newest needs-you slugs, sweep timestamp) for the statusline; fire `terminal-notifier` once per thread that is *newly* blocked-on-you or needs-you compared to the previous sweep (dedup state kept in the JSON sidecar). Notification text is the slug plus the why-line.

Failure behavior: a failed sweep exits nonzero, leaves the previous `threads.md` and sidecar untouched, and the statusline shows sweep age, so staleness is visible rather than silent. The daemon writes only `threads.md`, the sidecar, and notifications. It never edits notes, overviews, or thread files.

## The verbs: four global skills

Skills live in `~/.claude/skills/` (global, like /tangent), are short prose in the /tangent style, never interrogate, and shell out to `tangent threads` for the deterministic parts.

**/dispatch `<prose task>`**

1. Infer the node from context (repo, branch, conversation) the same way /tangent does, and read that node's `rituals.md` plus overview and relevant notes.
2. Infer the worktree shape: polez-only, delivery-only, linked pair, or none (analysis-only tasks that output a markdown note). State the full routing guess in one line ("sonnet, delivery worktree otto-clearances-structure-tab linked to polez worktree of the same name off pgande-staging, validating with delivery CLI") and proceed; ask at most one question, and only when the runbook genuinely cannot answer it.
3. Create the worktree(s) per the ritual. Write `thread-<slug>.md` in the node with the outcome and `status: open`.
4. Start the worker (see runtime below) with an injected prompt: the task, the node overview, the relevant notes, and `rituals.md`.
5. `tangent threads register <slug> --worktree <path> --tmux tg-<slug> --session <claude-session-id>` records the linkage the sweep and /attach need (stored in the JSON sidecar's registry section).
6. Confirm in one line: what is running where, and that threads.md will track it.

What dispatch knows without being told, and where that knowledge lives: repo rituals in `rituals.md` (per node); model routing default (sonnet for execution; Fable only if the task is explicitly scoping or extraction); node context from the vault; what "done" means (summary note filed to the node, thread flips to ready-for-you).

**/threads**: run `tangent threads list` and render it in the current session. This is the summonable glance; the same content as `threads.md`, which is also readable directly in NeoVim or Obsidian.

**/attach `<slug>`**: resolve the tmux session from the registry and open it (see runtime). If the worker was blocked, the question is on screen; answer and detach, it keeps running.

**/land `<slug>`**: with a cheap model, merge the thread's worktree branch into Julian's current branch, run the ritual's validation commands, flip the thread file to `status: done` with a closing log line, and offer worktree cleanup. Never pushes anywhere.

**Check-in is not a verb.** Due check-ins are daemon output: they arrive in `threads.md` and as a notification with the message already drafted. Julian sends, edits, or ignores; the reply gets captured with /tangent as usual, which resets the cadence. Nothing is ever sent on his behalf.

## Worker runtime and attach

Every dispatched worker runs as **interactive `claude` (sonnet) inside a tmux session named `tg-<slug>`**, cwd'd to its worktree. Interactive rather than headless is deliberate: an interactive session waiting at a question is exactly the blocked-on-you signal, attach preserves the full scrollback, and no hooks are needed anywhere (blocked detection comes from session telemetry the usage index already captures; this respects the no-provider-hooks rule).

Attach opens a new iTerm tab running `tmux -CC attach -t tg-<slug>`, which materializes as native iTerm panes: the worker on the left, a file-tree pane on the right cwd'd to the worktree (layout set by a small tmux session script at dispatch time). Detach leaves the worker running. `tangent threads attach <slug>` prints or execs the command so the skill stays trivial.

## Package boundaries and governance

`@tangent/threads` needs `@tangent/usage/core` (public export only) for session state, so the vertical-dependency rule amends from "rollup/eval → usage" to "rollup/eval/threads → usage", recorded as an ADR in `docs/decisions/` with the governance lint updated to match. Threads never imports eval or rollup, and reaches the vault by path convention only (same as the tangent skill), so the vault stays a plain vault with no code dependency on it. ARCHITECTURE.md, `docs/architecture/package-boundaries.md`, `docs/architecture/dependency-graph.md`, and the package's own docs are updated as part of the build. The package reuses `@tangent/core` (CLI specs, args) and `@tangent/repo` (git and worktree helpers); it must not duplicate parseArgs, runProcess, or worktree logic.

## Statusline badge

Julian's existing statusline command is extended to read `~/.tangent/threads-status.json` and append a badge: the needs-you plus blocked count (for example `●2`), plus a staleness marker if the last sweep is older than an hour. The badge is present in every Claude session he has open all day, which makes it the ambient glance with zero new surface. When the badge is nonzero, /threads shows which.

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

## Build order and proof gates

Each step gates the next; if a gate fails, stop and rethink rather than building forward.

1. **Sweep + threads.md + notifications + statusline badge.** Dogfood target: the live pgande node exactly as it stands. Gate: after one week, the badge and notifications are routing Julian's attention; he has stopped discovering stale threads by memory.
2. **Dispatch + attach + land** for single dispatch. First real task: the reports-bottom-left UI touch-up (low risk); real test: clearances into the structure analysis tab (linked pair). Gate: one dispatch end-to-end where Julian's total involvement was the prose, at most one attach, and one land.
3. **rituals.md hardening.** Gate: a week of dispatches with no routing corrections needed.

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
