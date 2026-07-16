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

`register` records a dispatched thread's worktree, tmux session name, and (optionally) its Claude
session id in the sidecar registry; when the session id is not yet known at dispatch time, the next
sweep resolves it by matching the most recently active Usage session whose working directory equals
the registered worktree, and persists the resolved id back into the registry. `attach` prints the
`tmux -CC attach -t <name>` command for a registered thread; the caller (a skill) decides how to open
it.

See the design spec at `docs/superpowers/specs/2026-07-16-delegated-threads-orchestration-design.md`
in the repo root for the full behavior contract.
