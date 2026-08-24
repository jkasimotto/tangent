# @tangent/agent-shell

The CLI and daily app surface of Tangent Agent Shell: the vault CLI (`tangent area`, `tangent goal`, `tangent idea`, `tangent vault commit`), agent messaging (`tangent agent list|send`), pipelines, Area brains, and the browser app. Every command but `vault commit` is a thin HTTP client to `app/gateway.mjs` on port 4321. The gateway owns static assets, SSE, and durable terminal transport while supervising the replaceable `app/server.mjs` workflow controller (ADR-0032).

See `docs/index.md`.
