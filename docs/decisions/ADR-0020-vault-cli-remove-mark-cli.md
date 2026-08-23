# ADR-0020: Add the vault CLI surface, remove `tangent mark`

Date: 2026-08-15

Status: accepted

## Context

The Tangent vault (`~/.tangent/trees`) had no CLI surface. Reading or changing an Area, Goal, or idea required either the Agent Shell UI or a hand-written HTTP call, and `packages/agent-shell/app/goal-command.mjs` existed only as a narrow, single-purpose script for in-session agents to create Goals.

Separately, `tangent mark` (`packages/eval/src/cli/commands/mark.ts` and friends) was the mark loop's capture CLI: bare-note capture, `--json` stdin capture (the `mark-agent-mistake` skill's entry point), `list`/`show`/`update`/`to-eval`/`scan`. Julian decided to remove this top-level command on 2026-08-15.

## Decision

Add a gh-style noun-verb vault CLI, registered as four top-level root commands (`tangent area`, `tangent goal`, `tangent idea`, `tangent vault`), implemented in `@tangent/agent-shell` and lazily loaded from `@tangent/agent-shell/cli` the same way `usage`/`eval`/`rollup`/`search`/`threads` are loaded from their own packages:

- `tangent area list|show`, `tangent goal create|list|show|done|wont-do`, `tangent idea add|list` are thin HTTP clients to the running Agent Shell server (`packages/agent-shell/app/server.mjs`), the vault's single writer. They mirror `goal-command.mjs`'s local-server contract: default `http://127.0.0.1:4321`, overridable via `--server`/`TANGENT_SHELL_URL`, loopback-only. Four new read-only GET endpoints (`/api/areas/show`, `/api/goals`, `/api/goals/show`, `/api/ideas`) were added to the server for the commands with no existing endpoint; they reuse the server's existing `readAreaGoals`/`areaNote`/`readTree` helpers rather than re-implementing vault-reading logic in the CLI.
- `tangent vault commit` is the one exception: it commits directly to `~/.tangent/trees` with `@tangent/repo`'s `git()`, mirroring the server's own `vaultCommit()` (message format, `Tangent-Area`/`Tangent-Tmux` trailers, pathspec-only commit, no staging).
- `@tangent/agent-shell` was chosen over a new package: it already owns Goal-bound Programs and vault reading (`src/vault.ts`), is already an optional root peer dependency, and the root CLI's lazy-import dispatch mechanism needed no new wiring beyond the four command entries.

Remove `tangent mark` entirely:

- Delete `packages/eval/src/cli/commands/mark.ts`, `mark-scan.ts`, `mark-to-eval.ts` (the CLI wrappers), the `markCommandSpec` export, `runMarkCli`, and the `mark` entry in the root `tangentCommandSpec`/`main()` dispatch and help text.
- Keep the internal mark modules: `packages/eval/src/marks/{types,store,resolve,scan,scan-candidates,scan-runner,to-eval}.ts`. `packages/eval/src/server/marks-routes.ts` already reads and updates marks directly for the Eval UI's marks inbox, independent of any CLI, so that surface is unaffected.

## Consequences

- Do not re-add a top-level `tangent mark` command. If mark capture needs a CLI again, design it fresh; do not resurrect the deleted files.
- The `mark-agent-mistake` skill (`skills/mark-agent-mistake/SKILL.md`, `.claude/skills/mark-agent-mistake/SKILL.md`) invokes `tangent mark --json`, `tangent mark show`, and `tangent mark to-eval` as its capture mechanism. This ADR did not update the skill; it is now broken until someone gives it a new capture path (e.g. calling into `@tangent/eval`'s marks store some other way) or the skill is retired. This is a known gap, not an oversight.
- `packages/eval/src/marks/scan.ts`'s `scanForSuggestedMarks` (the phase-3 sweep) and `marks/to-eval.ts`'s `runToEval` (mark-to-eval promotion) have no CLI front-end now. They remain as library functions for a future caller.
- Vault reads and writes from the CLI always go through the Agent Shell server (except `vault commit`); a CLI command run while the server is down fails with an actionable "Agent Shell is not running" error rather than reading vault files directly.
