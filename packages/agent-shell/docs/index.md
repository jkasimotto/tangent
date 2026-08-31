# @tangent/agent-shell Docs

Purpose: the CLI surface of the Agent Shell, under the root `tangent` command:

- Vault CLI: `tangent area`, `tangent goal`, `tangent document`, `tangent vault commit`.
- Agent CLI: `tangent agent list|show|stop|resume|send` joins exact live sessions to durable Job Attempts or Brain generations. Root `tangent send` remains the Area-aware convenience route.
- Worker CLI: every assignment names its organizing brain's durable Area path. Its only command is `tangent send <brain-area> "<plain note>"`. A note never changes Goal or assignment state. `tangent area recent` queries subtree milestones. `tangent area audit` exports legacy records.
- Brain CLI: `tangent brain request` creates durable user requests, and `tangent brain advance` starts the next approved assignment.
- Job CLI: `tangent job create|show|start|append|advance|stop|replace` owns numbered execution runs, Assignments, Attempts, reports, and recovery receipts. Goal commands own intent only.
- Brain and server CLI: `tangent brain status|stop|request|withdraw|succeed` owns exact-Area organization. Safe succession stages the next generation without authority until exact transcript receipt, then retires the outgoing immutable target (ADR-0055). `tangent goal create --start --path <dir>` is the Brain's composite Goal-plus-Job operation. `tangent shell rebuild` rebuilds and restarts the server.
- Study partner CLI: `tangent study` (spawns an interactive `claude-otto` session carrying the partner contract) and `tangent study contract` (prints that contract).

The Agent Shell gateway in `packages/agent-shell/app/gateway.mjs` owns port 4321 and durable terminal transport. It supervises the controller in `server.mjs`. Both processes share one runtime identity. They can use only tmux sessions marked with that identity. The controller owns Brains, inboxes, Goal intent projection, `job.v1` history, Agent Attempts, Requests, lifecycle events, invariant Problems, and Work v2. See ADR-0032, ADR-0036, and ADR-0055.

Any replacement harness can recover the current assignment from the tmux session name. The context projection does not claim or mutate the session. A live unbound session reports `unassigned`. A worker that exits to its still-live shell leaves its queue status and tmux session intact and creates one durable exact-Area brain notice.

Agent Shell centers each Area on one logical brain with an active or inactive lifecycle. Exact Area identity selects records and inboxes, not command permission. Area messages enter the durable inbox before live delivery.

Work shows all open Goals in one projection. An explicit keyboard context owns each key. Terminal sessions keep native tmux input, except the visible leave shortcut. Work and Document actions expose matching keyboard and pointer paths. See ADR-0038.

Each Area can have one `.excalidraw` source shard. One browser world shows the complete Area hierarchy and keeps every structural region interactive. A shared layout kernel expands ancestors and reflows affected sibling branches. Vault notes remain authoritative for Tangent block facts. One gesture commits all affected shards together. See ADR-0049, ADR-0051, and ADR-0052.

An agent can present a Markdown Document on its Goal. An exact Area brain can also use `tangent area present <area> <file>...` to present an Area Document without a Goal. Work shows each presentation under its owner until Julian dismisses it. The runtime records do not change a Document, Goal queue, or Goal relation.

Generic `tangent send` messages persist before pane wake or presentation. The controller restores them after a restart and keeps their exact target order. See ADR-0039.

Worker questions are queue control events. The exact Area brain answer resolves the stored question before the worker receives it through the wait and acknowledgement channel. Replacement and rebuilt prompts use the same stored answer. See ADR-0050.

The brain receives its founding instruction, current checkpoint, bounded Area memory, selected current Document references, Questions, and material Operation events. Structural Area and repository paths define inherited context.

This package never runs an agent itself except through `tangent study`. That command starts a local interactive session directly (ADR-0026). All other operations use the server.

Read next:
- architecture.md
- public-api.md
- runtime-operations.md
