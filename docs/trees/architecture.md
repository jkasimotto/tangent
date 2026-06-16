# Trees Architecture

Trees follows this pipeline:

```txt
Observed facts -> immutable TreeEvents -> typed projections -> deterministic status -> deterministic attention -> UI/CLI/MCP actions
```

The event log is canonical. Resources are projections. Adapters write typed facts and never become the source of truth.

Core packages stay independent from React, SQLite, tmux implementation details, iTerm automation, and legacy `pa` code.
