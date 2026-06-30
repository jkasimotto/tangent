# launcher/src/drivers

Purpose: Per-terminal driver implementations. Each driver opens a terminal session running a given command in a given directory.

Local rules:
- Drivers must not block the caller; use detached spawns or fire-and-forget.
- Each driver file implements one terminal type only.

Read next:
- ../../docs/index.md
- ../../docs/architecture.md
