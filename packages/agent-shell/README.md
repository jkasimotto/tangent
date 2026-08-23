# @tangent/agent-shell

The CLI and daily app surface of Tangent Agent Shell: the vault CLI (`tangent area`, `tangent goal`, `tangent idea`, `tangent vault commit`), agent messaging (`tangent agent list|send`), pipelines, Area brains, and the browser app. Every command but `vault commit` is a thin HTTP client to the running server (`app/server.mjs`, port 4321). The server composes capability route tables, the vault repository, execution records, scheduling, desk projection, static assets, and terminal transport.

See `docs/index.md`.
