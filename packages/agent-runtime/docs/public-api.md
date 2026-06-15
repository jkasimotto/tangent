# @tangent/agent-runtime Public API

Public import paths:
- @tangent/agent-runtime
- @tangent/agent-runtime/process

`@tangent/agent-runtime/process` exports `runProcess`, process failure helpers, and process output/abort primitives. `runProcess` accepts optional `onOutput` and `signal` fields so callers can stream stdout/stderr chunks and abort long-running child processes without adding provider-specific behavior to this package.

Agents must import through these public exports, not package src internals.
