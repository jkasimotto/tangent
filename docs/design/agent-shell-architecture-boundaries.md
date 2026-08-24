# Agent Shell architecture boundaries

Date: 2026-08-24

## Problem

Agent Shell has outgrown the architecture of a small prototype server and one browser script. The visible symptom is factory functions with very large destructured parameters. The worst current example, `bindShellEvents`, accepts 115 named dependencies. That is not primarily an argument-count problem. It shows that file extraction did not establish ownership boundaries: a central module still knows and connects almost every state field, DOM element, renderer, selector, command, and side effect.

The same pressure exists on the server. `server.mjs` is 4,440 lines with 168 top-level functions. HTTP route tables have begun to move into modules, but the application operations passed to them still close over one module-global collection of vault, tmux, pipeline, brain, prompt, scheduler, and persistence behavior. A change can therefore cross domains without an explicit contract.

The goal is to make Agent Shell understandable and changeable by feature and domain. A developer should be able to alter Document reading, Goal execution, or brain coordination without receiving the entire browser or server as a dependency.

Constraints:

- Agent Shell remains the daily product, served by the existing Node server on port 4321.
- The server remains the only writer for normal vault mutations. The existing CLI stays a thin HTTP client, except for its documented `vault commit` and `study` exceptions.
- Vault Markdown, Git history, live tmux bindings, and `agent-pipeline.v1`, `area-brain.v1`, inbox, continuation, request, and rebuild records remain readable throughout the change.
- User workflows and durable facts must survive. Private JavaScript APIs, loopback HTTP shapes, file layout, and incidental behavior have no compatibility promise. The browser architecture can be replaced rather than preserved behind adapters.
- Abstractions must correspond to variation or ownership already visible in the code. Argument-count limits alone are not an architectural rule.

Non-goals:

- Changing the Area, Goal, Document, pipeline, brain, or request product concepts.
- Replacing Node HTTP, tmux, Markdown persistence, or Git. The recommendation may replace the current browser composition and rendering structure.
- Creating a generic dependency-injection container, event bus, repository per table, or class hierarchy.
- Splitting Agent Shell into new packages or services.

Success is observable when:

- No feature constructor receives unrelated feature capabilities. Its inputs fit into a small number of named ports whose members share one owner and lifecycle.
- Browser features own their event handling, rendering, and feature-local state transitions. The browser composition root constructs features and coordinates navigation; it does not forward individual functions between them.
- Server use cases depend on explicit vault, session-runtime, record-store, notification, and clock ports rather than module-global functions.
- HTTP adapters contain transport parsing and response mapping only. Domain and application operations are callable without an HTTP server.
- Persisted records have one reader/writer module each, and lifecycle transitions have one application owner.
- Durable-data and workflow acceptance tests continue to pass. Internal API and transport tests change when the new contract is better.

## Evidence

### Existing system

The browser is partly decomposed but still centrally owned:

- [`shell.js`](../../packages/agent-shell/app/public/shell.js) is 1,192 lines and remains the composition root, Markdown renderer, navigation coordinator, refresh controller, and source of many cross-feature selectors.
- [`shell-event-bindings.js`](../../packages/agent-shell/app/public/shell-event-bindings.js) accepts 115 destructured dependencies and is 931 lines. It owns a single document-level click handler that dispatches actions for rebuilding, prompts, Goals, Areas, Programs, brains, launches, Documents, comments, and modals.
- [`shell-interactions.js`](../../packages/agent-shell/app/public/shell-interactions.js) accepts 59 dependencies and is 828 lines. `work-desk-view.js`, `area-directory-view.js`, `document-reader-controller.js`, and `goal-launch-view.js` accept 20–30 each.
- The wiring itself reveals missing contracts. `shell.js` attaches unrelated capabilities as properties of the `humanName` and `commitActiveStep` functions with `Object.assign`. It passes a bag named `programById` to `bindShellEvents`, but that bag contains dock badges, Area folding, verdicts, launch selection, pipeline lookup, Work rendering, and describe-work queries. These values are service-locator workarounds, not Program behavior.
- Several extracted browser modules return dozens of functions, which `shell.js` destructures and passes into other modules. Moving a function to another file therefore has not moved responsibility or reduced the change surface.
- Browser tests strongly cover visible workflows and pure helpers, but the explicit architecture test only establishes small boundaries such as DOM lookup and refresh cleanup. Nothing prevents the composition root or event binder from absorbing the next feature.

The server has a similar partial decomposition:

- [`server.mjs`](../../packages/agent-shell/app/server.mjs) owns vault parsing and indexing, Git commits, tmux discovery and mutation, Goal lifecycle, prompt assembly and delivery, pipelines, continuations, brains, inbox delivery, voice actions, reconciliation, HTTP composition, and application startup.
- Route modules such as [`brain-routes.mjs`](../../packages/agent-shell/app/brain-routes.mjs), [`pipeline-routes.mjs`](../../packages/agent-shell/app/pipeline-routes.mjs), and [`work-mutation-routes.mjs`](../../packages/agent-shell/app/work-mutation-routes.mjs) are useful transport adapters. They receive operation records and do not reach into persistence directly. However, their operations are still closures assembled inside `server.mjs`; the application boundary stops at parsing the request.
- Moderate option records such as `spawnGoalSession(area, slug, options)` are not themselves evidence of a bad API. Their fields describe one launch operation and exclude many invalid inputs through earlier resolution. The concern is that the function also reads Goals, resolves launch policy, discovers sessions, mutates tmux, writes Goal ownership, commits the vault, builds prompts, and manages continuation callbacks. One operation owns too many mechanisms and failure boundaries.
- The server has important partial-success semantics that are currently implicit. For example, Goal binding and Git commit can fail after a tmux session is created; context continuation writes its record before spawning and kills the old session only after prompt confirmation. These are application workflows, not infrastructure helper details.

The architecture is also growing while it is being decomposed. Recent work introduced route factories, `createVaultRepository`, `createRuntimeScheduler`, `createStateEvents`, record modules, and pure domain modules, but new product behavior continues to enter both central roots. This is the right time to settle boundaries before extraction produces more parameter bags.

### Internal precedent

The strongest patterns already in the repository are small factories with cohesive ports:

- [`vault-repository.mjs`](../../packages/agent-shell/app/vault-repository.mjs) owns safe atomic Markdown writes and exact-path Git commits. It receives only `root`, `runGit`, and error reporting.
- [`runtime-scheduler.mjs`](../../packages/agent-shell/app/runtime-scheduler.mjs) owns non-overlapping task execution behind `wake`, `stop`, and `tick`, while callers supply task policy.
- [`state-events.mjs`](../../packages/agent-shell/app/state-events.mjs) owns the lifecycle of server-sent-event clients behind `connect` and `changed`.
- Route factories are transport-only adapters over named operations.
- Pure record and projection modules such as `pipeline-record.mjs`, `brain-record.mjs`, `goal-dependencies.mjs`, `desk-projection.mjs`, and browser `*-core.js` modules make invariants testable without tmux, HTTP, or the DOM.

These precedents are more suitable than introducing a new framework. They demonstrate the desired dependency direction: a small owner exposes a narrow capability record; orchestration depends on that record; mechanisms are supplied at construction.

### External precedent

No external framework or standard is decisive here. The applicable ports-and-adapters and functional-core patterns are already represented in Agent Shell's best modules. Internal consistency has more value than importing a marginally different convention.

### Implication

Agent Shell warrants a deliberate internal rebuild. The current browser composition should be replaced, not patiently wrapped. The server should be cut into owned capabilities until `server.mjs` contains composition and startup only. This is not a blanket conversion of long signatures to option objects and not a rewrite of durable storage or product concepts.

1. Define ownership around existing product capabilities.
2. Put state transitions in application services that depend on narrow mechanism ports.
3. Keep transport, persistence representation, and browser DOM at the edges.
4. Compose those owners once at startup.

## Principles

1. **Group by authority, not convenience.** A capability record is valid when one component owns all its members and their lifecycle. “Whatever this caller needs” is not a boundary.
2. **One owner per transition.** Starting a Goal, advancing a pipeline, handing over a brain, saving a Document, and answering a request each need one application owner that defines order, partial failure, and emitted invalidation.
3. **Representation becomes domain data once.** HTTP bodies, Markdown/frontmatter, JSON records, tmux output, and DOM datasets are untrusted edge representations. Parse them at their owning adapter or store before application logic uses them.
4. **Feature locality in the browser.** A feature should contain its selectors, rendering, event interpretation, and commands. Cross-feature coordination should use a small shell navigation contract or an explicit application command.
5. **Protect user data, not private plumbing.** Persisted facts and recoverable live work are expensive compatibility surfaces. The browser modules, internal factories, loopback endpoints, and CLI-to-server payloads can change atomically.
6. **Prefer explicit narrow ports over global access.** Direct imports are appropriate for pure functions and constants. Stateful mechanisms and side effects cross a named port so tests can replace them.

## Recommendation

Replace the current Agent Shell internals with a capability-owned modular monolith. Do not continue the present extraction style. Delete the giant dependency-bag factories and the global browser event switch instead of adapting them. Reduce `server.mjs` to startup and composition by moving complete workflows—not helper fragments—behind owned application capabilities.

This is a hard internal boundary reset with a narrow preservation rule:

- preserve vault content, Git provenance, live-work recovery, and accepted product behavior;
- freely break and replace private module APIs;
- freely change loopback endpoints and payloads when the new application contract is clearer, updating the in-repository browser and CLI in the same coherent change;
- remove the superseded path immediately after its replacement passes acceptance tests. Do not keep parallel internal architectures or indefinite compatibility shims.

### Server shape

`server.mjs` becomes startup and composition only. It constructs infrastructure adapters, application services, HTTP routes, background reconciliation tasks, and terminal transport. It does not contain domain workflows.

Use these capability owners:

- **Vault** owns Area, Goal, and Document representation, index queries, atomic writes, and provenance commits. Its public ports use domain-shaped inputs and results; Markdown parsing stays behind it.
- **Session runtime** owns tmux discovery, session creation/termination, option binding, pane state, prompt arming, prompt delivery, and message delivery mechanics. It does not decide Goal, pipeline, or brain policy.
- **Launch catalog** owns harness registry parsing, inherited launch resolution, and exact command selection.
- **Goal work** owns Goal start, reattach, ownership, collaboration, and completion workflows. It coordinates Vault, Session runtime, Launch catalog, and prompt builders.
- **Pipelines** owns pipeline record transitions, step scheduling, append/edit/control, and worker continuation. It calls Goal work through a narrow start/prime capability rather than reaching through its internals.
- **Brains** owns brain generations, requests, inboxes, notices, and brain handover. It uses Goal work and Pipelines only through explicit commands allowed by the brain policy.
- **Documents** owns reads, saves, comments, comment resolution, and the application decision to notify a brain.
- **Programs and triggers**, **voice**, and **shell operations** remain separate capabilities because they have distinct external mechanisms and lifecycles.
- **Snapshot projection** assembles the read model returned by `/api/sessions` from these capabilities. It derives display state and never mutates authoritative records.

These are logical ownership boundaries inside `packages/agent-shell/app`, not new packages. A capability may initially be one module or a small directory. Each factory takes a small environment record of ports that it actually uses and returns commands and queries named in the domain.

A representative application call should read like this:

```js
const goalWork = createGoalWork({ vault, sessions, launches, prompts, clock });
const pipelines = createPipelines({ store: pipelineStore, goalWork, sessions, notices, clock });

await pipelines.handover({ session, facts });
```

It should not receive `readAreaGoals`, `vaultCommit`, `listSessions`, `execFileAsync`, `pipelineStepPrompt`, `queueAgentMessage`, and `Date.now` as unrelated peer arguments. Those are members of owners or mechanisms.

Every multi-effect command returns a structured application result with an operation outcome and known partial effects. Expected conflicts remain typed/domain-coded until the HTTP adapter maps them to the chosen transport result. Unexpected errors retain their cause and operation identity for logs. The application service defines retry safety; HTTP routes do not retry mutations.

### Browser shape

Replace the current browser composition wholesale with feature controllers and a small shell context. Keeping plain JavaScript and direct DOM rendering is acceptable, but the existing `shell.js` wiring, `bindShellEvents`, `createShellInteractions`, function-property injection, and catch-all dependency bags are rejected architecture and should not survive the redesign.

The shell owns only:

- the API client;
- the top-level state store and refresh/invalidation lifecycle;
- navigation between Work, Areas, prompts, Document, and agent views;
- shared overlays such as toast and modal;
- terminal mounting;
- construction and disposal of features.

Each feature controller receives stable shared ports and its own DOM root. It owns delegated events within that root, renders its feature, and exposes only navigation-level commands. Suggested feature boundaries match existing product behavior: Work desk, Area directory, Goal launch, Programs, prompt bestiary, Document reader/comments, agent/terminal, and global shell chrome.

Representative composition:

```js
const shell = createShellContext({ api, state, navigation, overlays, terminal });

const work = createWorkFeature({ shell, root: screen });
const documents = createDocumentFeature({ shell, root: screen });
const chrome = createChromeFeature({ shell, elements: shellDom() });
```

`bindShellEvents` should not be replaced by `bindShellEvents({ work, areas, documents, ... })` with the same giant switch. Work controls are interpreted by Work; Document controls by Documents; global navigation and modal controls by chrome. If rendered screens share the same DOM root, the active feature owns one root listener during its mounted lifetime.

Shared derived data should be exposed as cohesive query ports rather than forwarded individual functions. For example, a `workModel` can expose `goal(file)`, `sessionForGoal(file)`, and `brainForArea(area)` if those queries share one snapshot and owner. A name formatter must remain only a formatter; capabilities must never be attached to functions. Generic bags such as the current `programById` workaround are prohibited because their members have no common authority.

Each feature owns its transient state from the start. The shell store holds only the current server snapshot, navigation, connectivity, and truly global overlay state. Durable or server-authoritative facts must not be duplicated into browser feature stores.

### Contracts and diagnosis

The following invariants become explicit:

- Vault is authoritative for Areas, Goals, Documents, and Goal ownership.
- Each record store is authoritative for its own persisted lifecycle. Snapshot projection derives `live`, attention, and display status from records plus current sessions.
- Session runtime is authoritative only for observed and commanded tmux state; it cannot declare a Goal, pipeline step, or brain complete.
- Goal work is the only owner of the ordered side effects for starting or reattaching Goal sessions.
- Pipelines and brains own their respective transition rules and persist the transition before issuing any irreversible follow-up required by their existing contracts.
- Browser state is a cache of server snapshots plus UI-only state. A successful mutation invalidates and refreshes; it does not invent durable success locally.

Every long-running or multi-step operation carries a stable domain identity in logs: Goal file/slug, pipeline step, brain Area/generation, session name, or rebuild operation id. Expected failures identify both the failed stage and any surviving useful state. Existing at-least-once brain notice delivery and continuation rollback semantics remain owned by their capability rather than generalized into a new event system.

## Decisions

### 1. Replace the browser architecture; extract the server by complete capability

**Recommendation:** Rebuild the browser composition as one coherent architecture change and delete the current wiring when its acceptance tests pass. On the server, replace one complete capability at a time because live-session and persistence workflows need bounded cutovers. Do not perform a file-by-file strangler migration that leaves both ownership models active.

**Best rejected alternative:** A uniform incremental strangler migration minimizes the size of every change and lets old and new code coexist until each caller moves.

**Decision:** Coexistence is exactly what would preserve the present coupling. The browser has no durable authority and only one user, so its composition can be replaced behind workflow acceptance tests with little compatibility cost. The server is different: it controls live tmux sessions and durable workflow records, so each server cut must preserve that capability's recovery semantics. Complete capability replacement is bolder and safer than either a whole-server rewrite or years of forwarding modules.

**User impact and cost:** Agent Shell may be temporarily unavailable during the coherent browser/server cutovers, and incidental UI details may change. There is no external consumer coordination cost. Reconsider an all-at-once server rebuild only if live workflows can first be drained and a complete recovery suite proves every persisted lifecycle outside the existing implementation.

### 2. Use cohesive capability records, not argument-count rules or a DI container

**Recommendation:** Constructors accept a small number of records named for real owners (`vault`, `sessions`, `launches`, `clock`, `notices`) and return domain commands/queries. Pure helpers are imported directly.

**Best rejected alternative:** Enforcing a low maximum signature size is simple and mechanically checkable. A general dependency-injection container would also eliminate large constructor lists.

**Decision:** A low count can be gamed by putting 115 unrelated values into one object—the current code already demonstrates this. A container hides dependencies and permits any feature to reach any service. Cohesive ports preserve explicit dependencies while allowing several related operations to travel together.

**User impact and cost:** Internal only. The main uncertainty is choosing boundaries too broad or too fine. Reconsider a capability split when its members have different lifecycles, authorities, or test replacements; merge ports when they always change and are replaced together.

### 3. Make feature controllers the browser unit of ownership

**Recommendation:** Co-locate rendering, event interpretation, and feature state transitions. Keep a small shell navigation/overlay context shared across features.

**Best rejected alternative:** Retaining one global delegated event handler avoids listener lifecycle bugs and makes all click behavior searchable in one file.

**Decision:** The handler now spans unrelated workflows and forces 115 dependencies into one scope. Searchability no longer compensates for the inability to change or test a feature locally. Root-level delegation remains, but at the active feature or chrome root rather than the whole product.

**User impact and cost:** Critical workflows must survive, especially draft preservation, navigation return points, terminal mounting, and mutation confirmation. Incidental DOM timing and handler structure may change. Migration risk is missed or duplicate listeners. Reconsider a single dispatcher only if measured browser behavior shows that feature mount lifecycles cannot safely retain delegation; even then, dispatch should route typed feature actions rather than call 100 closures.

### 4. Separate server application policy from mechanisms without splitting the process

**Recommendation:** Domain application services coordinate narrow Vault, session-runtime, launch, store, notice, and clock ports. Route adapters map HTTP only. Keep all capabilities in the existing process and package.

**Best rejected alternative:** The current module-scope closure model has low ceremony and makes sequential workflows easy to read in one file. Separate services can create forwarding layers and circular dependencies.

**Decision:** The demonstrated domains already have different authorities and recovery rules. Explicit ports make those rules testable and prevent circular access; application services may depend on lower mechanisms and on deliberately narrow commands from peer capabilities, never on peer internals. A process split adds failure and deployment modes without solving current ownership.

**User impact and cost:** No API change. Tests gain faster in-process coverage for failures that currently require HTTP/tmux fixtures. Reconsider a process boundary only if a demonstrated isolation, capacity, or independent-lifecycle requirement appears.

### 5. Preserve stored facts; break internal and loopback APIs when useful

**Recommendation:** Keep current record readers and durable schemas unless a demonstrated invariant requires a version change. Treat HTTP routes, browser-module exports, and CLI payloads as private. Replace them atomically when they obscure the new capability contract. Do not create compatibility adapters for callers that all ship from this repository.

**Best rejected alternative:** Preserving every route and response shape makes regression comparison easy and permits smaller mixed-version changes.

**Decision:** There are no external HTTP consumers to coordinate, and the browser, CLI, and server are one product. Preserving awkward transport shapes would turn accidental interfaces into permanent architecture. Persisted records are different because they contain your work and must survive restart and rollback. Compatibility follows the data, not every in-process or loopback call.

**User impact and cost:** The installed CLI and running server must be rebuilt/restarted together when their contract changes. A rollback must still read records written before the cut. Reconsider preserving a route only if a real external caller is discovered; reconsider a record schema only when the new owner cannot represent a required invariant safely in the old form.

### 6. Add architectural enforcement at demonstrated seams

**Recommendation:** Add focused tests or governance rules for dependency direction after a boundary exists: routes cannot import stores or tmux; browser features cannot import one another's internals; `server.mjs` and `shell.js` are composition roots; persisted record writes go through their owner. Do not enforce arbitrary file length or parameter count as correctness.

**Best rejected alternative:** File-size and arity limits give immediate, objective pressure against new monoliths.

**Decision:** They detect symptoms but incentivize forwarding modules and giant bags. Import and ownership rules protect the actual architecture. Arity and file size can remain review signals, not pass/fail laws.

**User impact and cost:** Governance failures make boundary violations visible during development. Reconsider a numeric limit if repeated regressions evade ownership rules and repository evidence establishes a useful threshold.

## Risks / open questions

- **The current worktree contains active, uncommitted Agent Shell changes.** This design reads the current checkout, including those changes. Before implementation, the owner must distinguish settled Area-trigger and brain/request work from transient edits so extraction does not freeze an incomplete contract. If those changes substantially replace Programs, request handling, or event dispatch, the affected boundary should be rechecked.
- **Goal work, Pipelines, and Brains can become a circular cluster.** The recommendation depends on one-way command contracts: Pipelines request Goal-session operations; Brains request approved Goal/Pipeline operations; completion facts return through notices rather than peer state access. If real workflows require synchronous bidirectional mutation, a single managed-work application service may be the more honest owner.
- **The browser uses one replaceable `screen` root.** Feature-owned listeners must have an explicit mount/dispose lifecycle or stable root-level filtering. If tests show listener churn causes lost draft or terminal state, keep stable controllers mounted and let only their render target change.
- **Snapshot size and refresh semantics are not redesigned.** Feature boundaries could tempt separate endpoint caches and duplicated authority. Keep the current whole snapshot until measured latency or payload cost justifies a read-model change.
- **JavaScript does not statically enforce port shapes.** Runtime contract tests and JSDoc may be sufficient. If capability mismatches remain a recurring source of failures after extraction, type-checking the app modules is worth a separate decision; it is not required for these boundaries.
- **Some current partial failures may be accidental rather than contractual.** Each extracted use case must characterize ordering before preserving it. If a sequence can leave an invalid durable state—for example, a live session with an unbound Goal—the design should record and decide that behavior rather than silently fossilize it.
