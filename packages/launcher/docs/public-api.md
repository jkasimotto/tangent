# @tangent/launcher Public API

Public import path:
- @tangent/launcher

`@tangent/launcher` exports `openAgent`, `openDirectory`, `loadLaunchConfig`, `saveLaunchConfig`, `defaultLaunchConfig`, `configPath`, `listActiveSessions`, and the types `LaunchConfig`, `LaunchSession`.

`openAgent(cwd, options?)` opens a new terminal session running the configured agent command in the given directory.

`openDirectory(path, options?)` opens a new terminal session at the given path with a shell login, no agent command.

Both functions accept an optional `config` override. Without it, config is loaded from `~/.tangent/launcher/config.json`. Both record the launch in `~/.tangent/launcher/sessions.json`.

`listActiveSessions()` returns sessions that are still live. Tmux sessions are checked via `tmux has-session`; non-tmux sessions are returned if launched within the last 24 hours.

`LaunchSession` has `cwd`, `kind` ("agent" | "terminal"), `tmux`, optional `tmuxSession` (the named tmux session, when created), and `startedAt`.

Agents must import through this public export, not package src internals.
