# Agent Notes

Purpose: @tangent/threads core source area (vault scanning, pure state derivation, sidecar, render, haiku, sweep orchestration).

Local rules:
- `derive.ts` must stay pure and synchronous: no filesystem, no network, no process calls. All IO (vault walk, session telemetry, model calls, notifications) happens in sweep.ts or the injectable reader/runner/notifier implementations, and is passed into derive.ts as plain data.
- Files are written only via atomic-write.ts (tmp file + rename), never with a direct writeFile to the final path.

Read next:
- ../../docs/index.md
- ../../docs/architecture.md
- ../../docs/public-api.md
