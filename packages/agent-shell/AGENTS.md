# Agent Notes

Purpose: the CLI surface of the Agent Shell: vault CLI (`tangent area`, `tangent goal`, `tangent idea`, `tangent vault`), agent messaging CLI (`tangent agent`), pipeline CLI (`tangent goal start`, `tangent goal handover`), and the study partner launcher (`tangent study`). All in `src/cli/`.

Local rules:
- Every command but `vault commit` and `study` is a thin HTTP client to the Agent Shell server; it must never read or write vault files directly, and never spawn an agent. `vault commit` writes the vault's git history, and `study` spawns a local interactive session (ADR-0026).
- Goal execution is owned by one server-side `area-goal-queue.v2` record. Workers report through top-level `tangent handover` with a tagged report. A worker report never starts the next assignment.
- A live brain can mutate only its exact Area. Parent and sibling brains can route information, but they cannot create, start, advance, or close work in another Area.
- `goal done` and `goal wont-do` run only on the user's explicit word. The queue controller can also close routine work after the designated final review reports a typed pass for the current Goal revision. Free text and legacy Test prose never close new queue work (ADR-0034).
- Brain lifecycle is `active` or `inactive`. Process, attempt, waiting, and recovery states are diagnostic health details.
- Keep the package free of browser code and of Eval, Usage, Rollup, Search, and Threads imports.

Read next:
- docs/index.md
- docs/architecture.md
- docs/public-api.md
