# Trees Architecture

Trees follows this pipeline:

```txt
Observed facts -> immutable TreeEvents -> typed projections -> deterministic status -> deterministic attention -> CLI/MCP actions
```

The event log is canonical. Resources are projections. Adapters write typed facts and never become the source of truth.

Core packages stay independent from UI frameworks, SQLite, tmux implementation details, iTerm automation, and legacy `pa` code.

Tangent Center currently exposes CLI and MCP actions. The old browser command-center UI/server is retired for now.
