# @tangent/threads Public API

Public import paths:
- @tangent/threads
- @tangent/threads/cli

Agents must import through these public exports, not package src internals.

Human CLI:
- `tangent threads ...` is the root full-suite command.
- `tangent-threads ...` is the standalone package binary and accepts the same arguments without the root `threads` subcommand.

SDK (`@tangent/threads`):
- `sweep(options?: SweepOptions): Promise<SweepResult>` runs one sweep: scan, derive, haiku (best-effort), render, write, notify, and update each shared node's state-of-play. `options.dryRun` skips writing, notifying, and the state-of-play update. `options.sessionStateReader`, `options.whyLineRunner`, `options.notifier`, `options.gitProbe`, and `options.sharedWriter` are injectable for tests and for swapping the default SQLite-backed / claude-cli-backed / terminal-notifier-backed / git-backed implementations. Each thread's optional `Wake on`/`Wake when` body line and any `Batch: <name>` body line are parsed and applied automatically; there is no separate SDK entry point for either.
- `listThreads(options?): Promise<ListThreadsResult>` reads the last-generated `threads.md` and sidecar without running a sweep.
- `registerThread(options: RegisterThreadOptions): Promise<RegistryEntry>` upserts a dispatched thread's worktree/tmux/session linkage into the sidecar registry. `sessionId` is optional: dispatch cannot always observe a Claude session id at register time, and the next sweep resolves it by matching the worktree's cwd against recent Usage sessions.
- `attachCommand(options: AttachOptions): Promise<string>` resolves the tmux attach command for a registered thread.
- `deriveThreadStates(inputs, now)` (src/core/derive.ts, also exported) is the pure state-derivation function; safe to unit test without any IO.
- `renderStateOfPlaySection(threads, whyLines, now)` (src/core/state-of-play.ts, also exported) renders the "Delegated threads" section a sweep splices into a shared node's `state-of-play.md`; `updateSharedStateOfPlay(nodeDir, section)` performs that splice, conservatively refusing to write when the file's begin/end marker state is ambiguous. `sweep` calls both automatically for every node with a `shared/` directory; they are exported so a caller can preview or regenerate a node's section independently.
- `SessionStateReader`, `WhyLineRunner`, and `Notifier` are the three injectable interfaces; `SqliteSessionStateReader`, `ClaudeCliWhyLineRunner`, and `TerminalNotifier` are their default implementations, all exported for composition.
- `runRecurDue(options: RunRecurDueDeps): Promise<RunRecurDueResult>` scans the vault for `recur-<slug>.md` definitions, filters them to the ones currently due against the sidecar's recorded `lastRunAt`, and (unless `options.dryRun`) dispatches each due definition. `options.launcher`, `vaultRoot`, `sidecarPath`, and `now` are all injectable, so tests never touch tmux, the real vault, or the real clock. Backs `tangent threads recur due`.
- `runRecur(def: RecurDef, deps: RunRecurDeps): Promise<void>`, `scanRecurFiles(vaultRoot): Promise<RecurDef[]>`, and `TmuxWorkerLauncher` (the default `WorkerLauncher`, starting a detached tmux session) are also exported for composing recur behavior, e.g. `tangent threads recur run <slug>` runs one definition regardless of due-ness.
