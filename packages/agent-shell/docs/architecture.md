# @tangent/agent-shell Architecture

The package is `src/cli/` and nothing else. The root `tangent` CLI lazily loads `@tangent/agent-shell/cli` for the `area`, `goal`, `idea`, `document`, `vault`, and `agent` nouns, the same way it loads `usage`, `eval`, `rollup`, `search`, and `threads`.

- `src/cli/spec.ts`: the help specs (`areaCommandSpec`, `goalCommandSpec`, `ideaCommandSpec`, `documentCommandSpec`, `agentCommandSpec`, `vaultCommandSpec`).
- `src/cli/client.ts`: the HTTP client. Loopback-only, default `http://127.0.0.1:4321`, overridable via `--server` or `TANGENT_SHELL_URL`. It also reads the current tmux session name, which is the agent's identity for ownership, messaging, and handover.
- `src/cli/commands/{area,goal,idea,document,agent}.ts`: thin HTTP clients to the Agent Shell server. They never read or write vault files, and never spawn agents. `goal start` and `goal handover` post to the server's pipeline endpoints; the server (`prototypes/agent-shell/server.mjs`) records the pipeline under `~/.tangent/agent-shell/pipelines/` and spawns each step as an ordinary tmux Goal session.
- `src/cli/commands/vault.ts`: the one command that shells out itself. `vault commit` uses `@tangent/repo`'s `git()` to commit directly to `~/.tangent/trees` with the same message shape and trailers as the server's `vaultCommit()`.

Dependencies: `@tangent/core` (arg parsing, help rendering), `@tangent/agent-runtime` (`runProcess` for `tmux display-message`), `@tangent/repo` (git for `vault commit`). The package does not import browser code, Eval, Usage, Rollup, Search, or Threads.

The Reviewed build engine that used to live here was deleted in ADR-0023; pipelines replaced it.
