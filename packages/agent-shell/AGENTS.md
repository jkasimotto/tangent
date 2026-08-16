# Agent Notes

Purpose: the CLI surface of the Agent Shell: vault CLI (`tangent area`, `tangent goal`, `tangent idea`, `tangent vault`), agent messaging CLI (`tangent agent`), and pipeline CLI (`tangent goal start`, `tangent goal handover`). All in `src/cli/`.

Local rules:
- Every command but `vault commit` is a thin HTTP client to the Agent Shell server; it must never read or write vault files directly, and never spawn an agent. Only `vault commit` shells out to git itself.
- Pipelines are owned by the server (`prototypes/agent-shell/`). This package only posts to `/api/goals/start` and `/api/goals/handover`.
- `goal done`/`goal wont-do` run only on the user's explicit word; do not add any other path that flips Goal status.
- Keep the package free of browser code and of Eval, Usage, Rollup, Search, and Threads imports.

Read next:
- docs/index.md
- docs/architecture.md
- docs/public-api.md
