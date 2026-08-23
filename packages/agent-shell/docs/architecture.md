# @tangent/agent-shell Architecture

The package is `src/cli/` and nothing else. The root `tangent` CLI lazily loads `@tangent/agent-shell/cli` for the `area`, `brain`, `goal`, `idea`, `document`, `vault`, `agent`, `shell`, and `study` nouns, the same way it loads `usage`, `eval`, `rollup`, and `search`.

- `src/cli/spec.ts`: the help specs (`areaCommandSpec`, `brainCommandSpec`, `goalCommandSpec`, `ideaCommandSpec`, `documentCommandSpec`, `agentCommandSpec`, `shellCommandSpec`, `studyCommandSpec`, `vaultCommandSpec`).
- `src/cli/client.ts`: the HTTP client. Loopback-only, default `http://127.0.0.1:4321`, overridable via `--server` or `TANGENT_SHELL_URL`. It also reads the current tmux session name, which is the agent's identity for ownership, messaging, and handover.
- `src/cli/commands/{area,goal,handover,brain,idea,document,agent}.ts`: thin HTTP clients to the Agent Shell server. Workers use one handover client. Brains create structured requests and explicitly advance approved assignments. The server stores pipelines and request records and enforces the caller's session role.
- `src/cli/commands/shell.ts`: `tangent shell rebuild`. It posts the server's own rebuild endpoint and then polls `GET /api/sessions` until the boot id changes, so a brain that writes a Test line knows the running server already answers with the new code (ADR-0025). `app/rebuild-operation.mjs` persists the rebuild target and lifecycle across the server restart. `app/rebuild-worker.mjs` builds in a detached process and stops the old server only after a successful build.
- `src/cli/commands/vault.ts`: the one command that shells out itself. `vault commit` uses `@tangent/repo`'s `git()` to commit directly to `~/.tangent/trees` with the same message shape and trailers as the server's `vaultCommit()`.
- `src/cli/commands/study.ts` and `study-contract.ts`: the second command that does not talk to the server. `tangent study` spawns a local interactive `claude` process with `stdio: "inherit"`, carrying the partner contract as an appended system prompt; the terminal belongs to that session until it exits (ADR-0026). No repo argument, no server involvement: scoping happens in the opening conversation, and the partner's own tool rights (read anywhere, edit and run only in a per-repo study worktree) come entirely from the contract text in `study-contract.ts`, not from code.

Dependencies: `@tangent/core` (arg parsing, help rendering), `@tangent/agent-runtime` (`runProcess` for `tmux display-message`), `@tangent/repo` (git for `vault commit`). The package does not import browser code, Eval, Usage, Rollup, Search, or Threads.

The Reviewed build engine that used to live here was deleted in ADR-0023; pipelines replaced it.
