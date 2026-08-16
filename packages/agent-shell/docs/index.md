# @tangent/agent-shell Docs

Purpose: the CLI surface of the Agent Shell. Three lanes, all under the root `tangent` command:

- Vault CLI: `tangent area`, `tangent goal`, `tangent idea`, `tangent vault commit`.
- Agent messaging CLI: `tangent agent list`, `tangent agent send`.
- Pipeline CLI: `tangent goal start` (one agent or a list of steps on a Goal) and `tangent goal handover` (a step agent hands facts to the next step).

The Agent Shell server in `prototypes/agent-shell/` owns Goals, pipelines, and sessions. This package never runs an agent itself; see ADR-0023.

Read next:
- architecture.md
- public-api.md
