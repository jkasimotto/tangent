# @tangent/trees-runtime Public API

Import runtime modules from explicit subpaths:

- `@tangent/trees-runtime/fs`
- `@tangent/trees-runtime/sqlite`
- `@tangent/trees-runtime/git`
- `@tangent/trees-runtime/terminal`
- `@tangent/trees-runtime/agents`
- `@tangent/trees-runtime/attention`
- `@tangent/trees-runtime/notify`

`@tangent/trees-runtime/notify` exports `watchAgentRunNotifications`, a per-run watcher that polls a started agent's terminal pane and fires an OS notification (via `@tangent/agent-runtime/notify`) when the agent finishes or needs input, then exits. It is spawned detached by `trees agent start`. Config is read with `loadNotifyConfig` from `~/.tangent/notify/config.json`.
