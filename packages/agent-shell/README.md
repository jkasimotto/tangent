# @tangent/agent-shell

The CLI and daily app surface of Tangent Agent Shell: Goal intent (`tangent goal`), durable execution (`tangent job`), Agent sessions (`tangent agent` and `tangent send`), Area organization (`tangent brain`), vault operations, and the browser app. Every command but `vault commit` is a thin HTTP client to `app/gateway.mjs` on port 4321. The gateway owns static assets, SSE, durable terminal transport, and the atomic Work snapshot while supervising the replaceable `app/server.mjs` workflow controller (ADR-0032, ADR-0055, ADR-0056).

See `docs/index.md`.
