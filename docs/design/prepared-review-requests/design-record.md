# Prepared review requests: design record

Date: 2026-08-25

## Problem contract

The current Test and approval Requests often transfer operational setup to
Julian. The screenshots motivating this design ask him to open specific
worktrees, infer or run the client, find the relevant route, and then evaluate
the feature. That is avoidable work and makes `For you` mean “things you must
figure out” rather than “decisions ready for you.”

The root problem is not insufficient prose in the modal. It is that Tangent
records a Request as open before the promised review experience exists.

Observable success:

- A visible result reaches `For you` only when its review target is usable.
- One action takes Julian to the exact thing to judge.
- Project-specific setup remains agent judgment and Area knowledge, not Agent
  Shell product code.
- The user can distinguish preparation, readiness, setup failure, and answer.
- A Test answer retains its existing Goal-closing semantics.
- Several ready Requests do not open tabs or steal focus in the background.
- A just-answered Request leaves a visible receipt.

Non-goals:

- Define a universal development-environment or deployment system.
- Prove arbitrary product behavior with a generic health check.
- Require every repository to create a Program before it can request review.
- Move test judgment from Julian to an agent.
- Replace Goal, pipeline, brain, Program, or Request persistence.

## Current system

### Requests are durable brain questions

`packages/agent-shell/app/brain-requests.mjs` stores one JSON record per Area
brain with request kinds `plan`, `decision`, `test`, and `approval`. New records
are immediately `open`; the only transition is to `answered`. Each record owns
its proposal and answer. A Goal-bound Test approval is handled in
`packages/agent-shell/app/server.mjs` and closes that Goal.

`packages/agent-shell/app/public/ask-core.js` projects every open Request to an
Ask. `packages/agent-shell/app/public/work-desk-view.js` then includes every Ask
in `For you` and the global count. The full Request modal concatenates proposed
transition, question, and detail. It has no launch target and its primary
button only closes the modal.

This directly explains the screenshots: detail text can name a worktree and
manual steps, but the Request model cannot represent whether those steps were
performed or where the usable result is.

### The product already separates Request, Ask, and Goal

`packages/agent-shell/app/public/prompt-bestiary.js` defines a Request as a
durable question, an Ask as one actionable `For you` row, and a Test as a
Request asking Julian to evaluate a reviewed result. ADR-0027 requires every
`For you` row to be a direct ask. ADR-0029 makes the brain the controller of
managed work and makes answers durable brain notices. ADR-0024 keeps a reviewed
Goal open until its Goal-bound Test is approved.

The proposed readiness state fits these existing boundaries: not every durable
Request must currently project to an Ask.

### Brain work is orchestration, not implementation

The brain prompt and `brain-prompt.test.mjs` require the brain to delegate
investigation, design, implementation, test, and review. Workers report facts;
the brain chooses transitions. Making the brain itself run setup commands would
reverse that boundary. The coherent pattern is a delegated preparation
assignment whose report allows the brain to expose the Request.

### Areas and Programs already hold setup knowledge and mechanism

`packages/agent-shell/app/workspace/AGENTS.md` tells agents to read the Area's
repository/worktree Resource and to inspect Programs before starting servers or
watchers. `packages/agent-shell/app/programs.mjs` resolves Area Resources,
parses `.processes.json`, and exposes processes, commands, triggers, their
working folders, deterministic tmux sessions, availability, and live state.
The Programs UI can start, stop, restart, and open retained sessions.

Programs therefore cover the reusable mechanism in the motivating case. They
do not describe a product-specific route or what Julian should verify, and not
every Area has one. Treating Programs as preferred but optional preserves their
current meaning and avoids blocking useful handoffs on configuration work.

### Existing guidance already has one narrow preparation precedent

ADR-0025 and the brain prompt require `tangent shell rebuild` before exposing a
visible Agent Shell change. This proves the product value of preparation before
an ask, but it is a Tangent-specific fixed recipe. Generalizing the literal
command would not work across Areas; generalizing the responsibility does.

## Complete workflow analysis

Representative web feature flow:

1. An implementation and agent review finish. The Goal remains open with its
   reviewed verdict.
2. The brain creates a Test Request in `preparing`, tied to that Goal, and
   delegates a bounded preparation assignment. The Goal view says `Preparing
   review…`; `For you` is unchanged.
3. The worker reads the Area Resources and repository instructions, runs
   `tangent process list`, reuses or starts the relevant Program when present,
   and checks the actual route. It does not invent a second server if one is
   already managed.
4. The worker reports the exact target, a short statement of what is ready,
   optional Program identity, checkout identity when material, and verification
   time. The brain updates the Request to `ready`.
5. `For you` gains one row and the count increments. Julian presses `Review`.
   The native shell opens the checked URL externally (or navigates to a file or
   Tangent session) only on that action.
6. Julian returns and presses `Approve` or `I want changes`. The Request becomes
   `answered`, leaves `For you`, enters Recent results, and sends the existing
   durable notice. Approval closes the Goal; changes keep it open.
7. Process lifetime remains Program policy. Answering a Request must not kill a
   shared development server. Julian or a later explicit lifecycle policy can
   stop it.

Failure and recovery:

- Setup failure keeps the Request out of `For you`, records an actionable error,
  and notifies the brain. The brain retries with a worker, changes the proposed
  handoff, or asks Julian only if a true choice or permission blocks recovery.
- If a known Program stops after readiness, the UI can derive staleness and
  replace `Review` with `Repair review`. The Request remains unanswered.
- A failed external open reports the target and offers retry/copy. It does not
  answer the Request.
- Repeated readiness updates are idempotent for the same Request and replace
  its preparation attempt facts; they never create a second Request.
- If Julian asks for changes, any later re-review uses a new Request or an
  explicitly reset revision. The first version should create a new Request so
  every answer remains attached to the exact proposal, matching ADR-0029.

Accessibility and efficiency:

- `Review` is an ordinary focused button with a descriptive accessible name.
- Readiness and failure are text, not color-only state.
- Approval remains separate from opening the target, preventing accidental
  approval from a navigation action.
- Keyboard activation follows existing button behavior. No automatic focus or
  window opening occurs on background state changes.

## Proposed domain and boundary

The durable shape should add only facts the Request authority cannot derive:

```ts
type RequestStatus = "preparing" | "ready" | "answered" | "cancelled";

type ReviewTarget =
  | { kind: "url"; url: string; label: string }
  | { kind: "file"; file: string; label: string }
  | { kind: "session"; session: string; label: string };

type Preparation = {
  summary: string;
  target?: ReviewTarget;
  programId?: string;
  checkout?: string;
  verifiedAt?: string;
  error?: { message: string; attemptSession?: string };
};
```

The exact persisted field names are implementation detail, but these invariants
are architectural:

- only `ready` Requests project to Ask/`For you`;
- a visible Test promising an interactive result needs a target and verification
  claim before readiness;
- text-only plan, decision, and approval Requests can be created ready;
- answer is valid only from `ready` (legacy open records migrate as ready);
- Request identity owns preparation attempts and the eventual answer;
- Program liveness is derived from Programs by `programId`, not copied into the
  Request record;
- Goal status is not copied into Request state.

Representative agent-facing intent should remain small. The caller creates a
preparing Test, then reports readiness or failure for that Request. It supplies
the checked target because Agent Shell cannot derive product routes. The server
derives Area, Request ownership, current Goal, Program liveness, timestamps,
and valid state transitions.

Mutation retries require Request identity. Mark-ready is idempotent when the
same normalized handoff is already ready. A different handoff after readiness
is a revision and should return the Request to preparing or require an explicit
replacement; silently changing what Julian is approving is invalid.

## Candidate designs

### A. Improve prompt prose only

Tell brains to put better setup instructions in `detail`.

For: very cheap and no persistence change.

Against: it still delegates setup to Julian, cannot represent readiness or a
launch action, and continues admitting unusable rows to `For you`. This does
not solve the root problem.

### B. Require a structured review recipe on every Area

Add commands, ports, routes, health checks, and teardown rules to an Area
manifest. Agent Shell executes the recipe before exposing the Request.

For: deterministic, automatable, and potentially reusable without an agent.

Against: commands and health checks do not encode navigation or human judgment;
multi-service and native-app workflows quickly create a deployment DSL. It
makes Areas without configuration second-class and couples untrusted command
execution to the shell controller. The observed variation does not justify
this abstraction.

### C. Prepared Request, using agent judgment and existing Programs (selected)

The brain delegates preparation. A worker uses Area knowledge and Programs,
then attaches a checked target to the Request and marks it ready.

For: directly protects `For you`, works with current repositories, reuses live
process visibility, and does not require Agent Shell to understand each product.
It preserves the brain/worker boundary.

Against: readiness is an agent claim and one-off setup has weaker liveness
tracking than Programs. It adds one Request lifecycle transition and a small
target contract.

### D. Create the Request only after setup

Keep the current `open -> answered` lifecycle and tell the brain to prepare
first.

For: smallest storage and UI change.

Against: preparation becomes invisible and has no durable causal identity;
failures can be lost across brain handover, and Agent Shell cannot show
`Preparing review…` on the Goal. It also cannot attach setup attempts to the
eventual approval. This is the strongest simpler alternative, but it weakens
recovery enough to reject for asynchronous agent work.

### E. Auto-open every ready result

For: literally removes the click and can feel magical for one result.

Against: readiness commonly happens while Julian is typing elsewhere, away, or
receiving a batch. It steals focus, produces stale tabs, and has no clear
behavior for non-URL targets. User-initiated one-click opening is safer and
still removes all setup work.

## Lens conclusions

### UI/UX

The common intent is to judge a result, not operate its environment. The review
target must therefore be the primary action, with approval kept distinct.
Preparation does not belong in `For you`; failure belongs with the work and
brain recovery. Recent results is warranted because answering currently makes
a row disappear immediately and the user needs a short confirmation surface.
It must remain visually subordinate and bounded.

### Architecture, types, and data

The brain owns the Request transition; the worker supplies evidence. Programs
own reusable process definitions and current liveness. Goals own completion.
The Request owns only its proposal, preparation result, state, and answer.
These facts must not be copied across records. Readiness makes an invalid Ask
unrepresentable in the existing projection.

### API

The boundary expresses caller intent (`prepare`, `ready`, `failed`) rather than
shell commands. It accepts only typed launch targets, excludes arbitrary
user-facing command execution, and derives timestamps and ownership. Request ID
makes retries and answer causality unambiguous. Changing a ready target is not a
silent update because it changes what Julian is asked to approve.

### Operations

Preparation is asynchronous and observable through Goal/Request state. A setup
agent owns retries while live; the brain owns the broader recovery decision.
Known Program liveness is derived and can stale a handoff. Shared Program
processes survive Request answers. Operation and Request IDs connect setup logs,
failures, readiness, opens, and answers without inventing another run history.

## Migration and compatibility note

No separate migration lens was required because this is private local state and
the server/browser/CLI ship together. Compatibility is still simple: stored v1
Requests with `status: "open"` read as `ready`; stored `answered` Requests remain
answered. A schema revision writes the explicit new state only on mutation.
Legacy Markdown rows continue through their current projection and receive no
prepared target.

## Decisions

- Add readiness to Request, not Goal, Ask, or Program.
- Show only ready Requests in `For you`.
- Let plan and text decisions start ready; prepare visible Tests by default.
- Delegate preparation from brain to worker; do not make the brain operate the
  repository itself.
- Prefer existing Programs but permit visible one-off setup sessions.
- Store a typed checked target; do not expose arbitrary shell launch commands.
- Open targets only on Julian's action.
- Derive Program liveness and Goal state from their authorities.
- Retain answered Requests in a bounded Recent results projection.
- Do not stop shared processes when a Request is answered.

## Risks, assumptions, and open questions

- The phrase “checked target” remains judgment-based. A later design may add
  target-specific probes if repeated failures show a stable contract.
- Native/mobile/device review may need a fourth target kind. It should be added
  from a concrete workflow, not hidden inside a generic command target.
- Recent results needs a bounded product rule. A reasonable first choice is the
  latest five answers or seven days, whichever is smaller, with all durable
  history still available from the Area/brain record.
- One-off setup cannot be monitored after the worker exits unless its process
  becomes a Program. The UI must avoid claiming live status it cannot derive.
- If preparation agents consume too much time for trivial static results, the
  brain guidance must explicitly allow direct readiness when no setup improves
  the handoff.

## Sources

- `packages/agent-shell/app/brain-requests.mjs`
- `packages/agent-shell/app/brain-requests.test.mjs`
- `packages/agent-shell/app/server.mjs` (`brainPrompt`, request creation and
  answer handling, Goal-bound Test completion)
- `packages/agent-shell/app/public/ask-core.js`
- `packages/agent-shell/app/public/work-desk-view.js`
- `packages/agent-shell/app/public/prompt-bestiary.js`
- `packages/agent-shell/app/programs.mjs`
- `packages/agent-shell/app/public/program-view.js`
- `packages/agent-shell/app/workspace/AGENTS.md`
- `docs/decisions/ADR-0024-area-brain.md`
- `docs/decisions/ADR-0025-brain-writes-what-needs-julian.md`
- `docs/decisions/ADR-0027-for-you-rows-are-direct-asks.md`
- `docs/decisions/ADR-0029-brain-is-the-managed-work-controller.md`
