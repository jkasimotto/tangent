# @tangent/repo Architecture

Repo discovery, git, worktree, and path helpers.

Rules:
- Shelling out to git belongs here.
- Keep app-specific output paths in app packages.

`GitOptions.signal` cancels Git child processes. `listGitWorktrees` parses `git worktree list --porcelain -z` without applying product policy.

Refer to ../../../docs/architecture/package-boundaries.md and ../../../docs/architecture/dependency-graph.md for monorepo boundaries.
