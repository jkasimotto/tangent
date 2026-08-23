# ADR-0023: Agent pipelines replace Reviewed build

Date: 2026-08-15

Status: accepted. Supersedes ADR-0018.

## Context

Reviewed build (ADR-0018) was a fixed eight-step Program run by an engine in `@tangent/agent-shell` through `--print` provider sessions, with Run records under `~/.tangent/loops/reviewed-build/`. It never ran for real. Its conversations were hidden behind the engine, so Julian could not open a step and talk to the agent. Its step contract was a must-list of required paths and completion objects, the prompt shape ADR-0022 already rejected. Meanwhile Julian was the message bus between agents: he opened each session, picked the model, re-typed the coordination prompt, and pointed the new agent at the last agent's files.

The design (`~/.tangent/trees/otto/tangent/design-agent-pipelines.md`, solution `design-agent-pipelines-solution.md`) set the yardstick: Julian types the steps in his words, every step is a real open conversation, fresh context by default with facts on the wire, one way to start work, the line advances itself, and nothing needs a live harness to test.

## Decision

- A pipeline is a list of steps on one Goal. Each step is `{ launch: { harness, model, effort }, instruction, continueFrom }`. The server (`packages/agent-shell/app/server.mjs`) starts each step through the existing `spawnGoalSession` path: the same tmux session, priming, and first message as a plain Goal session, plus a `## Your step` section and every earlier handover verbatim. No `--print` runs remain in Agent Shell.
- A step ends when its agent runs `tangent goal handover "<facts>"`. The server records the facts on the step and starts the next one. The desk offers Restart, Skip, and Send to next as fallbacks.
- One JSON record per Goal under `~/.tangent/agent-shell/pipelines/<area>/<slug>.json` (schema `agent-pipeline.v1`), plus tmux options `@tangent_pipeline` and `@tangent_step` on each step session. Goal ownership stays in the Goal file `session:` and moves to each step's session.
- Effort becomes a third axis of the harness registry (`~/.tangent/trees/harnesses.md`, `effortSets`); the composed command is harness + model + effort.
- Pipelines are composed in the launch popover on the desk (Goal row and multi-select bar) or with `tangent goal start <slug> --step ... --launch ... --continue-from ...`, which posts to the same `POST /api/goals/start` endpoint as a single start. No saved pipelines.
- Design documents live in the vault Area folder as `design-<slug>.md` (solution beside it as `design-<slug>-solution.md`) with a `[[goal-<slug>]]` link. The `/design` and `/design-solution` skills lose their fixed repository location; the caller's instructions name the location, and the Goal prompt does so for Tangent work. This is a machine change to `~/.claude-otto/skills/` and `~/.claude/skills/`, not a repository change.
- `@tangent/agent-shell` keeps only the CLI: vault, agent messaging, and pipeline (`goal start`, `goal handover`).

## Consequences

- The Reviewed build engine, its HTTP bridge, and its UI surfaces are deleted: `packages/agent-shell/src/{engine,program,prompt,attempt,repository,store,types,vault}.ts`, `packages/agent-shell/app/reviewed-build.mjs`, and the matching views, tests, and CSS.
- `~/.tangent/loops/reviewed-build/` is unused. Nothing reads or writes it.
- ADR-0018 is superseded. The three vault Goals about Reviewed build change status only on Julian's word.
- `~/.agents/AGENTS.md` gains one bullet telling a step agent to finish with `tangent goal handover`.
- Every step is testable without a harness: the HTTP tests create real tmux sessions with `AGENT_SHELL_TEST_NO_LAUNCH=1` and never launch a provider.
