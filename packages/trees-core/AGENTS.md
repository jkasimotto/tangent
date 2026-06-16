# @tangent/trees-core

Purpose: event-sourced Trees domain client and rebuildable projections.

Rules:
- Keep core free of React, SQLite, tmux implementation details, and old `pa` imports.
- All mutations must append `TreeEvent` records.

Read next:
- docs/index.md
