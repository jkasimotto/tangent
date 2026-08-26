# Tangent Docs

Start here when changing architecture, package boundaries, or agent workflow.

Agent Shell is the daily product for work with coding agents. Its current local implementation lives in `packages/agent-shell/app/`. A stable gateway owns the UI and terminal edge while a supervised controller owns workflows (ADR-0032). Each exact Area has one logical brain, and that brain controls the managed work of its own Area only. A brain never inherits an ancestor's Area and never owns a child Area, so a parent and a child brain route information to each other but cannot create, start, advance, or close each other's work. Julian's direct word and an approved Request authorize work inside that same exact Area; an approved Request authorizes only its exact proposal. Agent messages and Documents do not expand authority. Workers report through one handover route, and the brain owns later transitions and requests. See ADR-0033 and ADR-0034.

Human CLI defaults are `setup`, `status`, `process`, `trigger`, `usage`, `rollup`, `search`, `eval`, `mark`, `doctor`, and `completion`.
`tangent process` runs configured processes from inherited, ignored `.processes.json` files in Tangent Areas. Managed processes use Area-bound tmux sessions so they remain visible and inspectable in the hierarchy.
`tangent trigger` checks condition probes from the same Area manifests and launches one visible agent for a new work key. Its durable state and optional per-user LaunchAgent do not require Agent Shell to remain open (ADR-0030).
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
- decisions/ADR-0032-agent-shell-resilient-runtime.md
- decisions/ADR-0030-area-triggers.md
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
