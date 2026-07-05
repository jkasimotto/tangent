# Agent Notes

Purpose: @tangent/usage-core core/insights/generators source area. The four v1 deterministic finding generators (info-finding-heavy sessions, recurring long commands, re-read churn and hot files, failure/retry loops).

Local rules: One generator per file, each a pure function over `NormalizedConversation[]` returning `Finding[]`. Follow the nearest parent AGENTS.md and the package docs.

Read next:
- ../AGENTS.md
- ../../../../docs/index.md
