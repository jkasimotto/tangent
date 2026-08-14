# @tangent/agent-shell Architecture

The package owns Goal loading, Program definitions, Run records, step prompts, and handoff validation.

Run records live in `~/.tangent/loops/reviewed-build/runs/`. Each attempt has an append-only process log.

Repository files are the canonical design, plan, review, response, and implementation artifacts. The engine validates each handoff before it starts the next step.

The package depends on two platform packages:

- `@tangent/agent-runtime` runs provider processes and provider sessions.
- `@tangent/repo` provides Git facts.

The native Agent Shell owns the HTTP bridge and browser interface in `prototypes/agent-shell/`. This package does not import browser code, Eval, Usage, Rollup, Search, or Threads.
