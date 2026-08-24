---
type: document
status: note
---

# Prepared results: design record

Date: 2026-08-25

Goal: [[goal-make-completed-work-directly-testable]].

Selected design: [repository design](design.md). Vault copy: [[design-make-completed-work-directly-testable]].

## Problem contract

The current review request can transfer setup work to Julian. It can name a checkout, command, route, or file without preparing any of them.

The result is not directly reviewable. `For you` then means “work for Julian to operate” instead of “questions Julian can answer.”

The design must satisfy these conditions:

- Finished work stays visible before acceptance.
- One action opens the exact result that Julian must judge.
- Agents prepare project-specific state before they expose the ask.
- Web, native, file, and no-setup reviews use one user concept.
- Runtime failures remain visible and have a named recovery owner.
- Request state, Goal state, and Program state keep separate authorities.
- Project setup does not become a universal recipe language.
- Arbitrary agent-authored shell commands never become review buttons.

Non-goals:

- Prove arbitrary product behavior inside Agent Shell.
- Replace Programs, pipelines, Runs, Goals, or Requests.
- Create a deployment platform.
- Open windows automatically after background work finishes.
- Add a target taxonomy to Julian's product vocabulary.

## Observed current system

### Requests

`packages/agent-shell/app/brain-requests.mjs` stores `area-brain-requests.v1`. New records use `status: "open"` and then become `answered`.

The current kinds are `plan`, `decision`, `test`, and `approval`. Each new Request stores a proposal, question, short detail, and optional Goal.

`answerBrainRequest` accepts `approve` or typed `changes`. A Goal-bound approved Test closes its Goal in `packages/agent-shell/app/server.mjs`.

`packages/agent-shell/app/public/ask-core.js` projects every open Request into an Ask. The Ask always opens the Request and shows the two answers.

`packages/agent-shell/app/public/work-desk-view.js` draws the compact row. Its `Open` action shows a read-only modal with proposal, question, and detail.

The Request has no structured output, review action, result revision, Program reference, or preparation state.

### Brain and worker boundaries

The brain prompt in `packages/agent-shell/app/server.mjs` makes the brain the orchestrator. It forbids repository investigation, implementation, testing, and review.

Workers report facts through `tangent handover`. The brain chooses the next transition and creates each Request.

The prompt already uses preparation before publication for Agent Shell changes. The brain runs `tangent shell rebuild` before it creates the visible Request.

This precedent has the correct order. The Tangent-specific command is not a general solution.

### Programs

`packages/agent-shell/app/programs.mjs` reads inherited `.processes.json` files. It resolves process, command, and trigger Programs against Area resources.

A process has a stable Area identity, command, working folder, tmux session, availability, and live state. The nearest Area definition wins.

`packages/agent-shell/app/public/program-view.js` starts, stops, restarts, and opens retained Program sessions. The UI can also create local Programs.

Program liveness means that the managed session runs. Programs have no route, health probe, expected UI state, or result revision.

The worker instructions require `tangent process list` before any server or watcher. They require `tangent process start` for a matching Program.

There is no agent-facing Program creation command. The browser route can create one through `POST /api/programs/new`.

### Current design contracts

ADR-0024 keeps a reviewed Goal open until Julian accepts its Goal-bound Test. ADR-0029 makes the brain the controller of managed work.

ADR-0027 defines `For you` as direct asks only. Runtime state alone cannot create a row.

`design-one-thought-through-model-for-everything-that-ne` gives `ready` to the Goal. It keeps Request state independent from Goal state.

That design also makes Recent results a result view. It must retain output despite a missing or failed Request.

`design-agent-shell-current-work-home` says a Test opens finished output and exact steps. It makes ready publication and valid Test creation one operation.

The unapproved draft conflicts with both designs. It moves `ready` to Request and makes Recent results a list of answered Request receipts.

### Motivating workflow

The unapproved draft preserves the concrete Polez case. Julian receives a Test that names a worktree and manual setup instead of opening the schema editor.

The manual work has four parts: find the checkout, start the client, find the route, and verify that the route uses the reviewed source.

None of these actions requires Julian's judgment. The finishing agent has more context and can perform them before the ask exists.

The originating screenshots are not stored in the Goal. The draft and current contracts supply the durable evidence available to this investigation.

## Counterexamples to the draft

### A preparing Request duplicates work state

The draft adds `preparing`, `ready`, `answered`, and `cancelled` Request states. Existing Goal and pipeline state already show active preparation and failure.

A Request is Julian's direct ask. Before Julian can act, there is no Request in the product sense.

This extra state also collides with the approved durable `ready` Goal. Two different objects then use `ready` for one result handoff.

### A setup worker is not always the best first owner

The final reviewer already knows the checkout, changed behavior, proof, and likely route. A new worker must reconstruct all four facts.

Separate setup work is useful after a failure or for specialized deployment. It is not a valid mandatory stage.

### Optional Programs weaken the reliability claim

An unmanaged server can die with its worker, use an unknown folder, collide on a port, or survive without visible ownership.

The draft permits this path while promising a working review environment. Those two statements are incompatible.

Programs are not required for static results or short preparation commands. They are required for dependencies that must remain alive.

### A URL health probe does not verify a review

A listening server can show a stale build, wrong branch, authentication page, loading error, or wrong route.

Program liveness also does not prove route readiness. The final verification remains an agent judgment tied to a source revision.

### Request-owned targets break recall

A Request can fail to save, become withdrawn, or be superseded. The ready result must still appear in current work and Recent results.

Therefore the Review action must belong to the result. A Request only references that exact result revision.

### The draft does not cover native review

Its target union contains URL, file, and session. A native application can require focus, a deep link, or preserved window state.

A Tangent session does not place Julian in the native interface. A generic command target creates an unsafe execution boundary.

### One-off setup has no sound cleanup rule

The draft permits a worker session to own setup, but it does not define survival, liveness, repair, or cleanup.

Goal completion can end sessions. Shared development servers also cannot stop safely after one Request receives an answer.

The selected design assigns long-lived processes to Programs. It leaves Program lifetime under Area control.

## Scenario analysis

| Scenario | Required preparation | Review action | Failure behavior |
|---|---|---|---|
| Web route | Start required Programs and verify the route on the reviewed source | Typed HTTP URL | Stale Program changes Review to Repair review |
| Native app with deep link | Launch the app and verify the exact screen | Declared app plus deep link | Failed focus or changed state returns to repair |
| Native app without deep link | Leave verified app state available and record a focus action | Declared app focus | Lost window state requires agent repair |
| Repository file | Verify existence, source revision, and useful viewer | Scoped file open | Missing or changed file blocks direct review |
| Vault Document | Verify render and content | Existing Tangent Document open | Missing Document falls back to Goal detail |
| Static report | Verify the generated report | URL or scoped file open | Missing report keeps the result ready but unavailable |
| Terminal result | Verify the retained session and exact pane | Existing Tangent session open | Ended session requires a new durable artifact or repair |
| No setup | Exercise the existing output action | Existing Tangent or external open | Invalid action blocks ready publication |
| Multi-service web app | Start each required Program and verify the final route | One HTTP URL plus Program references | Any known stopped dependency triggers repair |

The table has one user action. The adapter kinds exist because their privilege and failure boundaries differ.

## Candidate designs

### A. Improve Request prose only

The brain describes setup in `detail` and keeps the current model.

This option has no schema cost. It still transfers setup and source verification to Julian, so it does not solve the problem.

### B. Create a preparing Request, then attach a target

This is the unapproved draft. It gives setup a durable identity and can show setup progress.

It duplicates Goal and pipeline state, conflicts with Goal readiness, and makes result access depend on Request persistence.

It also gives a worker a Request mutation role that conflicts with the brain controller boundary.

### C. Prepare before publication and put Review on the result

This is the selected design. Existing Goal work records preparation. The ready result owns output, proof, and the Review action.

The Request stays a direct ask with its existing lifecycle. The brain remains the only Request publisher.

This option depends on the approved ready-Goal and result revision model. That model is not implemented yet.

### D. Add a Review Environment object

A separate object stores checkout, processes, probes, target, owner, lease, and cleanup.

This option has strong operational semantics. Current variation does not justify another durable object or lifecycle.

Programs already own reusable processes. Results need only references and a verified action.

### E. Define a review recipe language

Each Area stores commands, services, health probes, routes, and teardown rules. Agent Shell executes this recipe.

This option can automate stable web projects. It becomes a local deployment language for native apps, files, devices, and multi-service systems.

The repository has no evidence that this abstraction is stable. Agent judgment plus Programs is smaller.

### F. Allow arbitrary shell actions on Review

The agent stores a command that runs after Julian selects Review.

This option covers every target in one shape. It turns a compact attention row into remote command execution by agent-authored text.

The security and diagnosis cost is unacceptable. The selected design uses constrained open adapters only.

## Selected architecture

The durable Goal-owned result contains a review handoff. The exact storage encoding belongs to the ready-Goal implementation design.

Representative shape:

```ts
type OpenAction =
  | { kind: "url"; url: string }
  | { kind: "file"; path: string }
  | { kind: "tangent"; target: "document" | "session" | "program"; id: string }
  | { kind: "app"; appId: string; deepLink?: string };

type ReadyResult = {
  goal: string;
  revision: string;
  source: { commit?: string; checkout?: string; artifactHash?: string };
  summary: string;
  proof: Array<{ label: string; target?: string }>;
  review: {
    action: OpenAction;
    steps: string[];
    expected: string;
    verifiedAt: string;
    programs: string[];
  };
};
```

This shape is not a new Review object. It is one capability-bearing field on the finished result.

The server derives Area ownership, timestamps, current Program state, and Goal identity from existing records.

The worker reports facts through the current handover. The brain calls the result publication boundary after it accepts those facts.

Ready publication must be idempotent for one Goal and result revision. A second content revision supersedes the earlier open acceptance Request.

Operational repair can update `verifiedAt` and the locator only while source identity stays unchanged. It cannot change reviewed content under an open Request.

## Ownership and invariants

| Fact | Authority |
|---|---|
| Work intent and durable ready state | Goal |
| Finished output, proof, Review action, and result revision | Goal-owned result |
| Question, proposed transition, and Julian response | Request |
| Process command, folder, session, and liveness | Program |
| Preparation assignment and attempts | Existing pipeline and Runs |
| Whether product behavior is correct at verification time | Preparing agent claim |

Load-bearing invariants:

- Only an open Request enters `For you`.
- A result Request references one ready Goal and one result revision.
- A ready result remains reachable without any Request.
- One open acceptance Request exists for one Goal and result revision.
- Long-lived dependencies resolve to Programs in the same Area territory.
- Program liveness is derived and never copied into the result.
- An Open action contains no shell command.
- A file action resolves inside the vault or a declared Area resource.
- A URL uses an accepted scheme. A custom native scheme must belong to a declared app target.
- `Review` never answers the Request.
- `Approve` never opens or repairs the result.
- Repair cannot silently change the result source revision.

## Complete workflow

1. The final worker finishes the result and proof.
2. The worker reads Area resources and lists Programs.
3. The worker starts each required Program through Tangent.
4. The worker exercises the proposed Review action against the reviewed source.
5. The worker reports the result revision, action, steps, expected behavior, verification time, and Program references.
6. The brain publishes the ready result through one idempotent server operation.
7. The brain creates an acceptance Request that references that result revision.
8. The ready Goal appears in current work and Recent results.
9. The open Request appears in `For you` with Review, Details, Approve, and I want these changes.
10. Julian selects Review. Agent Shell verifies safe adapter input and current known dependencies.
11. If the handoff remains usable, Agent Shell opens the target.
12. If a known dependency is stale, Tangent notifies the brain and keeps the Request open.
13. Julian approves or supplies required change text.
14. Approval moves that exact ready Goal to done.
15. Requested changes return the Goal to open and retain the result in Recent results.

## Failure and repair semantics

Preparation failure occurs before Request creation. The existing Goal and pipeline show the failed attempt and the brain owns recovery.

If the final worker remains active, it can repair its own handoff. Otherwise, the brain delegates a bounded repair assignment.

A stopped Program is evidence of staleness, not proof that every target failed. Tangent changes the Review action and reports the known fact.

Repair cannot mark the result usable after process start alone. The repair worker must exercise the exact action again.

An external open failure leaves the Request open. The UI preserves the target label and offers retry, copy, and repair.

An unavailable target does not hide the ready Goal. It remains visible because result existence and review availability are separate facts.

Answer storage and the ready-to-done Goal transition need the recoverable operation already required by the approved Request design.

Program processes survive Request answers. Tangent cannot infer whether another result or Area user still depends on them.

## UI and UX analysis

The common path is scan, open, judge, answer, and return. Setup and diagnosis are exceptional paths.

The row must show the subject, one context sentence, the direct question, Review, and the two stable answer actions.

Details must keep proof, steps, expected behavior, source identity, and known dependency state available without crowding the queue.

Preparation never increases the `For you` count. It stays on the Goal row because Julian has no answer to give.

The interface uses text for ready, stale, repair, and error states. Color does not carry state alone.

Review receives normal keyboard focus and an action-specific accessible name. Background readiness never moves focus or opens a window.

Recent results must project result records. It must not depend on answered Request records for output discovery.

## API boundary analysis

The caller supplies facts that Agent Shell cannot derive: result revision, expected behavior, review steps, and the verified Open action.

The server derives the Area, Goal record, current Program projection, timestamps, and allowed resource roots.

The publication operation returns a structured error for an invalid target, missing Program, stale Goal revision, or duplicate open acceptance Request.

Open actions cross a privilege boundary. The server validates each adapter immediately before it performs the user-initiated action.

Retries use Goal and result revision as the operation identity. A duplicate publication returns the existing result without a second Request.

Repair uses the same identity. A source change returns a conflict and requires a new result revision.

No API accepts command text, working folders, tmux names, or copied Program liveness as part of an Open action.

## Compatibility and rollout

Current Request records keep `open` and `answered`. This design adds no Request readiness migration.

Legacy open Requests without a result reference remain readable. Their primary action continues to open Request Details.

Current `kind: "test"` can remain internal routing metadata during the generic Request migration. New behavior must key from a result reference.

Existing Programs remain valid. The result stores stable Program IDs and derives their current projection.

The approved `ready` Goal, result revision, and Recent-results model must land before or with this design. Current Goal files do not implement `ready`.

Old done Goals stay done. Existing open Goals do not become ready without a published result and positive preparation evidence.

The controlled local opener is a new server capability. A URL-only rollout can ship first, but it does not satisfy native and file completion.

## Operations analysis

The likely diagnosis questions are concrete:

- Which Goal and result revision does this Request accept?
- Which checkout, commit, or artifact hash did the agent verify?
- Which Program dependencies are live now?
- Which agent last verified the target, and what was the time?
- Did Review fail to open, or did the target open with wrong behavior?
- Which repair attempt changed the locator or verification time?

These facts need result, Request, Program, and Run identifiers in logs. They do not need a new Environment identifier.

No automatic retry loop is recommended. The brain owns retry count and worker choice because failures can need repository judgment or permission.

No time-to-live can make an arbitrary product result valid. The UI shows verification time and derives known Program liveness.

## Decisions

- Prepare before publishing the Request.
- Keep Request lifecycle independent and unchanged by preparation.
- Store Review on the Goal-owned result revision.
- Let the finishing agent attempt preparation first.
- Delegate a separate repair worker only after evidence proves it necessary.
- Require Programs for each long-lived dependency.
- Keep routes, steps, expected behavior, and verification outside Programs.
- Use constrained Open adapters and reject shell command targets.
- Let Julian initiate every focus change.
- Keep Recent results result-based.
- Keep shared Program lifetime independent from Request answers.

## Rejected alternatives

The strongest rejected alternative is the draft's preparing Request. It provides durable setup identity, but existing work records already provide that identity.

A Review Environment object is rejected until Programs plus result references fail in a concrete repeated workflow.

A recipe language is rejected because current variation includes native interfaces, static files, Documents, sessions, and multi-service web apps.

Prompt-only preparation is rejected because the data model cannot open, diagnose, or recall the prepared result.

Automatic opening is rejected because background completion must not steal focus or create stale tabs.

Arbitrary command actions are rejected because they merge a direct review link with local command execution.

## Risks, assumptions, and open decisions

### Controlled local opener

The recommendation allows typed URL, file, Tangent, and declared-app actions. Julian must accept this local privilege boundary.

The narrower alternative supports HTTP and Tangent targets first. That option leaves native and repository-file reviews incomplete.

### Program creation for workers

The browser can create a Program, but workers only receive list and start commands. Reliable preparation needs a validated agent-facing creation path.

### Native state

Focus alone cannot restore an arbitrary in-app screen. A native result needs a deep link or preserved state that the repair path can verify.

### Process cleanup

This design does not stop Programs after an answer. Automatic cleanup needs separate evidence about sharing and expected lifetime.

### Verification strength

The agent claim can be wrong. Add result-specific automated probes only after repeated workflows expose stable semantics.

## Sources

- `packages/agent-shell/app/brain-requests.mjs`
- `packages/agent-shell/app/brain-requests.test.mjs`
- `packages/agent-shell/app/brain-routes.mjs`
- `packages/agent-shell/app/brain-routes.test.mjs`
- `packages/agent-shell/app/server.mjs` (`brainPrompt`, Request creation, Request answers, Program routes)
- `packages/agent-shell/src/cli/commands/brain.ts`
- `packages/agent-shell/src/cli/spec.ts`
- `packages/agent-shell/app/public/ask-core.js`
- `packages/agent-shell/app/ask-core.test.mjs`
- `packages/agent-shell/app/public/work-desk-view.js`
- `packages/agent-shell/app/focus-shell-work-navigation-ui.test.mjs`
- `packages/agent-shell/app/programs.mjs`
- `packages/agent-shell/app/programs.test.mjs`
- `packages/agent-shell/app/public/program-view.js`
- `packages/agent-shell/app/public/shell-coordinator.js`
- `packages/agent-shell/app/workspace/AGENTS.md`
- `docs/decisions/ADR-0024-area-brain.md`
- `docs/decisions/ADR-0025-brain-writes-what-needs-julian.md`
- `docs/decisions/ADR-0027-for-you-rows-are-direct-asks.md`
- `docs/decisions/ADR-0029-brain-is-the-managed-work-controller.md`
- `~/.tangent/trees/otto/tangent/design-agent-shell-current-work-home.md`
- `~/.tangent/trees/otto/tangent/design-one-thought-through-model-for-everything-that-ne.md`
- `~/.tangent/trees/otto/tangent/design-record-one-thought-through-model-for-everything-that-ne.md`
- `~/.tangent/trees/otto/tangent/design-reviewed-work-programs.md`
- `~/.tangent/trees/otto/tangent/design-goal-launch-environments.md`
