# @tangent/agent-shell

The CLI surface of the Tangent Agent Shell: the vault CLI (`tangent area`, `tangent goal`, `tangent idea`, `tangent vault commit`), the agent messaging CLI (`tangent agent list|send`), and the pipeline CLI (`tangent goal start`, `tangent goal handover`). Every command but `vault commit` is a thin HTTP client to the running Agent Shell server (`packages/agent-shell/app/server.mjs`, port 4321), which owns the vault and the pipelines.

See `docs/index.md`.
