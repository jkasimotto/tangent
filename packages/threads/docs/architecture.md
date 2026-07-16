# @tangent/threads Architecture

Delegated-thread sweep, registry, and attach.

Rules:
- Do not depend on Usage (full package), Rollup, or Eval. Only @tangent/usage-index-sqlite for session telemetry (the vertical-dependency rule extends from "rollup/eval -> usage" to "rollup/eval/threads -> usage").
- Reach the vault by path convention only (same as the tangent skill), never as a code dependency.
- Use @tangent/repo for path helpers (worktree path normalization) and @tangent/agent-runtime for process execution (the haiku runner, terminal-notifier).

Pipeline (src/core/sweep.ts):
1. `scanVault` (src/core/vault-scan.ts) walks the vault once: `thread-*.md` files (excluding `shared/`), `overview.md` "## On me" backlog items, and per-node note recency from `YYYY-MM-DD-*.md` filenames. Parsing itself (src/core/thread-parser.ts, src/core/overview-parser.ts) is pure; only the file walk is IO.
2. For each thread with a sidecar registry entry, `SessionStateReader` (src/core/types.ts) resolves live session telemetry. It is a narrow injectable interface so the pure derivation logic and its tests never touch the Usage SQLite index directly. The default implementation (src/core/sqlite-session-state.ts) queries `@tangent/usage-index-sqlite`'s `openUsageFromSqlite({ scope: "all" })`. A registry entry with no session id yet (dispatch cannot always observe it) is resolved by matching the most recently active session whose cwd/repo fields equal the registered worktree path; the resolved id is persisted back into the registry so later sweeps query by id directly.
3. `deriveThreadStates` (src/core/derive.ts) is a pure function implementing the design spec's state table exactly (working / blocked-on-you / ready-for-you / needs-you / parked / done), given already-resolved facts and session state. No model involvement.
4. `WhyLineRunner` (src/core/haiku.ts) asks a cheap model (haiku by default) for why-lines and check-in drafts, given the already-derived states as input; it cannot change a state, and any runner failure (missing binary, timeout, bad JSON) falls back to templated why-lines built from owner/deadline/cadence facts during derivation. Output is filtered to known slugs only before use.
5. `renderThreadsMarkdown` (src/core/render.ts) renders `threads.md`; `sidecar.ts` computes fresh counts and the notification-dedup transition and writes the sidecar. Both outputs are written atomically (tmp file + rename, src/core/atomic-write.ts) only after every prior step succeeds, so a scan or derivation error leaves both files untouched.
6. Notifications fire only for threads newly entering blocked-on-you or needs-you since the previous sweep (deduped via the sidecar's `notified` map); threads leaving those states are cleared so re-entering notifies again.

Refer to ../../../docs/architecture/package-boundaries.md and ../../../docs/architecture/dependency-graph.md for monorepo boundaries.
