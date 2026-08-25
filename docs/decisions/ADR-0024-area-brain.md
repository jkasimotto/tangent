# ADR-0024: An Area brain orchestrates agents and Goals

Date: 2026-08-17

Status: accepted.

Amended 2026-08-24: a passing agent review makes a Goal ready for Julian. The brain writes a Test request and keeps the Goal open. Accepting that Test marks the Goal done. A brain cannot mark the Goal done directly.

Amended 2026-08-26: Tangent paces a brain that hands over with nothing done. A generation counts as having acted when one mutation route names its session as the caller (a Goal created or started, a Request filed or withdrawn, a message sent, an Area added, a comment resolved); reading and the handover itself do not count. A generation that acted hands over at once and clears the streak. A generation that only waited must first live out the rung its lineage has reached: one minute, then two, five, ten, twenty, and thirty for a sustained streak (`TANGENT_BRAIN_WAITING_BACKOFF_MS` names another ladder for tests). An early handover is refused with 429, its facts are not recorded, the generation stays live and asleep, and the reconcile sweep wakes it when the pause ends. A notice, an answer, or a message still reaches it at once. Before this, the otto/tangent brain replaced itself about every 50 seconds while it waited: 170 generations between 14:07 and 17:59 on 2026-08-25 that did nothing.

## Context

Pipelines (ADR-0023) let Julian compose an assembly line of agents on one Goal and be interrupted only for decisions. Between Goals he was still the planner and dispatcher: how the work splits, what can start, which model each part deserves, when a finished part needs a fix pass. Those decisions kept him in the loop every hour, and when he stepped away the Area stopped moving.

The design (`~/.tangent/trees/otto/tangent/design-area-brain.md`, solution `design-area-brain-solution.md`) set the yardstick: the brain is a real conversation, its memory is written not remembered, it uses the same commands as every agent, Julian is interrupted only for decisions, the plan is visible, fresh context by default with facts on the wire, one brain per Area, guidance not must-lists, nothing new to learn on the desk, testable without live harnesses.

## Decision

- A brain is one long-lived interactive tmux session per Area (kind `brain`, phase `orchestrate`, options `@tangent_brain <area>` and `@tangent_generation <n>`), started from the brain icon on the Area card with Julian's instruction. The server (`packages/agent-shell/app/server.mjs`) primes it with `brainPrompt`: the instruction, the Area sources, the plan Document path, the latest self-handover, and the default policy as guidance (Fable plans, designs, decomposes, and reviews; Sonnet implements; one implementing pipeline per repository; design, implement, review per leaf Goal; ask Julian only for decisions). A passing review writes the verdict into Goal State and creates a Test request with exact validation steps. The brain keeps the Goal open. Julian's Accept action marks it done. A brain can mark a Goal won't do only when its approved plan and Julian's instructions permit that result.
- One JSON record per Area under `~/.tangent/agent-shell/brains/<area>/brain.json` (schema `area-brain.v1`, `packages/agent-shell/app/brain-record.mjs`) holds the mechanical state: instruction, launch, generations, self-handovers, status. The brain's plan lives in the vault as `plan-<leaf>.md` in its Area folder, an ordinary Document.
- The brain hears back through the message queue: the server forwards pipeline and Goal events on the Area (step handed over, pipeline complete, step stopped, step idle ten minutes without a handover, Goal session ended, pipeline ended by Julian) as messages from `tangent`, and workers may message it by name (their Goal prompt gains a `## Brain` section naming the session).
- No notice is lost (added 2026-08-19 on Julian's word: an agent must never say it is done without the brain knowing). Every notice is written to `~/.tangent/agent-shell/brains/<area>/inbox.json` (schema `area-brain-inbox.v1`, `packages/agent-shell/app/brain-inbox.mjs`) before it is queued, and marked read only after the whole text showed in a brain composer, or after a new generation's first message that lists it showed in the new session. A brain reads its own Area's inbox and the inboxes of the Areas under it. The server re-queues unread notices when it starts and on every reconcile pass (a notice already on its way is not queued twice), so a delivery that failed or a queue entry that died with an old generation's session is tried again for the live generation. `brainPrompt` gives a new generation a `## Notices you have not read` section. Delivery is at-least-once: a repeated notice costs one line, a lost one costs the work.
- The brain hands over to itself with `tangent brain handover "<facts>"`: the server records the facts, starts generation N+1 with the same instruction, the plan path, and those facts, then ends the old session. The server reminds a generation once after `TANGENT_BRAIN_REFRESH_MINUTES` (default 90).
- Stop agent on the brain ends it (`status: ended`); running pipelines continue. The icon offers Resume (a new generation from the record) or Start over. A brain whose session died on its own is `stopped` and resumes the same way.
- CLI: `tangent brain handover|status` and `tangent area create <parent> <name>` (wrapping the desk's `POST /api/areas/new`), so the brain never hand-writes the vault.

## Consequences

- New endpoints `POST /api/brains/start`, `POST /api/brains/handover`, `GET /api/brains/show`; `GET /api/sessions` carries `brains`; `/api/kill/` ends a brain.
- `~/.agents/AGENTS.md` gains bullets for `tangent area create` and `tangent brain handover|status`.
- Goal dependencies stay an idea on the Area note; the plan Document holds the waves for now.
- Everything is testable without a harness: the HTTP tests start a brain, hand it over, kill it, and resume it with `AGENT_SHELL_TEST_NO_LAUNCH=1`.
