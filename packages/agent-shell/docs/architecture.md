# @tangent/agent-shell Architecture

The package owns Goals, Program definitions, Run records, step prompts, handoff validation, and `/api/work/*` routes.

Run records live in `~/.tangent/loops/reviewed-build/runs/`. Each attempt has an append-only process log. Repository files remain the canonical design, plan, review, response, and implementation artifacts.

One step can run at a time. The engine validates the completion object and each changed artifact before it starts the next step.

The package depends on these platform packages:
- `@tangent/agent-runtime` for provider processes and provider sessions.
- `@tangent/repo` for Git facts.
- `@tangent/ui-server` for route registration.
- `@tangent/agent-shell-ui` for browser assets.

The package does not import Eval, Usage, Rollup, Search, or Threads.
