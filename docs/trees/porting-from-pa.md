# Porting From pa

Warning: The old pa repo is a behavioral reference and migration source. Do not copy its storage model or status side channels.

## Port

- entity tree concept
- worktree creation semantics
- tmux runtime concept
- command ergonomics
- MCP control idea
- checkpoint/capture vocabulary

## Do Not Port

- Go/Cobra structure
- `.state`, `.tokens`, `.label`
- `current_pulse.conf` or `pulses.jsonl` as canonical stores
- iTerm AppleScript as core
- daylog as planning model

Legacy files are read only by `tangent trees import-pa`.
