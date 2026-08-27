# ADR-0022: Goal ownership, shared sessions, and loosened agent contracts

Date: 2026-08-15

Status: accepted

## Context

Every Goal cost a whole session: three small Goals in one Area meant three launches, three contexts, three pings. The scoping conversation had exactly one output shape (propose Goals, wait for confirmation, never execute), so even trivial work took five steps. Launch prompts were must-lists that also re-taught CLI commands the agents now know ambiently from `~/.agents/AGENTS.md`, and agents opened by confirming the assignment instead of working it.

The data model already had the primitive: Goal frontmatter carries a `session:` binding, `writeGoalBinding()` flips it with status, and a reconcile pass reverts active Goals whose session died. Ownership only needed to become plural, agent-facing, and user-facing.

## Decision

**Ownership is the existing session binding, extended in three directions.**

1. **Plural (desk multi-select)**: startable Goal rows carry a checkbox; while any are checked in an Area panel, that panel shows one action, "Start agent on N Goals", with the usual harness picker. Checking is free and never starts anything; Escape or navigation clears it. One session starts, every checked Goal flips to `active` on it, the first checked Goal is primary (names the session, leads the prompt) and the rest ride along in an "Also in this session" prompt section, worked serially in checked order. Selection scope is one Area panel because a session binds one repository; cross-area selection is unrepresentable. `POST /api/goals/agent|start` carry `extraFiles`. Amendment 2026-08-28: `POST /api/goals/agent` went away with the collaborate start. See ADR-0041. Only the brain starts a Goal session.
2. **Agent-facing (`tangent goal own|release <slug...>`, `create --own`)**: an agent claims the Goals it works, or hands them back, with its own tmux session as the default identity. `create --own` collapses the trivial path to one command: create the Goal, own it, do it. Ownership is never taken from another live session; the server refuses and names the owner. Dead owners are claimable because the reconcile pass already treats them as unowned.
3. **User-facing**: the desk shows the owning session on every owned Goal through the existing `sessionForGoal` display and refined pane states.

**Contracts became guidance, not must-lists.** The describe-work prompt now states two good outcomes (small and clear: `create --own` and do it now; bigger: create Goals that give a fresh agent a great launchpad) and leaves the judgment to the agent, leaning toward doing trivial things immediately. The goal prompt opens with "This Goal was already scoped with Julian... There is no need to re-confirm the assignment before starting." The collaboration prompt dropped "Do not implement product code until Julian explicitly requests implementation" in favor of "When the work is already well defined, get to it; when he is thinking out loud, think with him." Command syntax teaching left the prompts entirely; `~/.agents/AGENTS.md` is the one ambient home for it, so `goal-command.mjs` is no longer referenced by any prompt.

What did not loosen: Goal status still changes only on Julian's word (`done`/`wont-do`), and the server remains the single vault writer.

**Ownership converts a defining session.** When a work-definition session takes ownership (`goal own` or `create --own`), the server flips its tmux identity to the Goal it now works (`@tangent_kind goal`, `@tangent_goal`, phase `execute`), so the desk stops calling it "Defining work" and shows it on the Goal row. The describe form also gained the same harness chooser as Goal rows: a split Start button whose ▾ opens the launch picker (`/api/work/describe` accepts the same `choice`/`command` fields as the Goal start endpoints), and the typed description survives every popover interaction through the stored draft.

## Consequences

- A trivial task is one command from being worked; a swept Area is one launch instead of N.
- The fresh-agent handoff artifact is the Goal description; the failure mode to watch is Julian re-explaining context, which means a scoping agent under-filled a Goal.
- The reconcile pass releases all of a dead session's Goals with no new machinery; partial completion needs none either, since each Goal keeps its own status.
- The `@tangent_goal` tmux option stays the primary Goal only; the Goal files' `session:` frontmatter is the source of truth for ownership.
