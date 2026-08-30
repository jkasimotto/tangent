# @tangent/agent-shell Docs

Purpose: the CLI surface of the Agent Shell, under the root `tangent` command:

- Vault CLI: `tangent area`, `tangent goal`, `tangent idea`, `tangent document`, `tangent vault commit`.
- Agent CLI: `tangent agent list`, `tangent send`, and read-only `tangent agent context` recovery from durable brain and Goal records.
- Worker CLI: every assignment names its organizing brain's durable Area path. Its only command is `tangent send <brain-area> "<plain note>"`. A note never changes Goal or assignment state. `tangent area recent` queries subtree milestones. `tangent area audit` exports legacy records.
- Brain CLI: `tangent brain request` creates durable user requests, and `tangent brain advance` starts the next approved assignment.
- Brain and server CLI: `tangent brain status|stop|request|withdraw` reads or stops a brain and files its questions through guarded Agent Shell routes. A brain runs until Julian restarts it; there is no handover (ADR-0041). `tangent goal create --start --path <dir>` is the brain's one command to create a Goal and start its worker. `tangent shell rebuild` rebuilds and restarts the server.
- Study partner CLI: `tangent study` (spawns an interactive `claude-otto` session carrying the partner contract) and `tangent study contract` (prints that contract).

The Agent Shell gateway in `packages/agent-shell/app/gateway.mjs` owns port 4321 and durable terminal transport. It supervises the controller in `server.mjs`. Both processes share one runtime identity. They can use only tmux sessions marked with that identity. The controller owns logical Area brains, durable Area inboxes, Goal queues, Requests, Operation events, and session projection. See ADR-0032, ADR-0034, and ADR-0036.

Any replacement harness can recover the current assignment from the tmux session name. The context projection does not claim or mutate the session. A live unbound session reports `unassigned`. A worker that exits to its still-live shell leaves its queue status and tmux session intact and creates one durable exact-Area brain notice.

Agent Shell centers each Area on one logical brain with an active or inactive lifecycle. Exact Area identity selects records and inboxes, not command permission. The Area Journal saves unstructured text before brain delivery.

Work shows all open Goals in one projection. An explicit keyboard context owns each key. Terminal sessions keep native tmux input, except the visible leave shortcut. Work and Document actions expose matching keyboard and pointer paths. See ADR-0038.

Each Area can have one `.excalidraw` source shard. One browser world shows the complete Area hierarchy and keeps every structural region interactive. Vault notes remain authoritative for Tangent block facts. One gesture commits all affected shards together. See ADR-0049 and ADR-0051.

An agent can present a Markdown document on its Goal. Work shows the human title until Julian opens or dismisses the document. The runtime record does not change the document or the Goal queue.

Generic `tangent send` messages persist before pane wake or presentation. The controller restores them after a restart and keeps their exact target order. See ADR-0039.

Worker questions are queue control events. The exact Area brain answer resolves the stored question before the worker receives it through the wait and acknowledgement channel. Replacement and rebuilt prompts use the same stored answer. See ADR-0050.

The brain receives its founding instruction, current checkpoint, bounded Area memory, selected current Document references, Questions, and material Operation events. Structural Area and repository paths define inherited context.

This package never runs an agent itself except through `tangent study`. That command starts a local interactive session directly (ADR-0026). All other operations use the server.

Read next:
- architecture.md
- public-api.md
- runtime-operations.md
