# @tangent/repo Public API

Public import paths:
- @tangent/repo
- @tangent/repo/discover
- @tangent/repo/git
- @tangent/repo/paths
- @tangent/repo/worktree

Agents must import through these public exports, not package src internals.

`@tangent/repo/git` exports `git`, `gitText`, and `gitRaw`. Their `GitOptions` type accepts an optional `AbortSignal`.

`@tangent/repo/worktree` exports these read-only worktree APIs:

- `parseGitWorktreesPorcelain(output)` parses NUL-delimited Git records.
- `listGitWorktrees(repository, { signal })` returns branch, detached, bare, locked, and prunable facts.

The caller owns Area policy, discovery limits, and candidate filtering.
