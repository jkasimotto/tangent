# Tangent Docs

Start here when changing architecture, package boundaries, or agent workflow.

Agent Shell is the daily product for work with coding agents. Its current local implementation lives in `packages/agent-shell/app/`. A stable gateway owns the UI, terminal edge, and atomic Work snapshot while a supervised controller owns workflows (ADR-0032, ADR-0056). Gateway and controller share one runtime identity. They can attach to or stop only tmux sessions with that identity (ADR-0036). Each exact Area has one logical brain and durable inbox. Every assignment records the organizing brain's Area path. A worker sends one plain note to that path. Tangent stores the handover and receipt before it confirms delivery. The brain accepts the note when it advances the Job. Everything starts through an Area brain, which runs until the user restarts it and reads its Area note chain as its instruction (ADR-0041). Each attempt records its harness conversation so it can be resumed (ADR-0042).
Provider is a fourth launch axis beside harness, model and effort: an optional field on a harness entry and on a model option, stamped onto `resolvedLaunch.ref` at launch time and kept out of the three-part `launchRef()` string. Rates live in a seeded table in the app and in a `tangent.pricing.v1` block in `~/.tangent/trees/pricing.md`, which overrides it; a model with no rate is reported unpriced and never guessed at. `GET /api/cost` prices a window of Jobs, brains and repairs per conversation, including subagents, and the top bar shows it (ADR-0057).

The root harness registry and explicit per-Area `harnesses.md` contracts jointly resolve brain and worker launches. Area contracts inherit by intersection, retain compatibility aliases, expose health, and are repaired through the shell migration path (ADR-0054).

Human CLI defaults are `setup`, `status`, `service`, `usage`, `rollup`, `search`, `eval`, `doctor`, and `completion`.
`tangent service` runs servers and watchers from inherited, ignored `.processes.json` files in Tangent Areas. Services use Area-bound tmux sessions so they remain visible and inspectable in the hierarchy. `tangent process start|stop|restart|close` still reach it for one release with a hint.
`tangent process` is repeatable work: a `<area>/process-<slug>.md` note with `schedule:` or `when:` plus `every:`. The Agent Shell server is the scheduler. When a process is due it writes one note to the Area brain, which starts the work as a Goal (ADR-0043). With `every:` alone the note is a loop: the brain gets its body as a message every so often while it runs.
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
- decisions/ADR-0056-gateway-owned-work-snapshot.md
- decisions/ADR-0057-provider-axis-and-cost-attribution.md
- decisions/ADR-0036-agent-shell-process-ownership.md
- decisions/ADR-0037-brain-attempt-launch-override.md
- decisions/ADR-0038-agent-shell-keyboard-ownership.md
- decisions/ADR-0039-durable-generic-agent-message-queue.md
- decisions/ADR-0054-explicit-area-harness-contracts.md
- decisions/ADR-0055-separate-goals-jobs-agents-and-brains.md
- decisions/ADR-0030-area-triggers.md (amended by ADR-0043)
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
