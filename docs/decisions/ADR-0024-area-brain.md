# ADR-0024: An Area brain orchestrates agents and Goals

Date: 2026-08-17

Status: accepted.

## Context

Pipelines (ADR-0023) let Julian compose an assembly line of agents on one Goal and be interrupted only for decisions. Between Goals he was still the planner and dispatcher: how the work splits, what can start, which model each part deserves, when a finished part needs a fix pass. Those decisions kept him in the loop every hour, and when he stepped away the Area stopped moving.

The design (`~/.tangent/trees/otto/tangent/design-area-brain.md`, solution `design-area-brain-solution.md`) set the yardstick: the brain is a real conversation, its memory is written not remembered, it uses the same commands as every agent, Julian is interrupted only for decisions, the plan is visible, fresh context by default with facts on the wire, one brain per Area, guidance not must-lists, nothing new to learn on the desk, testable without live harnesses.

## Decision

- A brain is one long-lived interactive tmux session per Area (kind `brain`, phase `orchestrate`, options `@tangent_brain <area>` and `@tangent_generation <n>`), started from the brain icon on the Area card with Julian's instruction. The server (`prototypes/agent-shell/server.mjs`) primes it with `brainPrompt`: the instruction, the Area sources, the plan Document path, the latest self-handover, and the default policy as guidance (Fable plans, designs, decomposes, and reviews; Sonnet implements; one implementing pipeline per repository; design, implement, review per leaf Goal; ask Julian only for decisions; starting the brain is Julian's word on Goal status for the Goals under its plan, so it marks a Goal done when its review passes and its done condition holds, and won't do when a Goal turns out wrong, unless his instruction narrows this; changed 2026-08-17 on Julian's word from the earlier default of never). The prompt requires this in concrete steps, not as soft guidance: run `tangent goal done <slug>` in the same turn a review passes and the done condition holds; before every `tangent brain handover` and after every batch of results, sweep `tangent goal list <area>` and `tangent agent list` for Goals whose pipeline finished and close them; a finished Goal left showing Waiting for you is a failure of the brain, not a question for Julian (added 2026-08-19 after Julian found finished otto/dnd Goals left waiting).
- One JSON record per Area under `~/.tangent/agent-shell/brains/<area>/brain.json` (schema `area-brain.v1`, `prototypes/agent-shell/brain-record.mjs`) holds the mechanical state: instruction, launch, generations, self-handovers, status. The brain's plan lives in the vault as `plan-<leaf>.md` in its Area folder, an ordinary Document.
- The brain hears back through the message queue: the server forwards pipeline and Goal events on the Area (step handed over, pipeline complete, step stopped, step idle ten minutes without a handover, Goal session ended, pipeline ended by Julian) as messages from `tangent`, and workers may message it by name (their Goal prompt gains a `## Brain` section naming the session).
- The brain hands over to itself with `tangent brain handover "<facts>"`: the server records the facts, starts generation N+1 with the same instruction, the plan path, and those facts, then ends the old session. The server reminds a generation once after `TANGENT_BRAIN_REFRESH_MINUTES` (default 90).
- Stop agent on the brain ends it (`status: ended`); running pipelines continue. The icon offers Resume (a new generation from the record) or Start over. A brain whose session died on its own is `stopped` and resumes the same way.
- CLI: `tangent brain handover|status` and `tangent area create <parent> <name>` (wrapping the desk's `POST /api/areas/new`), so the brain never hand-writes the vault.

## Consequences

- New endpoints `POST /api/brains/start`, `POST /api/brains/handover`, `GET /api/brains/show`; `GET /api/sessions` carries `brains`; `/api/kill/` ends a brain.
- `~/.agents/AGENTS.md` gains bullets for `tangent area create` and `tangent brain handover|status`.
- Goal dependencies stay an idea on the Area note; the plan Document holds the waves for now.
- Everything is testable without a harness: the HTTP tests start a brain, hand it over, kill it, and resume it with `AGENT_SHELL_TEST_NO_LAUNCH=1`.
