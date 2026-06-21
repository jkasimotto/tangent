# @tangent/agent-runtime Public API

Public import paths:
- @tangent/agent-runtime
- @tangent/agent-runtime/process
- @tangent/agent-runtime/notify

`@tangent/agent-runtime/process` exports `runProcess`, process failure helpers, and process output/abort primitives. `runProcess` accepts optional `onOutput` and `signal` fields so callers can stream stdout/stderr chunks and abort long-running child processes without adding provider-specific behavior to this package.

`@tangent/agent-runtime/notify` exports `notify` and `loadNotifyConfig` for OS-agnostic desktop notifications. The driver is `auto` (osascript on macOS, notify-send on Linux), `none`, or a custom shell template with `{title}`/`{body}` tokens, mirroring the launcher's custom terminal driver. `notify` is fire-and-forget and never throws so a failed ping cannot break its caller. Config lives at `~/.tangent/notify/config.json`.

Agents must import through these public exports, not package src internals.
