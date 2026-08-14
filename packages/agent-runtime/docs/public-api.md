# @tangent/agent-runtime Public API

Public import paths:
- @tangent/agent-runtime
- @tangent/agent-runtime/process
- @tangent/agent-runtime/notify
- @tangent/agent-runtime/agent

`@tangent/agent-runtime/process` exports `runProcess`, process failure helpers, and process output/abort primitives. `runProcess` accepts optional `onOutput` and `signal` fields so callers can stream stdout/stderr chunks and abort long-running child processes without adding provider-specific behavior to this package.

`@tangent/agent-runtime/notify` exports `notify` and `loadNotifyConfig` for OS-agnostic desktop notifications. The driver can be `auto`, `none`, or a custom shell template. The automatic driver uses osascript on macOS and notify-send on Linux. A custom template uses the `{title}` and `{body}` tokens. `notify` never throws, so a failed notification cannot break its caller. `loadNotifyConfig` reads `~/.tangent/notify/config.json` and supports `TANGENT_HOME`. It returns the driver, poll interval, and enabled events. It merges partial values over the defaults.

`@tangent/agent-runtime/agent` exports `runAgentCli`. The input selects Claude, Codex, or Gemini and can request a fresh or resumed provider session. It accepts an output schema, streams output and provider events, and returns the final text, structured output, and provider session identifier. Gemini rejects session resume before it starts.

Agents must import through these public exports, not package src internals.
