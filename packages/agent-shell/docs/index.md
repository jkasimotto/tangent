# @tangent/agent-shell Docs

Purpose: the CLI surface of the Agent Shell, under the root `tangent` command:

- Vault CLI: `tangent area`, `tangent goal`, `tangent idea`, `tangent document`, `tangent vault commit`.
- Agent messaging CLI: `tangent agent list`, `tangent agent send`.
- Worker CLI: `tangent handover` reports facts to the controlling brain. Pipeline and continuation commands remain for legacy work.
- Brain CLI: `tangent brain request` creates durable user requests, and `tangent brain advance` starts the next approved assignment.
- Brain and server CLI: `tangent brain handover|status` (the Area brain's own lane; `status` ends with what Tangent shows Julian) and `tangent shell rebuild` (rebuild and restart the server, and wait for the new boot).
- Study partner CLI: `tangent study` (spawns an interactive `claude-otto` session carrying the partner contract) and `tangent study contract` (prints that contract).

The Agent Shell server in `packages/agent-shell/app/` owns Goals, pipelines, and sessions. This package never runs an agent itself except through `tangent study`, which spawns a local interactive session directly (ADR-0026); everything else goes through the server, see ADR-0023.

Read next:
- architecture.md
- public-api.md
