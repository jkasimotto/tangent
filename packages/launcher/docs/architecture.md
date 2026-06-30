# @tangent/launcher Architecture

Terminal launcher for opening agents and project directories.

The package has two orthogonal axes:
- **Driver**: which terminal app to open (iterm2-tab, iterm2-window, custom template).
- **tmux flag**: whether to wrap the command in a tmux window or session.

When tmux is true and $TMUX is set (already inside a session), `tmux new-window` is called directly and the driver is bypassed. When tmux is true but no session is active, the driver opens a terminal and the shell command inside it starts a new tmux session.

Rules:
- Do not import vertical app packages (usage, rollup, eval, search, trees).
- Driver implementations must not block the caller.

Refer to ../../../docs/architecture/package-boundaries.md and ../../../docs/architecture/dependency-graph.md for monorepo boundaries.
