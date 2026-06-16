# Security

Trees controls local terminals and agents, so treat it as privileged local automation.

- UI binds `127.0.0.1` by default.
- UI API uses a random session token.
- External bind prints a warning.
- MCP requires explicit startup.
- Dangerous MCP tools are capability-gated.
- Terminal send, agent start/kill, and destructive actions emit events.
