# Domain Model

Primary resources:

- `TreeEntity`: semantic path, explicit kind, optional project/worktree/branch.
- `WorkSession`: bounded human or agent work on an entity.
- `Checkpoint`: typed progress or transition inside a work session.
- `Capture`: structured scratch input replacing raw inbox items.
- `AgentRun`: provider/runtime-agnostic agent execution record.
- `TerminalSession`: durable runtime handle for tmux/process/pty.
- `TreeObservation`: observed fact with source, confidence, and evidence.
- `AttentionItem`: deterministic projection from observations/resources.
