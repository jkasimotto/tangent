# @tangent/agent-shell Docs

Purpose: the CLI surface of the Agent Shell, under the root `tangent` command:

- Vault CLI: `tangent area`, `tangent goal`, `tangent idea`, `tangent document`, `tangent vault commit`.
- Agent messaging CLI: `tangent agent list`, `tangent agent send`.
- Worker CLI: `tangent handover` reports facts to the controlling brain. Pipeline and continuation commands remain for legacy work.
- Brain CLI: `tangent brain request` creates durable user requests, and `tangent brain advance` starts the next approved assignment.
- Brain and server CLI: `tangent brain handover|status` (the Area brain's own lane; `status` ends with what Tangent shows Julian) and `tangent shell rebuild` (rebuild and restart the server, and wait for the new boot).
- Study partner CLI: `tangent study` (spawns an interactive `claude-otto` session carrying the partner contract) and `tangent study contract` (prints that contract).

The Agent Shell gateway in `packages/agent-shell/app/gateway.mjs` owns port 4321 and durable terminal transport. It supervises the controller in `server.mjs`, which owns Goals, pipelines, and session projection. See ADR-0032.

This package never runs an agent itself except through `tangent study`. That command starts a local interactive session directly (ADR-0026). All other operations use the server.

Read next:
- architecture.md
- public-api.md
