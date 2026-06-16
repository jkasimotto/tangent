# Event Model

All writes go through `TreeEvent`.

Events are append-only and resources are rebuildable projections. Mutating CLI and MCP actions emit events, including terminal sends, agent starts/stops, captures, checkpoints, and attention transitions.

The filesystem event log under `~/.tangent/trees/events` is canonical in V1. Snapshots are caches.
