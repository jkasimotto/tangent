# ADR-0003: Shared Runtime And Repo Packages

Status: accepted

Decision: Repo discovery/git/worktree helpers live in @tangent/repo. Process execution lives in @tangent/agent-runtime. CLI arg parsing lives in @tangent/core/cli.

Why: Rollup, Eval, Search, and Usage had similar helpers that agents would otherwise copy and drift.

Consequences:
- Vertical apps may keep app-specific output path modules.
- Vertical apps must import shared parser, process, and repo helpers from platform packages.
- Governance lints fail when local copies reappear.
