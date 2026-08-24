# Tangent model view

## Problem

Julian cannot inspect Tangent's operating model from within Tangent. The interface shows Areas, Goals, brains, agents, and asks without one shared explanation.

This gap makes valid system behavior look arbitrary. For example, an open brain request can survive its brain session.

A Goal tree can also appear in Current because a retained Run exists on a Subgoal. This design does not change these Work projections.

The goal is a separate product view that answers four questions:

- What are the main Tangent concepts?
- How do the concepts relate?
- Who owns each state change?
- What event moves work to the next state?

The view must describe the canonical model and identify legacy behavior. It must not become a second control surface. It must not change Goal, brain, request, pipeline, or vault state.

Success has these observable conditions:

- Julian can explain Area, Goal, Subgoal, Brain, Run, Pipeline, Ask, Test, Document, and Program after one visit.
- Julian can follow one Goal from creation to closure.
- Julian can explain why a stopped brain can retain durable records.
- Julian can distinguish durable objects from runtime activity and UI projections.
- The existing Work surface does not change.

## Evidence

### Existing system

The repository defines a short vocabulary in [the Agent Shell workspace rules](../../../packages/agent-shell/app/workspace/AGENTS.md). An Area is a durable subject.

A Goal is a desired result. A Subgoal is another Goal linked by `To do that`. A Run is one agent session on a Goal.

The vocabulary does not cover the complete user model. It omits Brain, Pipeline, Ask, Test, and the difference between durable state and runtime state.

[ADR-0024](../../decisions/ADR-0024-area-brain.md) defines a Brain as the controller for managed work in an Area. The brain record survives a stopped or ended session. Its inbox also survives session replacement.

[ADR-0029](../../decisions/ADR-0029-brain-is-the-managed-work-controller.md) makes a Brain the sole controller for managed pipelines. Workers report facts to the Brain. The Brain decides what happens next.

Brain requests are durable records with four kinds: plan, decision, test, and approval. An open request stays open until Julian answers it. Stopping the Brain does not answer the request.

The browser converts several sources into one Ask shape. Sources include brain requests, legacy plan rows, agent dialogs, stopped steps, and Goal handovers. `For you` is therefore a UI projection, not a stored domain object.

The Work view also uses projections. `Current` selects Goal trees with a live session, a direct user wait, or a Test request. `Current` is not a Goal state.

### Internal precedent

The existing Agent prompt bestiary is the closest product precedent. It is already a top-level view inside Agent Shell.

It shows actors, lifecycle transitions, message contracts, state changes, and the owner of the next action.

The bestiary starts too far inside the model. A reader must already know its actors and objects.

Its title also presents it as a prompt inspection tool instead of the Tangent operating model.

The bestiary has useful contracts that this design can reuse:

- selectable canonical lifecycles;
- transitions that name the source actor and destination actor;
- detail about triggers, state changes, delivery, and the next action;
- exact prompt inspection for advanced diagnosis;
- explicit labels for canonical and legacy lifecycles.

### External precedent

No external product model is necessary. Tangent has specific concepts and ownership rules. The existing bestiary gives a stronger internal precedent than a generic workflow or graph tool.

### Implication

The design must extend the bestiary into a Tangent model view. It must add the missing concept map before the lifecycle detail.

The model view must distinguish three layers:

1. Durable objects record meaning and history.
2. Runtime actors and operations perform work.
3. UI projections select and combine facts for one purpose.

This distinction explains both reported examples without changing the Work surface.

## Principles

- Use one name for each concept across the view, product text, and repository rules.
- Show ownership before implementation detail.
- Separate durable state, runtime state, and UI projections.
- Explain behavior through lifecycles, not through a glossary alone.
- Use current Tangent data as evidence, not as the canonical definition.
- Keep advanced prompt detail available without making it the entry point.

## Recommendation

Replace the top-level `Prompts` destination with a `Model` destination. This change does not alter the Work surface. The existing prompt bestiary becomes the advanced part of the new destination.

The Model destination has three connected modes: Model, Lifecycles, and Messages.

### Model

The default mode shows a small relationship map with three visual bands:

```text
Durable meaning       Area ──contains──> Goal ──contains──> Subgoal
                        │                  │                    │
                        ├──contains──> Document                 │
                        └──contains──> Program                  │
                        │                                       │
Control                 └──controlled by──> Brain ──────────────┘
                                                │
Runtime                                        starts
                                                ▼
                                      Pipeline ──contains──> Run

Attention             request or runtime fact ──projects──> Ask
                                      Test is one request kind
```

The map uses `Goal` for both parent Goals and Subgoals. `Subgoal` describes a relationship, not a second object type.

When Julian selects a concept, an inspector shows five fixed fields:

- Definition
- Purpose
- Owner
- Lifecycle
- Related concepts

The inspector also shows `In Tangent now`. This section gives counts and a few named examples from current state. It labels these values as examples, not definitions.

The canonical definitions are:

- **Area:** A durable subject that contains related Goals, Documents, and Programs.
- **Goal:** A desired result with a condition for completion.
- **Subgoal:** A Goal that contributes to another Goal through a `To do that` link.
- **Document:** Durable knowledge that supports an Area or Goal.
- **Program:** A repeatable operation attached to an Area.
- **Brain:** The controller that plans and directs managed work for an Area tree.
- **Pipeline:** An ordered set of assignments for one Goal.
- **Run:** One agent session that works on a Goal or pipeline step.
- **Request:** A durable question from a Brain to Julian. Its kind is plan, decision, test, or approval.
- **Test:** A request that asks Julian to evaluate a reviewed result.
- **Ask:** One actionable row in `For you`. Tangent projects an Ask from a request or runtime fact.
- **View:** A projection of stored and runtime facts. `Current`, `Planned`, and `For you` are views, not states.

### Lifecycles

The Lifecycles mode reuses the existing bestiary sequence. It changes the entry point from prompt delivery to user questions:

- How does work become a Goal?
- How does a Brain direct a Run?
- What happens when an agent finishes?
- Why does Tangent ask me something?
- What happens when I pass or reject a Test?
- What survives when a Brain stops?

Each transition names the actor, trigger, durable state change, runtime effect, and next owner. The existing exact prompt detail remains available from each transition.

The lifecycle for a stopped Brain must show this distinction:

```text
Brain session stops
        │
        ├── runtime: no Brain agent is active
        ├── durable: Brain record, inbox, plan, and requests remain
        └── next: Resume starts a new generation from those records
```

The Ask lifecycle must show that Ask is a projection:

```text
Durable request or runtime fact
              │
              ▼
        Ask projection
              │
              ▼
           For you
```

Answering a request changes the durable request. Hiding a projected row does not change its source unless the action contract says so.

### Messages

The Messages mode is the current prompt bestiary. It shows the exact contracts between Julian, Agent Shell, Brains, and workers.

This mode retains the current prompt inspector and canonical message shapes. It no longer carries the burden of teaching the complete product model.

### Complete workflow

Julian selects `Model` from the top-level navigation. The default map shows the complete concept model without changing the Work view.

Julian selects `Ask`. The inspector explains that an Ask is a projection. It lists request, dialog, stopped step, and handover as possible sources.

Julian selects `What survives when a Brain stops?`. The lifecycle shows that the runtime session stops while durable records remain.

Julian can then open Messages to inspect the exact request and notice contracts. Back returns to the previously selected concept and lifecycle.

Empty current data does not remove the canonical model. The `In Tangent now` section shows `No current examples`.

If current data is stale or unavailable, the canonical content remains usable. The example section states that current examples are unavailable.

## Decisions

### 1. Extend the prompt bestiary into one Model destination

**Recommendation:** Rename the top-level destination and add Model and Lifecycles before Messages.

**Best rejected alternative:** Add a separate glossary or Help destination. This option has a low change cost and keeps the prompt bestiary unchanged.

A glossary cannot show ownership or transitions. A separate Help destination also creates two competing explanations of Tangent.

The recommended option reuses the strongest current precedent. It changes one top-level label but does not change the Work surface.

Reconsider this decision if the prompt bestiary becomes a developer-only diagnostic tool with restricted access.

### 2. Use a relationship map as the default view

**Recommendation:** Start with a curated map and an inspector.

**Best rejected alternative:** Start with lifecycle stories. Lifecycles explain behavior well and need less visual design.

Lifecycles assume that the reader knows the actors and objects. The reported problem starts before that point. Julian does not yet have stable definitions for the nouns.

The map has moderate design cost because it must remain readable on narrow screens. Its structure is stable because the concepts already exist.

Reconsider this decision if user research shows that readers understand the nouns but fail only at transitions.

### 3. Show current examples without creating an instance debugger

**Recommendation:** Show counts and named examples in each concept inspector. Keep the canonical definition visually separate.

**Best rejected alternative:** Show only static canonical content. This option cannot drift with runtime code and has the lowest operational cost.

Static content does not answer `Do I have any of these now?`. Current examples connect the model to the product without changing the primary surface.

The example projection must use existing API data. It must not add a second state authority or infer new status.

Reconsider this decision if current examples repeatedly disagree with the Work surface. In that case, remove examples until both views use one projection contract.

### 4. Define Ask as a projection, not a durable object

**Recommendation:** Keep Request and Ask separate.

**Best rejected alternative:** Use `Ask` as the user-facing name for every durable request. This option reduces the visible vocabulary.

Not every Ask comes from a durable request. Tangent also projects Asks from runtime dialogs, stopped steps, and Goal handovers.

Combining the terms would hide the source and lifecycle that caused the original confusion. The model must show the exact source type.

Reconsider this decision if Tangent removes every inferred Ask and stores all user attention as durable requests.

### 5. Define Subgoal as a relationship

**Recommendation:** A Subgoal is a Goal linked to a parent Goal.

**Best rejected alternative:** Define Subgoal as a smaller task type. This wording matches common project-management language.

The stored system uses the same Goal object and lifecycle for both. A separate type would teach a false data model.

This decision has low change cost. It aligns the product definition with the current repository rule.

Reconsider this decision if Subgoals gain a separate schema or lifecycle.

## Risks / open questions

- The canonical catalog can drift from code. Shared exported model data can reduce drift, but the design must not make UI code the domain authority.
- Current examples can repeat the same confusing projection. Each example must name its source and freshness.
- The relationship map can become an architecture diagram. It must show user concepts and ownership, not modules or storage paths.
- `Request` adds a noun that Julian did not name. The distinction is necessary while inferred Asks exist.
- Legacy Markdown rows and self-advancing pipelines can weaken the canonical model. The view must label them as legacy and keep them outside the default map.
- This design does not correct misleading Work projections. A later design can use the model definitions as its contract.
