# Agent Notes

Purpose: the CLI surface of the Agent Shell: vault CLI (`tangent area`, `tangent goal`, `tangent idea`, `tangent vault`), agent messaging CLI (`tangent agent`, `tangent send`), pipeline CLI (`tangent goal start`, `tangent goal append`), and the study partner launcher (`tangent study`). All in `src/cli/`. `tangent help` groups the commands as Brains, Workers, and Julian; keep it accurate.

Local rules:
- Every command but `vault commit` and `study` is a thin HTTP client to the Agent Shell server; it must never read or write vault files directly, and never spawn an agent. `vault commit` writes the vault's git history, and `study` spawns a local interactive session (ADR-0026).
- Goal execution is owned by one server-side `area-goal-queue.v2` record. Workers report through `tangent send brain`. A worker report never starts the next assignment and never closes a Goal (ADR-0041).
- Area paths organize records and inboxes; they do not grant command permission. Brains, workers, the browser, and local shells can act directly on work in any Area. Preserve revision, idempotency, live-owner, exact-attempt, and immutable tmux fences (ADR-0034).
- `goal done` and `goal wont-do` run on the user's word or by the brain after it read a worker's done note. A Goal the user flagged `verify: yes` becomes `verify` (Check it) on a brain's done and waits for him (ADR-0041).
- Brain lifecycle is `active` or `inactive`. A brain runs until the user restarts it: no handover, no pacing, no generated prompt. Its Area folder's AGENTS.md chain is its instruction (ADR-0041).
- Keep the package free of browser code and of Eval, Usage, Rollup, Search, and Threads imports.

Read next:
- docs/index.md
- docs/architecture.md
- docs/public-api.md
