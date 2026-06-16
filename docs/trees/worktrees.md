# Worktrees

Trees entities may attach to Git projects, branches, and worktree paths.

Tangent Center can create an entity and optionally ensure a worktree in one flow. If entity creation succeeds but Git setup fails, the entity remains and the UI reports a warning.

Worktree ensure behavior:

1. Resolve project registry and repo root.
2. Reuse existing branch worktree when present.
3. Create a local branch worktree when the branch exists.
4. Create from remote branch when available.
5. Create a new branch from `HEAD` otherwise.
