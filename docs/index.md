# Tangent Docs

Start here when changing architecture, package boundaries, or agent workflow.

Human CLI defaults are `setup`, `status`, `usage`, `rollup`, `search`, `eval`, `doctor`, and `completion`.
Raw/debug/CI surfaces such as `governance`, `data export`, and `data archive` stay callable but hidden from default help.

Architecture:
- architecture/package-boundaries.md
- architecture/dependency-graph.md
- architecture/layering.md
- architecture/hooks.md
- architecture/agent-runtime.md

Decisions:
- decisions/ADR-0001-agent-legibility.md
- decisions/ADR-0002-hooks-package-boundary.md
- decisions/ADR-0003-shared-runtime-and-repo-packages.md
- decisions/ADR-0004-retire-hook-capture.md

Agent workflow:
- agent/coding-rules.md
- agent/review-rules.md
- agent/validation.md
- agent/doc-gardening.md

Quality:
- quality/scorecard.md
- quality/tech-debt.md

Package docs live at packages/<pkg>/docs/index.md.
