# ADR-0017: Agent Shell is the daily product

Status: accepted

Date: 2026-08-12

## Context

Coding agents increase execution capacity and coordination cost. Intent often stays in the user's head while terminals show only execution.

A permanent work tree also consumes attention. It shows many valid items that do not help the current decision.

The separate Tangent UI adds another destination for usage evidence, marks, evals, and reports. This split increases context switching.

## Decision

Agent Shell is the daily product for work with coding agents.

Its main loop is Work, Summary, Agent, and Next step.

The normal screen shows one work list. The list groups work by Waiting for you, Agents working, and Ready to start.

Selecting work opens one summary. The summary restores the area, requested result, short story, linked documents, and next action.

Every execution starts from a short plan that the user can read. Exact technical instructions stay behind a disclosure control.

Running work stays quiet. Returned work enters Waiting for you without replacing the current screen.

The terminal opens only after an explicit action. Polling cannot replace the terminal element.

The top bar keeps Summary and Stop agent visible during a live session.

Usage, marks, evals, and reports provide evidence inside Agent Shell. Tangent UI is not the daily work destination.

The existing JavaScript server, vault, tmux bridge, native transcripts, and Git history remain the technical foundation.

## Consequences

- Agent Shell needs durable user-understanding notes and plan preview APIs.
- Attention signals must state only observable facts.
- A user ends a Run, changes durable knowledge, and completes a Goal as separate actions.
- Existing analysis packages can remain independent and supply data to later Agent Shell views.
- The first visual notebook remains as evidence of the rejected phase dashboard.

## Usability amendment

Julian completed the first unscripted test on 2026-08-12. The phase dashboard failed to restore context and reduced perceived control.

The amended decision removes visible phases, assignment language, split panes, source lists, and duplicate attention surfaces.

The goal summary uses one reading column. It presents context before controls and keeps the terminal behind Open agent details.

Julian completed a second unscripted test on the same day. The context-first model restored his context and protected his attention.

The second amendment groups each status list by area and goal hierarchy. It also adds visible completion actions.

`Command+Enter` submits forms that contain substantial text. Recent activity can order area groups, but it cannot define human priority.

Julian completed another unscripted test on 2026-08-13. Live Edit exposed a fault in the Goal-first presentation.

One agent job created use cases, principles, decisions, and a design. These are Documents, not extra Goals.

The third amendment defines three product objects: Areas, Goals, and Documents.

An Area is a durable subject container that Julian creates. The interface never infers an Area from every subject mentioned in work.

A Goal records a desired change at any useful level. A Goal can link to Subgoals that answer “To do that.”

The Work page shows each Goal tree as one collapsible group. Julian can select the root Goal or any Subgoal.

A Document records reusable knowledge. It lives in an Area and can link to one or more Goals.

Search indexes a Document with the linked Goal chain. A remembered event can therefore retrieve knowledge even when its file name differs.

For example, PG&E is an Area. “Land the megabranch,” “Land Viz Input,” and “Get graphics approved” are Goals in that Area.

Viz Input does not become an Area unless Julian creates that Area later.

Areas and Programs use the same remembered, collapsible Area tree. The direct New Goal action is absent from the Work page.

Selecting an Area shows its Documents and Goals beside the tree. This view makes durable knowledge visible without an active Goal.

A Document opens in the reading column. The back action returns to the selected Area.

## Product vision amendment

The native agent interface remains the only chat surface. Agent Shell adds goal context, Summary, and Stop agent around it.

The summary has two compact memories. Current brief states the requested result in one line. Story so far records no more than five meaningful changes.

Agents update these memories at natural work boundaries. They do not copy the full conversation into the goal.

The summary lists each linked Document.

Describe work preserves the natural description from the user. A model proposes one Goal and optional Subgoals.

Each work-definition conversation is a first-class agent Run in the normal work list. Its row says Defining work and follows the same Waiting for you or Agents working attention state as other Runs.

Describe work always starts another description. An existing definition is resumed from its own row, so one defining agent never blocks the user from describing more work.

After confirmation, the agent uses Agent Shell's deterministic Goal command. The command validates and writes the current Goal schema. The agent does not hand-author Goal frontmatter, Subgoal links, source links, or Area ordering.

Legacy Outcome records remain readable as Goals during the storage migration. New work uses the Goal command and current schema.

The proposal remains editable. Nothing enters the vault until the user confirms it.

The proposal defaults to one Goal. A Subgoal exists only when it needs separate focus.

Every stored root and Subgoal remains a Goal. A Goal can have any useful size.

Keep Mac awake appears only beside live work. The assertion ends when the user turns it off or Agent Shell exits.

## Document action amendment

Julian reviewed the Live Edit design package on 2026-08-13. Reading the Documents revealed questions, requested changes, and the next Goal.

The first response made one Document the feedback boundary. It offered Discuss with agent and Describe related work as separate actions.

Julian rejected that distinction on 2026-08-14. One review can move through many Documents and produce questions, edits, consolidation, and new work.

A Goal review is now the interaction boundary. The selected Document records the current reading location, not the scope of the feedback.

The review shows the Goal, meaningful moments, linked Documents, and the current page outline in one persistent index.

Wiki links between Documents open inside the same review. Clickable Area breadcrumbs open the selected Area directly.

One Open agent action opens the native agent beside the complete review. The user can change Documents without replacing the terminal.

The agent receives the Goal, all linked Documents, and the selected reading location. The user does not classify a message before speaking.

The agent can answer questions, edit Documents, consolidate knowledge, or propose a separate Goal. Goal creation still requires user confirmation.

This sidecar is optional and user-invoked. It does not restore the permanent multi-pane dashboard rejected during the first usability test.

Full screen opens the same native session. Returning from full screen restores the Goal review.

The transcript remains the full feedback record. Accepted feedback changes the Document or the Goal story at a meaningful boundary.

Agent Shell does not add a separate comment system at this stage.

Markdown tables render as semantic tables. Wide tables scroll inside the reading surface.

## Reader amendment

Julian used the Goal review on 2026-08-14. The persistent left index competed with the Document and created too much text.

The optional agent pane also placed two attention targets on one screen. The generic execution-plan preview did not explain a useful decision.

The Document reader now shows one Document as the dominant object. It has no permanent left rail and no split agent view.

A small navigation row provides history controls, the Area path, a Document picker, and Open agent.

The global bar does not repeat the Area path or Document title from this row.

On this page remains at the right on wide screens. It has no filled panel or dividing border.

The outline moves into a small menu on narrow screens. Document headings remain expanded.

Wiki links and Markdown links open inside the reader. The reading trail provides a direct route back.

Open agent replaces the reader with the native agent. Back restores the same Document and reading position.

The Summary has one Open agent action. Agent Shell no longer shows Review execution plan.

## Area desk amendment

Julian used the Work, Summary, agent, Area, and Program routes on 2026-08-14.

The status-first list did not match his stable subject map. Repeated card shapes also hid the difference between Goals, Subgoals, and Documents.

The Work page now uses Areas as stable visual landmarks. Agent state appears inside each Area and in a small direct attention queue.

Work, Areas, and Programs remain visible as top-level tabs. Their availability does not depend on the current page.

Summary is no longer a required route. A waiting item opens its native agent, and Back returns to Work.

The optional Goal detail keeps the brief and history. Linked Documents appear before history and remain available from Work.

The complete interaction and visual contract is in `docs/design/agent-shell-area-desk.md`.
