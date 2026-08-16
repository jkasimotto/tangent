# ADR-0018 Reviewed Build Program

Date: 2026-08-14

Status: superseded by ADR-0023 (agent pipelines replace Reviewed build; the engine was deleted).

## Decision

`@tangent/agent-shell` owns Goal-bound Programs and durable multi-agent Runs.

The first built-in Program is Reviewed build. It has eight ordered steps and ends after one implementation-review fix pass.

Fresh provider sessions are the default. A pending step can continue one compatible earlier session or use another agent binding.

The start action authorizes every listed step. It authorizes project documents, implementation changes, and repository checks.

The action does not authorize merge, deploy, publication, external messages, commits, Goal completion, or an extra review loop.

Run records live under `~/.tangent/loops/reviewed-build/`. Design, plan, review, response, and code artifacts remain in the project repository.

Each step returns a structured completion object. The engine checks required paths, changed content, proof, and review results before it continues.

`@tangent/agent-runtime` owns provider command adapters and provider session resume. Agent Shell does not import private Eval runners.

The native Agent Shell shows Reviewed build on each Goal. Its default action starts the Program without a setup form.

## Consequences

- A stopped or interrupted Run keeps completed steps and attempt logs.
- Retry creates a new attempt and keeps the earlier failure.
- A product question pauses the Run with its artifact links.
- Ordinary review changes continue to the planned response step.
- Pending agent, model, effort, and session choices can change during a Run.
- Governance enforces the new package edges.
