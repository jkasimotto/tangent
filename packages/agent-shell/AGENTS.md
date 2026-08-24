# Agent Notes

Purpose: the CLI surface of the Agent Shell: vault CLI (`tangent area`, `tangent goal`, `tangent idea`, `tangent vault`), agent messaging CLI (`tangent agent`), pipeline CLI (`tangent goal start`, `tangent goal handover`), and the study partner launcher (`tangent study`). All in `src/cli/`.

Local rules:
- Every command but `vault commit` and `study` is a thin HTTP client to the Agent Shell server; it must never read or write vault files directly, and never spawn an agent. `vault commit` writes the vault's git history, and `study` spawns a local interactive session (ADR-0026).
- Pipelines are owned by the server (`packages/agent-shell/app/`). Workers report through top-level `tangent handover`. A brain-controlled handover never advances by itself; the brain starts the next assignment.
- `goal done`/`goal wont-do` run only on the user's explicit word. A passing brain review creates a Test request. The Goal becomes done only when Julian accepts that Test (ADR-0024); do not add any other path that flips Goal status.
- Keep the package free of browser code and of Eval, Usage, Rollup, Search, and Threads imports.

Read next:
- docs/index.md
- docs/architecture.md
- docs/public-api.md
