# Price every job across providers and show it (design pass B)

Goal: [[goal-price-every-job-across-providers-and-show-it]]
Brief: `~/.tangent/trees/otto/tangent/records/cost-attribution-brief.md`
Branch: `dev/cost-attribution`

This is an independent second design of the same problem. Pass A wrote
`docs/design/cost-attribution/design-a.md`. This document was written without
reading it.

## 1. The problem

Julian runs work across three harnesses. Claude Code reports a dollar. Codex
and pi report token counts. Nothing in Tangent turns any of this into the cost
of a Job.

Four results are wanted:

1. A `provider` dimension beside harness, model and effort, correct in the data
   and absent from the UI.
2. A cost for any Job, from whatever its harness recorded, including subagents.
3. A small estimated cost in the Tangent top bar, with a hover breakdown, and
   no button press.
4. Statuslines for codex and pi-code that show the same four facts as Claude
   Code: dollar, context, directory and model.

### Success conditions

- A Job record can produce a dollar figure and the tokens behind it.
- The figure names its source and names what it leaves out.
- The top bar shows the figure without a request from the user.
- The three statuslines agree on which four facts they show.

### Non-goals

- No provider selector, and no provider column, in any view.
- No change to how a launch command is composed.
- No new eval or usage surface.
- No spend enforcement, and no budget.

## 2. What the system does today

**Observed.** The launch axes live in `packages/agent-shell/app/launch-environment.mjs`.
`resolveLaunch` joins a harness command with model arguments and effort
arguments, and returns `{ command, label, harness, model, effort }`. The
machine registry is a fenced JSON block, `tangent.harnesses.v2`, inside the
vault Document `~/.tangent/trees/harnesses.md`. `parseHarnessRegistry` reads
it and `validateHarnessRegistry` rejects a bad one.

**Observed.** A Job record lives at
`~/.tangent/agent-shell/pipelines/<area>/<slug>.json` with `schema: "job.v1"`.
Each attempt stores `resolvedLaunch.ref` as `{harness, model, effort}`, a
`providerSession` of `{provider, id}`, a `cwd`, a `startedAt` and an `endedAt`.
The field named `providerSession.provider` holds the harness id, for example
`claude-otto`. It does not hold a provider.

**Observed.** Each attempt also stores `contextFill` as
`{usedTokens, windowTokens, at}`. `server.mjs:4763` writes this inside the
reconcile loop from `live.context`. `live.context` comes from
`packages/agent-shell/app/pane-state.mjs`, which matches a regular expression
against the text on the tmux pane. The Claude pattern is
`/\((\d+(?:\.\d+)?)k\/(\d+(?:\.\d+)?)k\)/`, and its comment states that it
reads Julian's own statusline configuration. The codex entry has no `context`
member at all.

**Observed.** `packages/agent-shell/app/transcript-tail.mjs` resolves a
transcript for liveness only. It reads the last row and returns
`outputTokens`. No caller uses that field. The pi branch joins
`~/.pi/agent/sessions/<id>.jsonl`, which is not where pi writes.

**Observed.** Tangent already keeps its own facts as tmux user options on each
session: `@tangent_area`, `@tangent_goal`, `@tangent_launch_ref`,
`@tangent_attempt` and more. `server.mjs:470` reads all of them in one
`list-sessions` call.

**Observed.** The browser reads one immutable Work snapshot.
`packages/agent-shell/app/work-model.mjs` validates it with `exactKeys` on
every row, holds a 512 KB target and a 1 MB hard limit, and names the schema
`agent-shell-work.v3`. `packages/agent-shell/app/work-publisher.mjs` suppresses
a candidate whose semantic hash did not change.
`packages/agent-shell/app/public/refresh-lifecycle.js` refreshes on an SSE
`changed` event from `/api/events` and on a 30-second timer.

**Observed.** The only rate table in the repository is
`packages/eval/src/core/cost.ts`. It covers Claude models only, it approximates
cache writes at 1.25 times input, and it returns `undefined` when any model has
no rate. `packages/usage/src/pricing/index.ts` is an unused stub whose
`UsagePricingInput` already carries `provider` and `model`, and whose
`UsageCost` already carries `priced` and `unpricedModels`.

## 3. Measurements that changed the design

Six measurements moved this design away from the obvious answer.

### 3.1 The Claude transcript is not a complete billing record

I priced 249 Claude sessions that carry a `{"type":"cost-state"}` record, and
compared the result against the ledger in that record.

Every session with no subagent files matched the ledger to four decimal places.
Sessions with subagent files under-reported. The common range is 4 percent to
26 percent low. Session `ca9f2555`, which is step 1 of this Goal, came out at
21.5429 dollars against a ledger of 23.9491.

A per-model diff shows why. Two model rows appear in the ledger and never
appear in the transcript at all:

- `claude-haiku-4-5-20251001`, about 900 to 5,000 input tokens and about 30
  output tokens per session. This is background work by the harness. It costs
  about 0.002 dollars.
- `claude-opus-5[1m]`, the one-million-context billing variant. On session
  `f3aeb35e` it holds 25,644 input tokens and 38,809 output tokens. On session
  `7d64953a` it holds 14,472 input and 22,020 output.

**Decision.** Prefer the harness ledger. Recompute only where no ledger exists,
and record which source produced the number.

### 3.2 Last occurrence, not first, and only for subagents

On session `ca9f2555` the main transcript gives the same totals whether you
keep the first or the last row for each `message.id`. The subagent files do
not. First occurrence gives 862 output tokens. Last occurrence gives 2,423.

**Decision.** Always take the last row for each `message.id`. The rule costs
nothing on the main transcript and is required on subagent files.

### 3.3 The two token conventions are real and opposite

Codex, one session: `input_tokens` 102,630,487 with `cached_input_tokens`
100,979,072 inside it, and `total_tokens` 102,875,265, which equals
`input_tokens` plus `output_tokens`. So codex counts cache inside input, and
counts reasoning inside output.

pi, one message: `input` 48, `output` 727, `cacheRead` 16,064 and
`totalTokens` 16,839. The three parts add up. So pi counts cache outside input.

pi does this even for an `openai-completions` provider. pi already normalises
the OpenAI convention into the Anthropic one.

**Decision.** Adopt pi's convention. `input` means the tokens charged at the
full input rate. The codex reader subtracts `cached_input_tokens` from
`input_tokens`.

### 3.4 Codex per-turn usage reproduces the cumulative counter exactly

On one rollout with 815 `token_count` events, 768 distinct `last_token_usage`
values summed to `input_tokens` 102,630,487, `cached_input_tokens`
100,979,072, `output_tokens` 244,778 and `reasoning_output_tokens` 76,220.
Every one of those four matched the final `total_token_usage` to the token.
Only `total_tokens` differed, by 129,720.

**Decision.** Read the last `token_count` event for a session total. If a
session changed model, sum the distinct `last_token_usage` values instead.
Never use `total_tokens`.

### 3.5 The pi path rule

I read the `cwd` from the first line of one session file in each of the 51
directories under `~/.pi/agent/sessions/`. Then I compared it with the
directory name. The rule `"-" + cwd.replaceAll("/", "-") + "--"` matched 51 of 51.

The file inside is `<timestamp>_<uuid>.jsonl`, not `<uuid>.jsonl`. The current
code in `transcript-tail.mjs` therefore never resolved a pi transcript.

### 3.6 The census of what is reachable

Across 644 stored attempts in `~/.tangent/agent-shell/pipelines`:

| Harness | Attempts | With a stored conversation id |
|---|---:|---:|
| codex | 136 | 0 |
| pi-code | 121 | 95 |
| codex-otto | 110 | 0 |
| (no `resolvedLaunch`) | 83 | 0 |
| claude-otto | 74 | 72 |
| codex-gw | 73 | 0 |
| claude | 42 | 38 |
| claude-gw | 5 | 0 |

Codex stores no id because it takes none at launch. `findCodexRollouts` in
`harness-conversation.mjs` already finds a codex rollout by folder and start
time, so those 246 attempts are reachable.

The 73 `codex-gw` and 5 `claude-gw` attempts fail for a smaller reason: their
registry entries carry no `transcripts` field. The wrapper source at
`~/.local/share/uv/tools/neara-harness/.../harnesses/codex.py` states that "the
gateway variant runs on the real `CODEX_HOME`". The Claude Code wrapper states
that it "runs on the real `~/.claude`". Both gateway harnesses write to the
ordinary folders.

**Decision.** Add `"transcripts": "~/.codex/sessions"` to `codex-gw` and
`"transcripts": "~/.claude/projects"` to `claude-gw`. This recovers 78
attempts. It leaves 83 legacy attempts and the `opencode`, `agy` and `agyd`
harnesses unreachable.

## 4. Decisions

### D1. Provider is a registry field, and it stays out of the launch reference

Provider is observable, not invented. A codex rollout header carries
`model_provider`, which reads `openai` on one thread and `litellm` on a
gateway thread. Every pi assistant message carries `provider`. The pi model
option in the registry already writes `--provider resetdata-glm` inside its
`args` string.

Add an optional `provider` to a harness entry and to a model option. A model
option wins over its harness, because one pi harness reaches three providers.
`resolveLaunch` returns `provider` beside `harness`, `model` and `effort`, and
`resolvedLaunch.ref` records it at launch time. History then stays correct when
the registry changes later.

**Do not put provider inside `launchRef()`.** That function produces the
string `harness/model/effort`. `parseLaunch` rejects a string with more than
three parts. That string is stored in the tmux option `@tangent_launch_ref`, in
every Area harness contract `allow` list, and in `~/.tangent/agent-shell/launch-memory.json`.
A fourth part breaks all three. Provider travels beside the reference.

Provider does not enter the Work snapshot. `validateWorkCandidate` uses
`exactKeys`, so a new field is a schema change, and Julian asked for no UI
exposure.

**Rename the collision.** `attempt.providerSession.provider` holds a harness
id. Rename the field to `harness`, keep reading the old name, and never write
it again. Two meanings of one word in one record is a defect that a later
reader will act on.

### D2. The price table is a vault Document, not a package

Create `~/.tangent/trees/pricing.md` with a fenced `tangent.pricing.v1` block.
Read it with the existing `fencedBlock` helper. Validate it the way
`validateHarnessRegistry` validates the registry.

Four reasons:

- `harnesses.md` is the exact precedent. It is a machine-wide registry in a
  vault Document, parsed from a fenced block, and it applies to the next launch
  without a restart.
- Julian can correct a rate himself. Codex ships no prices, so somebody must
  type them, and the person who types them is him.
- Git records when a rate changed, which is what a historic figure needs.
- `packages/agent-shell/app/` is plain `.mjs` with no build step. A compiled
  TypeScript package on that path adds a build to every edit of the app.

**Rejected: a new `@tangent/pricing` platform package.** It holds about 40
lines of arithmetic. It needs four other changes to exist: an entry in
`allowedPackageDeps` in `packages/governance/src/index.ts`, an edit to
`docs/architecture/package-boundaries.md`, an ADR, and a build in the hot path. The authority for a price is the table,
not the code that multiplies it. Eval and Usage can read the same Document
later without moving that authority. If three readers of the arithmetic appear,
extract the package then, with evidence.

The block holds one entry per provider, and one entry per billing SKU inside
it:

```json
{
  "version": 1,
  "currency": "USD",
  "providers": {
    "anthropic": {
      "models": {
        "claude-opus-5": { "input": 5, "output": 25, "cacheWrite5m": 6.25, "cacheWrite1h": 10, "cacheRead": 0.5 },
        "claude-sonnet-5": { "input": 2, "output": 10, "cacheWrite5m": 2.5, "cacheWrite1h": 4, "cacheRead": 0.2 }
      },
      "surcharges": { "inferenceGeoUs": 1.1, "webSearchRequest": 0.01 }
    },
    "resetdata": {
      "models": {
        "zai/glm-5.2": { "input": 1.58, "output": 4.96, "cacheRead": 0.16, "cacheWrite": null }
      }
    },
    "openai": { "models": {} }
  }
}
```

Every number is dollars for one million tokens, except a surcharge. A `null`
rate means unknown. An absent model means unknown. Neither means zero.

`openai` is present and empty on purpose. Codex publishes no rates, so codex
work reports tokens and reports no dollars until Julian writes numbers here.

### D3. One usage record, with one stated convention

```js
// One priced request, from any harness.
{
  provider: "anthropic",      // vendor or endpoint, from the launch or the transcript
  model: "claude-opus-5",     // the billing SKU string, "[1m]" suffix included
  input: 282,                 // tokens charged at the full input rate, cache excluded
  output: 119171,             // reasoning and thinking tokens are inside this
  cacheRead: 24782742,
  cacheWrite5m: 249923,
  cacheWrite1h: 0,
  reasoning: 48026,           // reported for display only, never priced again
  webSearchRequests: 0,
  inferenceGeo: null
}
```

The two invariants are stated once, here, and every reader converts to them:

- `input` excludes cache. The codex reader subtracts `cached_input_tokens`.
- `reasoning` is inside `output`. Codex arithmetic confirms this, and the
  Claude ledger reports `thinkingTokens` beside an `outputTokens` that already
  contains them.

The cost record borrows the vocabulary that
`packages/usage-core/src/schema/index.ts` already defines, so that a later
merge is a rename and not a redesign:

```js
{
  amount: 23.9491,            // null when no model has a rate
  currency: "USD",
  source: "harness-ledger",   // or "computed", or "unknown"
  priced: true,
  unpricedModels: [],         // billing SKUs with no rate in pricing.md
  excluded: []                // machine-readable reasons, see D8
}
```

### D4. Cost authority order, per conversation

1. The harness ledger, when the harness keeps one.
2. Recomputation from the transcript, priced from `pricing.md`.
3. Tokens with no dollars.

Section 3.1 is the evidence. Recomputation is correct arithmetic over an
incomplete record. A ledger is the harness's own account of what it spent.

Claude Code has a ledger in two places. The live one arrives on the statusline
as `.cost.total_cost_usd`. The durable one is the `cost-state` record in the
transcript. Codex and pi keep no ledger. pi writes a `cost` object per message. It is zero on every stored session. Two
of the three providers in `~/.pi/agent/models.json` carry no `cost` at all, and
the third carries zeros.

**The unit is the conversation, not the attempt.** A resume reuses the
conversation, and the Claude ledger carries across the resume. Summing per
attempt double counts a resumed Job.

### D5. The live number comes from the statusline, through a sidecar file

`~/.claude-otto/statusline.sh` already computes all four facts, and already
writes a sidecar for tmux sessions whose name starts with `wt-`:

```bash
echo "$PCT $((USED / 1000)) $((CTX_SIZE / 1000)) $COST" > "$_WT_SESSDIR/$_WT_SESS.tokens"
```

Generalise that write. Every statusline writes one JSON file to
`~/.tangent/agent-shell/statusline/<tmux-session>.json`:

```json
{ "harness": "claude", "model": "Opus 5", "costUsd": 23.95,
  "contextUsed": 291000, "contextWindow": 1000000,
  "cwd": "/Users/julianotto/Projects/otto-tangent", "at": "2026-09-03T02:10:00Z" }
```

Tangent reads the file for a live session. This replaces the screen regular
expression in `pane-state.mjs` with the harness's own numbers, and it adds a
dollar that the screen never carried.

**Rejected: tmux user options.** They arrive free in the existing
`list-sessions` sweep, which is real value. They also cost one `tmux
set-option` subprocess for every statusline render, and a render happens about
once a second while an agent works. The sidecar is one file write, which the
script already does, and the file survives the death of the session. A dead
attempt keeps its last known number.

**Rejected: keep scraping the screen.** It gives no dollar, and it breaks when
Julian edits his statusline. `pane-state.mjs` already carries a comment that
says a profile without that statusline degrades to prompt-only fill.

`~/.claude/statusline.sh` and `~/.claude-otto/statusline.sh` are byte-identical
today and are separate files. Change both, or make one a symlink to the other.

### D6. The four statusline facts, and the one that codex cannot show

| Harness | Mechanism | Dollar | Context | Directory | Model |
|---|---|---|---|---|---|
| claude, claude-otto | `statusLine` command hook | yes | yes | yes | yes |
| pi-code | extension in `~/.pi/agent/extensions/` | yes | yes | yes | yes |
| codex, codex-otto, codex-gw | `[tui] status_line` item picker | **no** | yes | yes | yes |

Claude Code already prints them in this order: model, context bar, context
numbers, dollar, directory. Take that as the shared order.

pi is hackable as Julian expected. `~/.pi/agent/extensions/` already holds two
of his own TypeScript extensions. The bundle exposes `setStatus`, and it joins
every extension status into one line under the footer. An extension receives
`agent_end` with the messages, so it can total the usage itself and write the
sidecar.

Codex cannot show a dollar. Its statusline is a fixed item picker with no
script hook. The two cost items exist but are limited to an Enterprise
workspace, and Julian's `plan_type` reads `pro`. His
`~/.codex/config.toml` already holds
`["model-with-reasoning", "context-used", "weekly-limit", "current-dir"]`,
so three of the four facts are already correct.

Codex therefore keeps `weekly-limit` in the fourth position, and Tangent
supplies the dollar in its own UI. On a Pro plan the weekly quota is the real
constraint. One rollout on 2026-09-02 recorded
`rate_limits.primary.used_percent` at 99.0 with a reset seven days out.

### D7. Readers, one per harness

All three return the same list of usage records, and all three name their
source.

**claude.** Path `<transcripts>/<cwd with "/" and "." replaced by "-">/<id>.jsonl`.
Subagents are `<id>/subagents/agent-*.jsonl` beside it, each with a
`agent-*.meta.json` that carries `agentType`, `description`, `toolUseId` and
`spawnDepth`. Read the main file and every subagent file, and keep the last row per
`message.id`. If the file holds a `cost-state` ledger, prefer that ledger. 111
subagent directories exist today.

**codex.** Reuse `findCodexRollouts`. Then read the last `token_count` event.
Find subagents by reading the first line of every rollout in the same day
folders and keeping those whose `payload.parent_thread_id` matches. 766
subagent rollouts exist today. Note that a subagent rollout sets
`payload.session_id` to the parent id and `payload.id` to its own, which is why
`findCodexRollouts` reads `payload.id ?? payload.session_id` in that order.
`~/.codex/thread_history_1.sqlite` is not an alternative: `thread_turns`
carries no token usage and no parent link.

**pi.** Path `<transcripts>/-<cwd with "/" replaced by "-">--/<timestamp>_<id>.jsonl`.
Each assistant message carries `provider`, `model`, `api`, `responseModel` and
`usage`. A `model_change` row carries `{provider, modelId}`. pi records no
subagents in any of Julian's 51 session directories.

### D8. The top bar reads its own endpoint

Add `GET /api/cost`. Do not put the figure in the Work snapshot.

The Work snapshot is validated with `exactKeys`, capped at 512 KB, and
suppressed by `work-publisher.mjs` when its semantic hash did not change. A
dollar that moves every few seconds changes that hash on every publish. Every
publish then pushes an SSE `changed` event to every open client, and every
client repaints. The snapshot is a description of work, and a dollar is a
measurement of it. They belong on different clocks.

`/api/health` is the precedent for a second small endpoint that the shell reads
on its own.

The response is small and pre-computed:

```json
{
  "at": "2026-09-03T02:10:00Z",
  "window": "today",
  "total": { "amount": 388.10, "currency": "USD", "priced": true },
  "byHarness": [ { "harness": "claude-otto", "amount": 301.44, "priced": true },
                 { "harness": "codex", "amount": null, "priced": false,
                   "tokens": { "input": 78823057, "output": 7413888 } } ],
  "byModel":   [ { "provider": "anthropic", "model": "claude-opus-5", "amount": 372.10 } ],
  "topJobs":   [ { "goal": "otto/tangent/goal-....md", "title": "Price every job…", "amount": 44.20 } ],
  "excluded": [
    { "reason": "no-published-rate", "provider": "openai", "attempts": 319 },
    { "reason": "no-transcripts-folder", "harnesses": ["opencode", "agy", "agyd"], "attempts": 12 },
    { "reason": "legacy-attempt-without-launch", "attempts": 83 }
  ]
}
```

The server refreshes this snapshot behind the request, on the same reconcile
tick that already updates `contextFill`. A request therefore reads memory and
never walks the transcripts.

The bar shows one dim figure, for example `$388`. No cents: the day's real
Claude ledger total for 2026-09-02 was 388.10 dollars, and a cent on that
number is noise. When something is excluded, the figure carries a raised
marker, for example `$388·`.

Hover and keyboard focus open the breakdown, with CSS alone and no press. The
breakdown lists harness, then model, then the three most expensive Jobs, then a
plain sentence for each exclusion. For example: "Codex work is not priced. 319
attempts, 78.8M input tokens. Add rates to pricing.md."

### D9. Say what is missing, in words, on the same surface

Julian's instruction was that partial and honest beats complete and wrong.

Every figure carries `excluded`. The hover renders one sentence per entry. The
face carries a marker when the list is not empty. Nothing is dropped quietly.

## 5. Invariants

1. A stored `resolvedLaunch.ref` never changes after the attempt started.
2. `launchRef()` produces exactly three parts, forever.
3. `input` excludes cache tokens, in every usage record, from every harness.
4. `reasoning` is inside `output`, and is never priced twice.
5. A model with no rate produces no dollars, and never falls back to the rate
   of a similar model.
6. A cost record names its source, and lists the models it did not price.
7. Cost is summed per conversation id, never per attempt.
8. `pricing.md` is the only place a rate is written.

## 6. Failure modes

| Failure | Cause | Behavior |
|---|---|---|
| A resumed Job counts twice | The Claude ledger survives `--resume` and the new file repeats it | Sum by conversation id, not by file. The same id in two attempts contributes once. |
| A codex session changed model | `total_token_usage` is one cumulative number and cannot be split | Fall back to summing distinct `last_token_usage` values, keyed by the `turn_context` in force |
| An unknown billing SKU | `claude-opus-5[1m]` and `glm-5.2[1m]` are separate SKUs | Report the tokens, add the SKU to `unpricedModels`, and mark the figure `priced: false` |
| Codex has no rates | The vendor publishes none and the CLI ships none | Report tokens and the weekly limit percentage. Report no dollars. |
| The sidecar is stale or absent | The statusline is not installed, or the session died | Fall back to the transcript reader, and set `source: "computed"` |
| A live figure jumps when a session ends | The live source is the statusline and the durable source is the ledger | Both are the same ledger, so the jump is bounded by one render. Record `at` on every figure. |
| The transcript walk is slow | One Claude session is 2 MB, plus 1.6 MB of subagents | Cache per conversation id, keyed by file size and modification time. Only a growing file is re-read. |
| A rate edit corrupts the block | Hand-edited JSON | `parseHarnessRegistry` is the model: return `{ error }`, keep the last good table, and show the error in the hover |
| Codex subagent tokens double count | Unverified. A subagent forks the parent context at `subagent_history_start_ordinal` | Measure before trusting. See section 8. |

## 7. Rollout and rollback

Five steps. Each one is useful alone and each one reverts alone.

1. **Fix the readers.** Correct the pi path in `transcript-tail.mjs`. Add
   `transcripts` to `codex-gw` and `claude-gw` in `harnesses.md`. Revert by
   reverting the commit. This step alone repairs liveness for 95 stored pi
   attempts, which has never worked.
2. **Add the price table.** Write `pricing.md` and its parser and validator.
   Nothing reads it yet. Revert by deleting the Document.
3. **Add the provider axis.** Optional registry field, `resolveLaunch` return
   value, `resolvedLaunch.ref` at launch, and the `providerSession.provider`
   rename with a read of the old name. Old records stay readable and the
   registry parser already tolerates an unknown field. Revert by reverting the
   commit. Stored refs that carry a provider stay valid, because the field is
   optional.
4. **Add `/api/cost` and the top-bar figure.** Server first, then the bar.
   Revert by removing the element. The endpoint is additive and no existing
   route changes.
5. **Change the statuslines.** The Claude script, then the pi extension, then
   the codex configuration entry. Each is a file Julian owns. Keep a backup of
   each before the edit, and name every edit in the handover. Revert by
   restoring the backup.

CAUTION: Do not edit `~/.claude/settings.json`, `~/.codex/config.toml` or
`~/.pi/agent/models.json` without recording the exact edit in the handover.
Each file changes how Julian's own sessions start.

## 8. Proof boundary

**Proved by measurement on real files.**

- The Claude formula reproduces the ledger exactly on a session with no
  subagents. Six such sessions matched to four decimal places.
- Last-occurrence deduplication is required, and only on subagent files.
- The codex per-turn sum reproduces the cumulative counter on all four billed
  buckets.
- The pi directory rule holds on 51 of 51 directories.
- The two token conventions are opposite, and pi already normalises them.
- 644 stored attempts split as the table in section 3.6 states.

**Not proved, and not provable here.**

- The rates. They are list prices that Julian supplies. On a subscription they
  measure work, not spend. This is a property of the number and not a defect.
- That the ledger itself is correct. It is the harness's own account. Nothing
  local can audit it against a bill.
- That codex subagent rollouts do not repeat parent tokens. Measure this by
  comparing the sum over one parent and its children against the parent's own
  final counter.
- That the statusline sidecar covers every live session. A session started
  outside Tangent writes one too.

## 9. Assumptions, unknowns, and when to reconsider

**Assumption.** Every API request that Tangent must price appears either in a
harness ledger or in a transcript. Section 3.1 already shows one exception for
Claude, which the ledger covers. If codex or pi gains background requests, the
same gap opens there with no ledger to cover it.

**Unknown.** The ResetData context window. `~/.pi/agent/models.json` says
1,000,000 and Julian's own note says 800,000. The largest single request across
34,071 pi assistant messages is 528,565 tokens, so the measurement settles
nothing. If 800,000 is correct, pi's own footer percentage is wrong, and so is
every `contextFill` derived from it.

**Unknown.** Why `claude-opus-5[1m]` requests never reach the transcript. The
figure is covered by the ledger, so the design is safe. The cause is not known.

**Proposed generalization.** A `[1m]` suffix marks a one-million-context
billing SKU. Two vendors use it: `claude-opus-5[1m]` in the Claude ledger and
`glm-5.2[1m]` in `~/.pi/agent/models.json`. Treat the suffix as part of the
model id and never strip it.

**Reconsider this design when:**

- A third reader of the price arithmetic appears. Then extract the shared
  package that D2 rejects, and keep `pricing.md` as the authority.
- Codex adds a script hook to its statusline. Then codex joins the sidecar and
  D6's exception disappears.
- Codex publishes rates, or Julian moves off a Pro plan. Then the codex dollar
  becomes real and `weekly-limit` stops being the honest fourth fact.
- Claude Code stops writing `cost-state`. Then D4 falls back to recomputation
  for finished sessions, and the known under-report of section 3.1 becomes the
  figure.

## 10. Open question for Julian

The top-bar figure is today's total across every harness. The hover breaks it
down by harness, by model, and by the three most expensive Jobs. The
alternative reading of "a small costing that shows me the cost" is the cost of
the Job in view.

The machinery serves both, and `/api/cost` exposes per-Job figures either way.
This design picks the day total, because the bar is always visible and a Job is
not always open.
