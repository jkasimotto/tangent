# Tangent Docs

Start here when changing architecture, package boundaries, or agent workflow.

Agent Shell is the daily product for work with coding agents. Its current local implementation lives in `packages/agent-shell/app/`. A live Area brain controls managed work in its subtree. Julian approves the brain's Goal and worker plan before agent-originated execution starts. Workers report through one handover route, and the brain owns later transitions and requests. See ADR-0029.

Human CLI defaults are `setup`, `status`, `process`, `usage`, `rollup`, `search`, `eval`, `mark`, `doctor`, and `completion`.
`tangent process` runs configured processes from inherited, ignored `.processes.json` files in Tangent Areas. Managed processes use Area-bound tmux sessions so they remain visible and inspectable in the hierarchy.
Raw/debug/CI surfaces such as `governance`, `data export`, and `data archive` stay callable but hidden from default help.

Architecture:
- architecture/package-boundaries.md
- architecture/dependency-graph.md
- architecture/layering.md
- architecture/hooks.md
- architecture/agent-runtime.md
- ui/README.md

Decisions:
- decisions/ADR-0001-agent-legibility.md
- decisions/ADR-0002-hooks-package-boundary.md
- decisions/ADR-0003-shared-runtime-and-repo-packages.md
- decisions/ADR-0004-retire-hook-capture.md
- decisions/ADR-0005-usage-v2-telemetry-kernel.md
- decisions/ADR-0015-marks-in-eval.md
- decisions/ADR-0016-threads-vertical-app.md
- decisions/ADR-0017-agent-shell-daily-product.md
- decisions/ADR-0018-reviewed-build-program.md (superseded by ADR-0023)
- decisions/ADR-0019-delete-combined-tangent-ui.md
- decisions/ADR-0023-agent-pipelines-replace-reviewed-build.md
- decisions/ADR-0024-area-brain.md
- decisions/ADR-0025-brain-writes-what-needs-julian.md
- decisions/ADR-0031-agent-shell-capability-ownership.md
- ui/adr/0001-ui-package-split.md
- ui/adr/0002-react-vite-ui-stack.md
- ui/adr/0006-svelte-usage-ui.md
- ui/adr/0003-token-system.md
- ui/adr/0004-local-ui-server.md
- ui/adr/0005-progressive-disclosure-for-telemetry.md

Agent workflow:
- agent/coding-rules.md
- agent/review-rules.md
- agent/validation.md
- agent/doc-gardening.md

Product design:
- design/agent-shell-area-desk.md
- design/task-outcomes.md

Agent Shell packages:
- ../packages/agent-shell/docs/index.md

Quality:
- quality/scorecard.md
- quality/tech-debt.md

Package docs live at packages/<pkg>/docs/index.md.
