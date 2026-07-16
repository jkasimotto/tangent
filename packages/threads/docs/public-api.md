# @tangent/threads Public API

Public import paths:
- @tangent/threads
- @tangent/threads/cli

Agents must import through these public exports, not package src internals.

Human CLI:
- `tangent threads ...` is the root full-suite command.
- `tangent-threads ...` is the standalone package binary and accepts the same arguments without the root `threads` subcommand.

SDK (`@tangent/threads`):
- `sweep(options?: SweepOptions): Promise<SweepResult>` runs one sweep: scan, derive, haiku (best-effort), render, write, notify. `options.dryRun` skips writing and notifying. `options.sessionStateReader`, `options.whyLineRunner`, and `options.notifier` are injectable for tests and for swapping the default SQLite-backed / claude-cli-backed / terminal-notifier-backed implementations.
- `listThreads(options?): Promise<ListThreadsResult>` reads the last-generated `threads.md` and sidecar without running a sweep.
- `registerThread(options: RegisterThreadOptions): Promise<RegistryEntry>` upserts a dispatched thread's worktree/tmux/session linkage into the sidecar registry. `sessionId` is optional: dispatch cannot always observe a Claude session id at register time, and the next sweep resolves it by matching the worktree's cwd against recent Usage sessions.
- `attachCommand(options: AttachOptions): Promise<string>` resolves the tmux attach command for a registered thread.
- `deriveThreadStates(inputs, now)` (src/core/derive.ts, also exported) is the pure state-derivation function; safe to unit test without any IO.
- `SessionStateReader`, `WhyLineRunner`, and `Notifier` are the three injectable interfaces; `SqliteSessionStateReader`, `ClaudeCliWhyLineRunner`, and `TerminalNotifier` are their default implementations, all exported for composition.
