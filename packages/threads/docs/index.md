# @tangent/threads Docs

Purpose: Delegated-thread sweep, registry, and attach. Externalizes Julian's parallel portfolio of
people, branches, and coding agents into the tangent vault, so `threads.md` and a JSON sidecar
carry the state instead of his working memory.

Read next:
- architecture.md
- public-api.md

Package rules:
- Do not depend on Usage (full package), Rollup, or Eval. Only @tangent/usage-index-sqlite for session telemetry.
- State derivation is pure and deterministic; a model never decides a thread's state, only describes it in prose (why-lines, check-in drafts).
- The daemon writes only `threads.md`, the sidecar JSON, and notifications. It never edits vault notes, overviews, or thread files.

Operational notes:
- `tangent threads sweep` is meant to run on a schedule (launchd, every 15 minutes during waking hours); it is safe to run repeatedly and idempotent when nothing has changed.
- `tangent threads sweep --dry-run` prints the would-be `threads.md` and would-be notifications without writing anything or notifying.
- A failed sweep (vault scan error) exits nonzero and leaves the previous `threads.md` and sidecar completely untouched; a haiku failure is not a sweep failure and falls back to templated why-lines.
- Design spec: `docs/superpowers/specs/2026-07-16-delegated-threads-orchestration-design.md` at the repo root is authoritative for behavior.

Wake conditions: a parked thread's body may carry a `Wake on <YYYY-MM-DD>` or `Wake when <branch> is merged into <target> in <repo>` line. Every sweep evaluates it deterministically against the clock and local git state (no fetch, local refs only), so the thread wakes on its own once the condition is met instead of staying parked until a human notices. Any other prose after `Parked` stays opaque, same as v1: only a human can unpark it.

Batch dispatch: fanned-out dispatch threads sharing a `Batch: <name>` body line group together within their node in `threads.md`, sorted by batch then slug, with why-lines prefixed `[<name>]`, so a batch reads as one unit instead of scattering by individual urgency.

The threads.md view: a `NEEDS YOU` strip on top (most urgent first), then every open thread and unowned backlog item organized as the vault's node tree, with node-label chains collapsed (`neara/pgande/`) and state icons per line (`●` needs you, `◐` working, `◌` parked, `⚠` unowned). `tangent threads list <subtree>` re-renders the view filtered to one part of the tree (e.g. `list neara`) from the sidecar's persisted view, without re-sweeping.

Attach: `tangent threads attach <slug>` opens the worker's tmux session in a new full-screen iTerm window (worker left, `nvim .` right), deterministically: absolute tmux path (iTerm profile commands do not inherit the user's shell PATH), pre-flight `has-session` check, idempotent layout split, and a post-launch `list-clients` poll that verifies a client actually attached. On any failure it prints diagnostics plus the manual `tmux attach -t tg-<slug>` command and exits nonzero. `--print` skips the launch and prints the manual command.

Recurring dispatch: a recurring job is a `recur-<slug>.md` vault file (frontmatter `schedule`, `cwd`, optional `model`; body is the worker prompt). `tangent threads recur due` scans the vault, runs every definition that is currently due, and records each fire in the sidecar so it does not run again this cycle; `--dry-run` reports what would run without launching or recording. `tangent threads recur run <slug>` runs one definition regardless of due-ness. The launchd template for scheduling `recur due` on a timer lives at `assets/com.tangent.threads-recur.plist` in this package. Recur `cwd` should ideally be a dedicated worktree: a shared working directory risks attributing your own sessions to the thread, mitigated but not eliminated by the `registeredAt` guard in `resolveSessionIdByCwd`.

Shared state-of-play: every sweep also regenerates a "Delegated threads" section in each shared node's `shared/state-of-play.md`, when that directory exists, listing every non-done thread's owner, state, and outcome or why-line. The splice is conservative: it writes only when the file's `tangent-threads:begin`/`:end` markers are unambiguous, and refuses (logging the marker counts) otherwise so a human can fix them by hand instead of losing content. When the shared directory is its own git repo, the change is committed locally; it is never pushed.

Milestones: a node may carry `milestone-<slug>.md` (frontmatter `title`, `due`, optional `start`; `## Critical path` / `## Nice to have` tracks; `### Group (owner: X, validator: Y)` headings; checkbox outcomes, each optionally with its own `(owner: X)` and an ideal mini deadline `📅 YYYY-MM-DD`). Owners and validators are written as literal Slack handles. `tangent threads milestone <node>` renders the project view; `--slack` prints the paste-ready update (working-day countdown with crossed-off passed days anchored at `start`, superscript markers tying mini deadlines to the timeline, done/open boxes); `--copy` puts it on the clipboard with HTML and plain-text flavors so Slack keeps the formatting on paste. Rendering is deterministic: the file is the source of truth and models never compose the output.
