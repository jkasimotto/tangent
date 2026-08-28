# Area launch policy: design record

Date: 2026-08-28

Status: proposed. No code changes accompany this record. Step 2 of the Goal implements it.

Lenses applied: architecture, types, and data; API; migration and compatibility.

Intent: `user-intent.md` in this folder. This record replaces the per-Area default concept of `docs/design/agent-shell-work-contract/design-record.md` (decision D15, D16, D22) and amends ADR-0035 and ADR-0037. It does not reopen ADR-0040 (workers only send) or ADR-0041 (everything starts through the brain).

Vocabulary in this record. A **launch** is one `{harness, model?, effort?}` triple. A **policy** is the set of launches an Area allows in its subtree. A **memory** is the last launch that ran in an Area. The old word **default** is retired.

## 1. Problem contract

### 1.1 The blocked outcome

Julian works in two unrelated scopes, `otto` (personal) and `neara` (work). Each scope has its own harnesses: `neara` runs through gateways (`claude-gw`, `codex-gw`, `pi-code`), `otto` runs local `codex` and `claude-otto`. Today nothing stops a `neara` Goal from starting on `claude-otto`, or an `otto` Goal from starting on `claude-gw` with the Neara MCP config. The only thing that steers the choice is a per-Area **default**, and a default is a suggestion, not a fence.

The second problem is that defaults are configuration to maintain. Julian changes the harness he uses often. Each change today means an edit to a vault note through the `d` key, in two slots (brain and work). He wants the product to remember what he used last and offer that.

### 1.2 Constraints

- ADR-0041: only a brain starts workers. The entry points are `a` on an Area, the brain's `tangent goal create --start`, `tangent goal append`, `tangent goal replace-agent`, and Restart on a brain row.
- ADR-0035: a worker that names no `--launch` takes the calling brain's own launch. The record keeps this rule and adds one check to it.
- ADR-0040: a worker runs one command, `tangent send brain`. Workers never touch policy.
- The vault is Julian's memory (`project-trees-llm-as-ui` memory). Policy is knowledge about an Area, so policy lives in the Area note. Memory of what ran last is runtime state, so it does not go in the vault.
- Tangent never rewrites a harness command string (`harnesses.md` header). The policy only selects among registered launches.
- No global machine default. Commit `2a29e6d` and `launch-environment.test.mjs` ("nothing declared resolves to nothing, never to a profile guess") stay true.

### 1.3 Non-goals

- Per-user or per-caller permissions. There is one user. Caller identity stays audit provenance (ADR-0034).
- Cost limits, rate limits, or model quotas.
- Changing the harness registry format (`tangent.harnesses.v2`).
- `tangent study`. It spawns a hardcoded `claude` outside the server and registry (`packages/agent-shell/src/cli/commands/study.ts:39-53`). Section 9 records it as a known gap.

### 1.4 Success conditions

1. A launch that the Goal's Area does not allow is refused at the server with a named error, from every entry point, no matter what the browser or CLI sent.
2. `otto` cannot launch a `neara` harness and `neara` cannot launch an `otto` harness, proven by tests against the migrated vault notes.
3. Every launch selector opens on the last launch that ran in that Area (or the nearest ancestor), never on an unregistered or disallowed launch.
4. The `d` Defaults editor and the two default slots are gone. The five `tangent.environment.v1` blocks are migrated in one commit and the v1 reader is deleted.
5. Running sessions and historical Goals stay readable. Nothing rewrites an attempt snapshot.

## 2. Current system

All facts below are Observed on 2026-08-28 unless marked. Line numbers cite the working tree at that time.

### 2.1 Where the environment lives

There is no `~/.tangent/agent-shell/environment` store. The concept lives in two vault fences and one runtime snapshot.

| Concept | Location | Fence | Owner |
|---|---|---|---|
| Registry, machine-wide | `~/.tangent/trees/harnesses.md` | `tangent.harnesses.v2` (v1 read fallback) | `app/launch-environment.mjs` parse and write, `app/launch-catalog.mjs` I/O and resolution |
| Per-Area defaults | `~/.tangent/trees/<area>/<leaf>.md` under `## Development environment` | `tangent.environment.v1` | same two modules |
| Per-attempt snapshot | `~/.tangent/agent-shell/brains/<area>/brain.json` and `pipelines/<area>/<slug>.json` | `resolvedLaunch: {ref, command, label, sourceArea?, mode?}` | `brain-record.mjs:162-166`, `server.mjs:2901-2913` |

The v1 block shape (`launch-environment.mjs:226-248`, `launch-catalog.mjs:149-153`):

```json
{ "version": 1,
  "defaults": {
    "launch": { "harness": "codex", "model": "sol", "effort": "low" },
    "brain":  { "harness": "codex", "model": "luna", "effort": "low" }
  } }
```

`defaults.brain` can also be the string `"work"`. Unknown keys such as `paneConfigurations` round-trip.

Five notes declare a block today:

| Area | work | brain |
|---|---|---|
| `otto` | `codex/sol/low` | `codex/luna/low` |
| `otto/tangent` | `claude-otto/opus-5/medium` | `codex/sol/low` |
| `neara` | `pi-code/glm-5-2/medium` | `claude/sonnet-5/medium` |
| `neara/pgande` | `pi-code/glm-5-2/xhigh` | inherits |
| `neara/portland` | inherits | `claude/sonnet-5/medium` |

The tree root has no note, so the `@root` brain records `mode: "override"` and runs `codex-gw/sol/low` with `sourceArea: null`.

### 2.2 Resolution today

- Work: `inheritedLaunch` (`launch-environment.mjs:277-288`) walks `areaAncestors` (`area-agent-command.mjs:2-5`) most-specific first and takes the first `defaults.launch`. A malformed block anywhere in the chain is a named error.
- Brain: `inheritedBrainLaunch` (`:251-268`) does the same over `defaults.brain`; `launchCatalog.forBrain` (`launch-catalog.mjs:35-42`) falls back to the work launch, then errors.
- Every launch passes `resolveLaunch` (`launch-environment.mjs:129-152`), which never substitutes and names the unknown id.
- Workers: `materializeStepLaunches` (`server.mjs:2744-2773`) fills an unnamed step from the calling brain's current generation (`brainWorkerLaunch`). Its doc comment states: "A current brain caller can lend its own launch across Area boundaries." The Area declaration only produces a **warning** when an explicit `--launch` names a different harness (`:2765-2770`).

### 2.3 Every launch boundary

The launch-boundary map (agent report, verified against the tree):

| Entry point | Validation today | Spawn |
|---|---|---|
| `goal create --start --launch` | `goal.ts:299-305` syntax, `server.mjs:6832-6857` brain-only 403, `materializeStepLaunches`, `resolveStepLaunch` `server.mjs:2619-2624` | `spawnGoalSession` `server.mjs:2292` |
| `goal start` solo and `--step` | `launchCatalog.requested` 400, `missingStepLaunches` 400, `materializeStepLaunches` 409 | `spawnGoalSession` |
| `goal append --launch` | 403/409 guards, `materializeStepLaunches` | deferred to `startPipelineStep` |
| queue advance, `brain advance`, `goal start --recovery` | stored assignment replayed through `resolveStepLaunch` (409 on unknown id) | `spawnGoalSession` |
| `goal replace-agent` | `launchCatalog.requested` 400 `launch-invalid` `server.mjs:3811` | `spawnGoalSession` `server.mjs:3840` |
| `POST /api/goals/attempts/resume` | replays stored command, registry harness must have `resume` | types, never submits |
| `POST /api/brains/start` | `normalizedBrainChoice` `brain-routes.mjs:4-17`, `resolveBrainAttemptLaunch` `brain-launch.mjs:8-43`, registry re-check `server.mjs:4541-4544` | `spawnBrainSession` `server.mjs:4517` |
| brain auto-recovery | re-resolves the Area declaration on every wake (`server.mjs:4664-4667`) | `spawnBrainSession` |
| `POST /api/launch/default` | `resolveLaunch` plus inherited-chain check `launch-catalog.mjs:137-176` | none, writes v1 block |
| `tangent study` | none | `child_process.spawn` |

Three spawn functions funnel into `createOwnedTmuxSession` (`server.mjs:415-427`). Every path except `tangent study` re-resolves against the registry before a process exists. **No path checks the Goal's Area against the launch.** That is the gap.

### 2.4 Selectors

One picker, `public/goal-launch-view.js`, serves four targets. It loads `GET /api/launch/options?area=&kind=` (`:98-112`), where the server denormalizes the whole harness/model/effort cross-product (`launch-catalog.mjs:67-89`). The browser only indexes into those arrays. Client filtering is therefore already not the guard; `launchCatalog.requested` re-resolves every choice. The picker seeds from `options.default` (`:121-124`). The `d` key opens the default editor (`DEFAULT_AGENTS_TARGET`, `kind=all`), which writes through `POST /api/launch/default`.

### 2.5 Tests that pin the current shape

`launch-environment.test.mjs` (parse, inherit, upsert, no-guess rule), `launch-catalog.test.mjs` (brain then work then error; removed harness blocks fallback; non-otto inherited defaults), `launch-environment-http.test.mjs`, `brain-launch.test.mjs` (ADR-0037 override, `launch-changed` 409), `brain-worker-launch-http.test.mjs` (ADR-0035 lend), `cli-harness-spec.test.mjs` (`tangent harness list`), `launch-keyboard-ui.test.mjs`, `work-launch-touchpoint.test.mjs`.

### 2.6 History in one paragraph

`0c273d7` (2026-08-14) introduced the registry with two axes. `94f9b4f` added effort. `18822a5` and `70d230b` added inherited per-Area brain and work defaults. `2a29e6d` removed every runtime default: the server refuses a start that names nothing. `478de65` (ADR-0035) reversed that for the exact live brain: it lends its own launch. `14a8e21` (ADR-0041) moved every start behind the brain. The vault prose in `otto/otto.md:24` still says "Tangent supplies none and refuses a start without one", which is stale against ADR-0035.

## 3. Internal precedent

- **Nearest declaring ancestor wins** is the established inheritance idiom (`inheritedLaunch`, `inheritedBrainLaunch`, `areaAncestors`). The policy reuses the same walk.
- **Reject invalid records on read, never substitute** (`f3a9d59`, `resolveLaunch`). The policy parser follows this.
- **Optimistic concurrency by expected value**: `expectedLaunch` on brain start (`brain-launch.mjs:35-42`), `expectedRevision` on queue mutations. The selector's remembered launch uses the same pattern: what the UI showed is what the server checks.
- **Runtime state under `~/.tangent/agent-shell/` as one JSON per subject** (`brains/<area>/brain.json`, `pipelines/<area>/<slug>.json`, `session-owners/`). The memory store follows this layout.
- **Structured error codes** in route bodies: `{error, code}` with `launch-invalid`, `invalid-choice`, `launch-changed`, `override-retired` (`pipeline-routes.mjs:109-114`, `brain-routes.mjs`). The new refusal adds one code in the same shape.
- **Vault writes commit with provenance**: `saveDefault` commits `update: <area> default <kind> launch <label>` (`launch-catalog.mjs:171-174`). The policy writer keeps this.

## 4. External precedent

- **Allowlist by pattern with wildcard axes** (npm `engines`, Kubernetes image policy, Bazel visibility): a pattern that omits an axis matches all values of that axis. This keeps the common case (`codex`, all models, all efforts) one token long. Applies because the registry is a small fixed cross-product and a pattern is easy to read in a note.
- **Intersection down a hierarchy** (Bazel `visibility`, file-system permission narrowing): a child can only narrow what a parent allows. Applies because Julian's requirement is isolation between subtrees, and narrowing-only makes a parent's fence hold for every descendant without re-validation of children.
- **Most-recently-used as the offered choice** (editor "recent files", browser autofill): memory is derived from successful use, never set by hand. Applies because it removes the configuration burden that motivated the request.

## 5. Lens analysis

### 5.1 Architecture, types, and data

**Invariants.**

1. Every launch that reaches a spawn is registered (already true) **and** allowed by the Goal's Area (new).
2. The policy of an Area is the intersection of every declared `allow` on its ancestor chain, including itself. A child narrows, never widens.
3. Memory holds only launches that passed invariant 1 at the time they ran. On read, memory is filtered again against the current registry and policy.
4. Attempt snapshots (`resolvedLaunch`) are immutable and are never re-validated for reading. They are re-validated only when a new process would start from them.

**Ownership.**

| Fact | Owner | Store |
|---|---|---|
| What launches an Area allows | Julian, through the Area note | vault, `tangent.environment.v2` fence |
| What ran last in an Area | the server, on every successful spawn | `~/.tangent/agent-shell/launch-memory.json` |
| What one attempt ran | the server, at spawn | attempt snapshot, unchanged |
| What is registered | Julian, through `harnesses.md` | unchanged |

**Derived state.** The offered launch is derived: memory filtered by policy, then first allowed launch in policy order. Nothing stores "the offered launch".

**Where persisted text becomes a domain value.** `parseEnvironmentBlock` stays the one parser. It returns `{version: 2, allow: Pattern[]}` or a named error. A pattern is parsed with the same `parseLaunch` splitter the CLI uses (`goal.ts:299-305`), moved into `launch-environment.mjs` so the CLI and the server share one parser.

**Type shapes.**

```ts
type LaunchRef = { harness: string; model?: string; effort?: string };
type LaunchPattern = { harness: string; model?: string; effort?: string }; // omitted axis = any
type AreaPolicy = {
  area: string;             // the Area whose effective policy this is
  allow: LaunchPattern[];   // intersection result, in declaration order of the nearest declaring Area
  declaredBy: string[];     // every ancestor that contributed a fence, nearest first
  unrestricted: boolean;    // true when no ancestor declares; then every registered launch is allowed
};
type LaunchMemory = { [area: string]: { brain?: LaunchRef; work?: LaunchRef; at: string } };
```

**Coupling of policy and mechanism.** `launchCatalog` gets two new pure functions, `policyFor(area)` and `allowed(area, ref)`, plus an injected memory store. `resolveLaunch` stays policy-free. Spawn functions stay policy-free; they receive an already-checked launch as today.

**Concurrency.** Memory writes happen inside the same per-Area lock that guards brain and pipeline writes (`startBrainUnlocked`, `controlPipelineUnlocked` are already called under locks). A lost memory write is harmless: the next launch rewrites it.

**Counterexample checked.** Is a separate brain and work memory imagined variation? No. Four of five current declarations use different brain and work launches (section 2.1). Two memory slots per Area stay.

**Counterexample checked.** Does intersection break any current tree? `otto/tangent` declares `claude-otto/opus-5/medium` for work while `otto` declares `codex/sol/low`. Under intersection with patterns derived from defaults, `otto/tangent` would be empty. Migration therefore writes `allow` from the **union of every launch observed in the subtree** (section 8), not from the old defaults alone. After migration `otto` allows `codex` and `claude-otto`, `otto/tangent` declares nothing.

### 5.2 API

Representative callers after the change:

```sh
# brain on otto/tangent, names nothing: lends its own launch, checked against otto/tangent policy
tangent goal create --area otto/tangent --title "Fix the picker" --start --path ~/Projects/otto-tangent

# brain on neara names an otto harness: refused before any record exists
tangent goal append fix-the-picker --step "Review" --launch claude-otto/opus-5
# -> error: launch claude-otto/opus-5 is not allowed in neara/pgande
#    allowed by neara: claude-gw, codex-gw, pi-code

# browser opens the brain composer on neara/pgande
GET /api/launch/options?area=neara/pgande&kind=brain
# -> { harnesses: [only allowed harnesses, models, efforts], remembered: {harness, model, effort, source: "neara/pgande"|"neara"|null}, policy: {declaredBy: ["neara"], unrestricted: false} }
```

**Changed contracts.**

| Route | Change |
|---|---|
| `GET /api/launch/options` | `harnesses[]` is filtered to the policy. `default`, `workDefault`, `brainDefault`, `declarations` are removed. New: `remembered` (per `kind`), `policy`. |
| `POST /api/launch/default` | Retired, 410 `code: "defaults-retired"`, same pattern as `restart` (`server.mjs:3445`). |
| `POST /api/launch/policy` | New. Body `{area, allow: string[]}` where each string is `harness[/model[/effort]]`. 404 unknown Area, 400 `code: "pattern-invalid"` when a pattern matches nothing registered, 400 `code: "policy-widens"` when a pattern is outside the parent's effective policy, 409 `code: "policy-empties-child"` when a descendant's declaration would become empty. Writes the v2 fence and commits `update: <area> allowed launches <patterns>`. |
| `POST /api/goals/start`, `/api/goals/create`, `/api/pipelines/append`, `/api/goals/attempts/replace`, `/api/brains/start` | One new refusal: 403 `code: "launch-not-allowed"`, body `{error, code, launch, area, allowed: string[]}`. It fires after registry resolution and before any record or session. |
| `POST /api/pipelines/control` advance, recovery, brain auto-recovery | The same refusal, 409 with the same code, because the stored launch is now stale against policy. The assignment stays in place with the error recorded, like today's unknown-harness 409. |
| `tangent harness list` | Shows the allowed catalog for `--area`, marks the remembered launch, prints `declaredBy`. |

**Errors are actionable.** The refusal body names the launch, the Area, and the allowed patterns. The CLI prints the same three lines and exits 1. A brain can act on it (choose a different `--launch`) without reading the note.

**Idempotency and retries.** Unchanged. A refusal writes nothing, so a retry with the same `idempotencyKey` is safe.

**What the caller supplies.** Only the launch it wants. It never supplies the policy or the memory. The server derives both.

### 5.3 Migration and compatibility

**What must survive.** Five v1 fences, thirteen brain records with `resolvedLaunch`, 634+ assignments with snapshots, and every test in section 2.5.

**Authority per stage.**

1. Before the implementation commit: v1 is authoritative.
2. The implementation commit ships a one-shot vault migration, run once by the implementer (`tangent shell migrate-launch-policy`, or a script under `scripts/`). It rewrites the five fences to v2 and commits the vault with `update: launch policy replaces defaults`. From then on v2 is authoritative.
3. The server reads v2 only. A v1 fence after migration is a named error on read (`<area>: tangent.environment.v1 is retired, run the migration`), consistent with `f3a9d59`.

Reasoning: a lazy dual-read is not worth its permanent cost for five notes that Julian owns and one machine. Rollback is `git revert` of two commits (repo and vault).

**Seeding memory.** The migration seeds `launch-memory.json` from the newest brain generation per Area (`brains/*/brain.json`) for `brain` and the newest attempt per Area across `pipelines/*` for `work`, filtered by the new policy. Where nothing valid exists, the slot stays empty and first-use fallback applies.

**Deriving `allow`.** For each top-level Area (`otto`, `neara`): the union of harness ids from its old v1 defaults and from every snapshot under its subtree, filtered to harnesses that still exist in the registry. The migration prints the proposed fences and stops for confirmation before it writes, because this is Julian's fence.

Assumption: the resulting fences are `otto: [codex, claude-otto]` and `neara: [claude-gw, codex-gw, pi-code, claude, opencode]`. `claude` appears in neara's brain default today (`claude/sonnet-5/medium`), so `claude` is in both scopes unless Julian narrows it. The design does not decide this for him. The migration output makes it visible.

**Coexistence of old snapshots.** Snapshots are read as history without policy checks. A Goal whose queued next step names a now-disallowed launch fails at advance with `launch-not-allowed`, and the brain gets the message. That is the same behavior as a harness deleted from the registry today.

**Removal.** No temporary code remains after the commit except the migration command, which is deleted one release later.

## 6. Candidate designs

### A. Allow patterns in the Area note, intersection down the chain, memory in runtime state (selected)

Described above. Policy is vault knowledge, memory is runtime state, one check function at every boundary.

### B. Allow list only at top-level Areas, no inheritance

Simpler. Fails the done condition ("declares or inherits") and the stated need for child overrides. Rejected.

### C. Keep defaults, add a separate `deny` list

Two mechanisms, three slots per note. The default can still name a denied launch and needs a second validation. Julian asked to remove defaults. Rejected.

### D. Memory in the vault note (last-used written into `tangent.environment.v2`)

Keeps one store. But every launch would commit the vault, hundreds of commits per week of pure noise, and the `project-trees-llm-as-ui` rule keeps the vault free of runtime state. Rejected.

### E. Child policy replaces parent (override, not narrow)

Lets a child widen. Then `neara/pgande` could allow `claude-otto` and the `neara` fence holds only for Areas that do not override. Isolation becomes a per-note audit. The strongest rejected alternative. Rejected because the requirement is subtree isolation, and narrowing-only makes the top-level fence sufficient proof.

### F. One memory slot per Area (no brain/work split)

Cleaner UI. Counterexample in 5.1: four of five Areas pick different brain and work launches on purpose. Rejected.

## 7. Decisions

**D1. Policy lives in the Area note as `tangent.environment.v2`.**
Same fence location, same section, new shape: `{ "version": 2, "allow": ["codex", "claude-otto/opus-5"] }`. Decisive evidence: the vault is where Julian describes an Area, and the existing readers, writers, and commit path already target this fence.

**D2. A pattern is `harness[/model[/effort]]`; an omitted axis matches every registered value.**
Decisive: reuses the CLI `--launch` syntax and the `launchRef` rendering, so Julian reads and writes one form everywhere. A pattern that matches no registered launch is a write-time error.

**D3. Effective policy is the intersection of every declared `allow` on the ancestor chain. No ancestor declares means unrestricted.**
Decisive: subtree isolation must hold from the top-level note alone (candidate E rejected). Unrestricted-when-undeclared keeps test repos and fresh trees working without a note.

**D4. Policy applies to the full triple, not the harness alone.**
Decisive: the request names "harness/model/effort choices". A pattern of one token covers the common case, so full-triple scope costs nothing when unused.

**D5. Memory is per Area and per kind (brain, work), stored in `~/.tangent/agent-shell/launch-memory.json`, written by the server after every successful spawn.**
Read order for the offered launch: exact Area, then each ancestor, nearest first; the first entry that is registered and allowed wins; else first-use fallback. Decisive: memory as runtime state (candidate D rejected), two kinds (candidate F rejected), nearest-ancestor lookup matches the inheritance idiom so a new child Area starts on what its parent last used.

**D6. First-use fallback is the first pattern of the effective policy expanded to its first registered model and effort. Unrestricted policy with no memory offers nothing and the caller must choose.**
Decisive: pattern order is the only preference signal Julian writes, and "nothing declared resolves to nothing" stays true for an unrestricted tree.

**D7. Stale memory is filtered on read, never deleted eagerly.**
If Julian removes `claude-otto` from `otto`, the `otto/tangent` work memory `claude-otto/opus-5/medium` no longer passes and the ancestor `otto` memory is offered instead. If he re-adds it, the old memory returns. Decisive: no write is needed when policy changes, and no information is lost.

**D8. One check function, `launchCatalog.allowed(area, ref)`, is called at every boundary after registry resolution and before any write.**
Sites: `materializeStepLaunches` (covers create, start solo, start steps, append), `resolveStepLaunch` (covers advance, recovery, queue progression), replace-attempt after `launchCatalog.requested` (`server.mjs:3811`), `resolveBrainAttemptLaunch` for every brain start and auto-recovery, and `saveMemory`. Decisive: these are the exact sites the boundary map found, and each already has a named-error return path. Attempt resume is not a launch (it retypes a snapshot and never submits) and is not checked.

**D9. ADR-0035 stays, with one added check. A brain that names no `--launch` lends its own launch only when the Goal's Area allows it; else the start is refused with `launch-not-allowed` and the brain must name a launch.**
Decisive: `materializeStepLaunches` today lends across Area boundaries on purpose. The `@root` brain on `codex-gw` creating a Goal on `otto` would pass `codex-gw` into the `otto` subtree. The check closes this without changing what a brain has to type in the common case.

**D10. ADR-0037 stays. A user's one-attempt brain choice is checked against the Area policy like any other launch.**

**D11. Enforcement precedes UI filtering, and the UI also filters.**
`GET /api/launch/options` returns only allowed launches so the picker cannot offer a refused choice. The server check in D8 is the guard; the filter is a convenience. A test posts a disallowed launch directly to each route and expects 403.

**D12. `POST /api/launch/default` and the `d` Defaults editor are retired. The `d` key opens the policy editor for the cursor Area.**
The editor shows the effective policy, which ancestor declared each line, and lets Julian edit this Area's own `allow` lines. It writes through `POST /api/launch/policy`. Decisive: one key, one surface, and the key already means "agents for this Area" in Julian's muscle memory.

**D13. A policy write that would empty a descendant's effective policy is refused with the descendant named.**
Decisive: an empty policy is a dead subtree. Refusing at write time is cheaper than refusing at every later launch.

**D14. Migration is eager, one commit per repository, confirmed by Julian on the printed fences.**
See section 5.3.

**D15. The vault prose in `otto/otto.md:24` and the root `AGENTS.md` launch sentence are rewritten in the migration commit** to say: "No `--launch` lends your own harness when this Area allows it."

## 8. Migration plan

1. Ship the code: v2 parser, policy functions, memory store, route changes, retired route, tests. The server refuses to serve an Area whose note still carries v1 (named error), so the migration must run before the restart.
2. Run `tangent shell migrate-launch-policy --dry-run`. It prints, per top-level Area: the derived `allow` patterns, which snapshots contributed each harness, and the seeded memory per Area and kind.
3. Julian narrows or confirms. Run without `--dry-run`. It rewrites the five fences (three become empty and are removed from the note if the Area no longer declares), commits the vault, and writes `launch-memory.json`.
4. Restart the Agent Shell server (memory `restart-tangent-after-merge`).
5. Prove: `tangent harness list --area neara/pgande` shows no `claude-otto`; `tangent goal append <neara-goal> --step x --launch claude-otto` exits 1 with `launch-not-allowed`; the brain composer on `otto/tangent` opens on `codex/sol/low`.
6. One release later, delete the migration command.

## 9. Risks, assumptions, unknowns

- **Assumption:** Julian wants `claude` (plain, `~/.claude`) in `neara` only. Today `neara` brains run `claude/sonnet-5`. The dry-run makes this visible; the design does not decide it.
- **Risk:** intersection with a parent that lists full triples and a child that lists harness-only patterns is fine (child narrows to the parent's triples). The reverse, parent harness-only and child full triple, is also fine. Two full triples that differ are empty and D13 refuses the write. Tests must cover all three.
- **Risk:** the memory write after spawn adds one file write on the hot path. It is one small JSON under an existing lock. Acceptable.
- **Known gap:** `tangent study` spawns a hardcoded `claude` outside every boundary. It is not a Goal launch and has no Area. Out of scope, recorded so it is not mistaken for enforcement coverage.
- **Unknown:** whether the `@root` brain needs a policy. The tree root has no note. Decision by omission: the root is unrestricted, and its lent launch is checked against the target Area (D9), which is where isolation matters.
- **Weak evidence:** the count of harnesses per subtree in snapshots was not tallied in this design. The dry-run output is the tally.
- **Reconsider when:** a second user or machine shares the vault (policy would need caller scope), or the registry grows past what one note line can list (a named policy set in `harnesses.md` would then earn its place).

## 10. Implementation boundary for step 2

In scope: `app/launch-environment.mjs` (v2 parse and write, shared `parseLaunch`, pattern match, intersection), `app/launch-catalog.mjs` (`policyFor`, `allowed`, `remembered`, `options` shape, `savePolicy`, memory store injection), `app/launch-memory.mjs` (new, one JSON store), `app/server.mjs` at the D8 sites and route handlers, `app/launch-routes.mjs`, `app/brain-launch.mjs`, `public/goal-launch-view.js` (policy editor replaces default editor, seed from `remembered`), `public/work-desk-view.js` (`expectedLaunch` from `remembered`), `src/cli/commands/goal.ts` (import shared parser, print refusal), `src/cli/commands/harness.ts`, a migration command, tests listed in 2.5 updated, new tests: otto/neara isolation from migrated fixtures, intersection cases, stale-memory fallback, 403 at every route with a direct POST, D13 refusal.

Out of scope: registry format, `tangent study`, attempt resume, ADR-0040/0041 surfaces, visual redesign of the picker.

Docs to update in step 2: a new ADR (Area launch policy replaces defaults; amends ADR-0035, ADR-0037), `docs/design/agent-shell-work-contract/design-record.md` D15/D16/D22 marked superseded, root vault `AGENTS.md` launch sentence, `~/.tangent/trees/README.md` if it names defaults.

## 11. Sources

- `packages/agent-shell/app/launch-environment.mjs:10-17, 44-87, 102-152, 159-211, 218-288`
- `packages/agent-shell/app/launch-catalog.mjs:15-176`
- `packages/agent-shell/app/server.mjs:415-427, 2292-2420, 2619-2624, 2727-2773, 2803-2814, 2901-2913, 3395-3446, 3772-3894, 4517-4590, 4624-4707, 4976, 6467-6558, 6643-6684, 6832-6874`
- `packages/agent-shell/app/brain-launch.mjs:8-43`, `brain-routes.mjs:4-67`, `launch-routes.mjs:5-33`, `pipeline-routes.mjs:5-115`, `pipeline-record.mjs:242-271, 477-521, 713-729`, `brain-record.mjs:62-70, 162-166`, `agent-command.mjs:2-7`
- `packages/agent-shell/app/public/goal-launch-view.js:98-166, 312-390, 448-513, 589-674`, `work-desk-view.js:614-641`, `shell-event-bindings.js:1808-1830`
- `packages/agent-shell/src/cli/commands/goal.ts:76-108, 154-179, 212-216, 258-305, 514-555`, `harness.ts:28-71`, `study.ts:17-53`
- `~/.tangent/trees/harnesses.md`, `otto/otto.md:24-42`, `otto/tangent/tangent.md:109-125`, `neara/neara.md:46-62`, `neara/pgande/pgande.md:58-69`, `neara/portland/portland.md:50-61`
- `~/.tangent/agent-shell/brains/*/brain.json` (thirteen records, values in section 2.1)
- ADR-0023, ADR-0034, ADR-0035, ADR-0037, ADR-0040, ADR-0041; commits `0c273d7`, `94f9b4f`, `18822a5`, `2a29e6d`, `70d230b`, `478de65`, `14a8e21`, `f3a9d59`
- `docs/design/agent-shell-work-contract/design-record.md` (D15, D16, D22, lines 696-711), `docs/design/brain-launch-keyboard/design-record.md`
