# Worktrees

Trees entities may attach to Git projects, branches, and worktree paths.

Worktree ensure behavior:

1. Resolve project registry and repo root.
2. Reuse existing branch worktree when present.
3. Create a local branch worktree when the branch exists.
4. Create from remote branch when available.
5. Create a new branch from `HEAD` otherwise.
