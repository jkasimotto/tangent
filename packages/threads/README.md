# @tangent/threads

Delegated-thread sweep, registry, and attach for `tangent`.

```bash
tangent threads sweep
tangent threads sweep --dry-run
tangent threads sweep --json
tangent threads list
tangent threads list --json
tangent threads register guy-wires --node neara/pgande --worktree ~/work/otto-guy-wires --tmux tg-guy-wires
tangent threads register guy-wires --node neara/pgande --worktree ~/work/otto-guy-wires --tmux tg-guy-wires --session <claude-session-id>
tangent threads attach guy-wires
tangent threads recur due
tangent threads recur due --dry-run
tangent threads recur run daily-rebase
```

When installed standalone as `@tangent/threads`, use the `tangent-threads` binary with the same arguments:

```bash
tangent-threads sweep
tangent-threads list
```

`threads` externalizes Julian's parallel portfolio of people, branches, and coding agents into the
tangent vault (`~/.tangent/trees`), so the state that used to live only in his head lives instead in
plain markdown and a small JSON sidecar (`~/.tangent/threads-status.json`). A sweep scans open
`thread-<slug>.md` files and `overview.md` "## On me" backlog items across the whole vault,
deterministically derives each thread's state (working, blocked-on-you, ready-for-you, needs-you,
parked, or done), asks a cheap model (haiku by default) for a one-line "why" and any due check-in
drafts, and rewrites the generated `threads.md` glance view. It fires a `terminal-notifier`
notification once per thread newly needing attention, deduped across sweeps.

A sweep never edits vault notes, overviews, or thread files, and a scan or derivation failure exits
nonzero and leaves the previous `threads.md` and sidecar completely untouched; a failed haiku call is
never a sweep failure, it just falls back to templated why-lines built from the owner/deadline/cadence
facts already extracted deterministically.

A parked thread's body can carry a `Wake on <YYYY-MM-DD>` or `Wake when <branch> is merged into
<target> in <repo>` line; each sweep evaluates it deterministically against the clock and local git
state (local refs only, no fetch) and wakes the thread on its own once the condition is met. Any other
prose after `Parked` stays opaque and still needs a human to unpark it. Fanned-out dispatch threads
that share a `Batch: <name>` body line group together in the WORKING section of `threads.md`, sorted by
batch then slug, with why-lines prefixed `[<name>]`, so a batch reads as one unit.

Every sweep also regenerates a "Delegated threads" section in each shared node's
`shared/state-of-play.md`, when that directory exists, listing every non-done thread's owner, state,
and outcome or why-line for teammates who only see the shared repo. The splice is conservative: it
writes only when the file's `tangent-threads:begin`/`:end` markers are unambiguous, and refuses
(logging the marker counts) otherwise so a human fixes them by hand instead of losing content. When the
shared directory is its own git repo the change is committed locally; it is never pushed.

`register` records a dispatched thread's worktree, tmux session name, and (optionally) its Claude
session id in the sidecar registry; when the session id is not yet known at dispatch time, the next
sweep resolves it by matching the most recently active Usage session whose working directory equals
the registered worktree, and persists the resolved id back into the registry. `attach` prints the
`tmux -CC attach -t <name>` command for a registered thread; the caller (a skill) decides how to open
it.

`recur due` scans the vault for `recur-<slug>.md` definitions (frontmatter `schedule`, `cwd`, optional
`model`; body is the worker prompt), runs every one that is currently due, and records the fire in the
sidecar so it does not run again this cycle; `--dry-run` prints what would run without launching or
recording. `recur run <slug>` runs one definition regardless of due-ness, still recording the fire; an
unknown slug is a clear error listing every known slug. The launchd template for running `recur due` on
a timer is `assets/com.tangent.threads-recur.plist` in this package.

See the design spec at `docs/superpowers/specs/2026-07-16-delegated-threads-orchestration-design.md`
in the repo root for the full behavior contract.
