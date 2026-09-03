# Price every job across providers and show it

Design for the Goal `goal-price-every-job-across-providers-and-show-it`. Brief: `~/.tangent/trees/otto/tangent/records/cost-attribution-brief.md`.

Every claim below was measured against Julian's own transcripts and records on 2026-09-02, in a working spike on branch `dev/cost-attribution`. Where a claim rests on a measurement, the measurement is given. Where something is unverified, it says so.

## What the Goal asks, and what this design answers

| Done when | Answer |
|---|---|
| Provider joins harness, model and effort in the data model | Section 1 |
| A Job's cost is derivable from claude, codex and pi records including subagents | Sections 2 to 5 |
| The Tangent UI shows a small estimated cost with a hover breakdown and no button press | Section 6 |
| codex and pi-code statuslines show dollar, context, directory and model | Section 7 |
| Anything a number excludes is stated rather than silently omitted | Section 8 |
| Focused and repository proof passes on `dev/cost-attribution` | Section 10, honestly incomplete |

## 1. Provider in the data model

Provider is the account that served a model. It is not the harness and not the model, and it is the missing half of a price: the same model id billed through a different account bills at a different rate, so pricing on the model alone would be a confident wrong answer.

The machine registry (`~/.tangent/trees/harnesses.md`, block `tangent.harnesses.v2`) is the right home. `parseHarnessRegistry` in `packages/agent-shell/app/launch-environment.mjs` ignores keys it does not know, so an optional `provider` can be added to a harness entry and to a model option with **no version bump and no migration**. A model option's provider wins over its harness's, because pi reaches three providers from one harness.

Two consequences to plan for:

- `harnessRegistryRevision` hashes the whole registry, so editing `harnesses.md` at all marks every Area harness contract stale and asks for `tangent shell migrate-launch-policy`. This is true of any registry edit, not of this one.
- `resolveLaunch` should return `provider` alongside `harness`, `model` and `effort` so `attempt.resolvedLaunch.ref` stamps it **at launch time**. Reading it back from a registry that may have changed since would rewrite history.

Until the registry declares providers, a fallback keeps the data model correct today:

1. pi model args name the provider literally (`--provider resetdata-glm`). Read it.
2. Otherwise a documented table by harness id: `claude*` → `anthropic`, `codex`/`codex-otto` → `openai`, `codex-gw`/`opencode` → the gateway account.
3. Otherwise `unknown`, which prices nothing and says so.

Julian asked for provider at the data level and explicitly not in the UI. Nothing here surfaces it.

## 2. Where the pricing code lives

`packages/agent-shell/AGENTS.md` forbids Usage imports and `packages/governance/src/index.ts` enforces it, so Agent Shell cannot reach `@tangent/usage/pricing`. Putting rates in Agent Shell instead would strand them there: Eval already carries a second, Claude-only rate table at `packages/eval/src/core/cost.ts`, and Usage carries an unused pricing stub whose input type already has `provider` and `model`.

So: a new platform package, **`@tangent/pricing`**, depending on nothing. Agent Shell, Usage and Eval all depend on it, and Eval's duplicate table is deleted. This is a platform dependency, not a vertical one, so it does not weaken the rule that keeps the verticals apart. It needs the governance allowlist, `docs/architecture/package-boundaries.md` and an ADR changed in the same commit.

It owns three things and nothing else: the usage shape, the rate catalog, the cost maths. No filesystem, no network, no transcript formats.

## 3. One usage shape, because the harnesses disagree

The harnesses disagree about what `input_tokens` means, and the disagreement silently doubles or halves a bill:

- Anthropic reports `input_tokens` with cache reads already excluded.
- OpenAI reports `input_tokens` with cached tokens **still inside it**. Measured on a real rollout: `input_tokens: 209124`, `cached_input_tokens: 208128`, so 996 tokens were charged at full rate and 208128 at the cached rate.

`TokenUsage.input` therefore means one thing only: the tokens charged at the full input rate. Every reader normalizes to it, and the Codex reader subtracts the cached part. The rest of the shape is pi's, as the brief suggested: `output`, `cacheRead`, `cacheWrite`, `cacheWrite1h`, `reasoning`.

`reasoning` is carried for the reader and **never billed**. Every provider that reports it already counts those tokens inside `output`; charging it again would inflate a bill by exactly the amount the model thought.

## 4. The rate catalog, and what verified it

Rates are per million, from the price list baked into Claude Code 2.1.258 and, for ResetData, from Julian's own numbers. The catalog reproduces five real `cost-state` totals from his transcripts **to the last recorded digit**:

| Model | Recorded | Computed |
|---|---|---|
| `claude-haiku-4-5`, no cache | 0.001624 | 0.001624 |
| `claude-fable-5`, one-hour writes | 5.442114 | 5.442114 |
| `claude-opus-5`, one-hour writes | 4.878501500000001 | 4.878501500000001 |
| `claude-sonnet-5`, five-minute writes | 11.737037599999997 | 11.737037599999997 |
| `claude-haiku-4-5`, five-minute writes | 0.7610909000000001 | 0.7610909000000001 |

Three things fell out of that work:

- A `cost-state` record reports `cacheCreationInputTokens` as one sum across both write buckets. The bucket each of those sessions used was recovered by solving for the rate that reproduces the recorded cost. The per-message records do carry the split, in `usage.cache_creation.ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens`, so the reader never has to guess.
- **`claude-opus-5[1m]` bills at exactly the same rate as `claude-opus-5`.** Derived from a record with 47224 input, 34977 output, 5867528 cache reads and 256747 five-minute writes against a recorded 5.64897775: the base rate reproduces it exactly and a doubled long-context rate is out by a factor of two. The `[1m]` suffix appears in `cost-state` and in the parent's Task `resolvedModel`, but never on the subagent's own rows. It needs no separate entry.
- Julian's data contains no fast-mode and no United States inference: 132493 records say `"speed":"standard"`, and `inference_geo` is only `global` or `not_available`. Both modifiers are implemented from the brief's formula but neither has been exercised against a real record.

**A model with no verified rate is never guessed at.** Codex ships no price data and this repository has no verified numbers for `gpt-5.6-*`, so those models come back unpriced and the surface names them. A local `~/.tangent/pricing.json` merges account-holder rates in front of the catalog; that is the one way Codex spend becomes a dollar figure, and it is Julian's to fill in.

These are API list prices. On a subscription they measure work done, not money spent, and every surface must say so.

## 5. Reading a Job's cost

### The unit is the conversation, not the attempt

Resuming an attempt reopens the conversation it already had. Two attempts that share a conversation are one cost, counted once, so conversations are deduplicated by transcript before anything is summed.

### Finding the transcript

Three harness families, three unrelated layouts, and one of them has never worked:

- **claude**: `<transcripts>/<cwd with / and . as ->/<id>.jsonl`. Works today.
- **codex**: no id at launch, so the thread is matched by folder and start time against each rollout's `session_meta` first line. Works today.
- **pi**: the code looks for `<transcripts>/<id>.jsonl`. pi writes `<transcripts>/-<cwd with / as ->--/<timestamp>_<id>.jsonl`. **No pi conversation has ever resolved**, which silently disabled liveness observation for the 95 stored pi attempts that do carry an id. Fixed in the spike by matching the id as a filename suffix inside the cwd slug folder, with a whole-root fallback for older records that lost their cwd.

The three layouts now live in one module, so the next reader cannot drift from the observer again.

### Subagents

- **claude** writes them beside the parent at `<id>/subagents/agent-*.jsonl`. About one message id per subagent overlaps the parent at the fork point, so the reader deduplicates by message id **across every file of one conversation**, not per file. A message id also repeats across the lines of a streamed response; the last line is the complete one.
- **codex** writes each subagent as its own rollout naming `source.subagent.thread_spawn.parent_thread_id`. A subagent can spawn its own, so descendants are walked, not taken one level deep. This was the part the brief expected to be hard, and it is not.
- **pi** runs subagents inside the conversation. Nothing to add, and the result says so rather than leaving a reader to wonder.

### Prefer the harness's own ledger when it is complete

Claude Code keeps its own cost ledger in process and writes it to the transcript as a `cost-state` record. That ledger is strictly better than anything computed from transcript rows: it includes subagents, and it includes the background calls Claude Code makes that never become transcript rows.

Measured: computing from tokens alone is **about 0.04% under** the recorded total, consistently, across twelve sessions. The gap is background work such as title generation, which never reaches the transcript.

But the record is a snapshot, not a footer. One session in the sample had its ledger written **before** its final billed response, and reading it would have reported \$0.002 for a session that cost \$0.23. So the rule is: use the ledger only when no billed assistant row follows it, otherwise compute.

With that rule: **13 of 14 sampled sessions match the recorded total exactly**, and the fourteenth is the stale-ledger case where the computed number is the correct one.

### The other two harnesses

- **codex** emits a cumulative `total_token_usage` after each request and re-emits it often enough that summing the per-request field overstates a thread. Measured on one rollout: summing `last_token_usage` gives 78.80M input against a cumulative 76.30M, a 3% overcount. So the totals are differenced, and each difference is charged to whichever model was in force, which keeps a thread that switched models honest.
- **pi** already records provider, model and usage on every message, and a `cost` object that is **always zero** because the price table it read at the time was zero. A cost that was wrong when it was written stays wrong forever; token counts do not. So pi's cost field is ignored and the tokens are repriced.

### Spend is not only Jobs

An Area brain runs for days and spends the whole time. In one measured day, brains were \$32 of \$491. A total that quietly covered only Jobs would be wrong by that much, so brain generations are read through the same five facts every attempt records: launch ref, conversation, cwd, start, end.

## 6. The number in the top bar

Julian asked for a small estimated cost, probably in the top bar, with a hover breakdown, and no press if that is achievable. It is achievable.

**One dim monospace figure** in `.bar-actions`, beside the connection pill. Resting on it, or focusing it with the keyboard, opens the breakdown. This is CSS `:hover, :focus-within`, not a popover: there is nothing to press, nothing to dismiss, and no state to get wrong.

The breakdown is ordered by what a person wants first: where the money went (top work), then which harnesses, then which models, then what the figure does not cover, then one line saying these are list prices.

Reading the number is slow the first time and must never be waited on. The server holds a snapshot, answers every request from it, and reads the next one behind the request. Measured on one day of records: **5.1s cold, 78ms warm**, over 85 conversations, with readings cached against each transcript's size and modification time so a finished conversation is never read twice. The browser reads it on its existing refresh; a failure leaves the last figure standing rather than blanking the bar.

**Scope decision, made because Julian was asleep**: the figure is *today*, across every harness, over Jobs and brains together. Per-Job cost is available from the same code, so a Job row can carry its own number later. If that reading is wrong, the scope of the number changes and the machinery does not.

A conversation is charged to the day its attempt started, so a session that ran through midnight lands whole on the day it began rather than split across two totals that neither of them explains.

## 7. Statuslines

Julian wants the same four things everywhere: dollar, context, directory, model.

**Claude Code**: already correct. `~/.claude/statusline.sh`, duplicated at `~/.claude-otto/statusline.sh`; the two files are currently identical and must be edited together.

**pi-code**: already correct, and blocked by one wrong number. Its `FooterComponent` (`dist/modes/interactive/components/footer.js`) already prints the directory with git branch, token stats, context percent against the window, the model with its thinking level, and the provider when more than one is configured. It prints `$x.xxx` **only when `usageTotals.cost` is non-zero**, and that total is zero for exactly one reason: `~/.pi/agent/models.json` gives `resetdata-glm` `cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}`.

The fix is to write Julian's real numbers into that file: input \$1.58/M, cached \$0.16/M, output \$4.96/M. No cache-write price is published for that endpoint, so writes bill at the input rate; that assumption should be stated where it is written. The brief permits this edit with a backup and a report. The `zai-openai` and `zai-anthropic` providers have no `cost` block at all and no numbers were supplied for them, so they stay unpriced.

One conflict is still open: Julian's table says the context window is 800,000 and `models.json` says 1,000,000. This design does not resolve it and nothing here depends on it, but the footer's context percent does, so it is worth settling before trusting that percentage.

**codex**: cannot be made to show a dollar by a script. Its statusline is a fixed item picker persisted as `[tui] status_line` in `~/.codex/config.toml`; there is no shell hook. Julian's is already `["model-with-reasoning", "context-used", "weekly-limit", "current-dir"]`, which covers model, context and directory.

Two cost items exist in the binary, `estimated-thread-cost` and `thread-credits`, and the picker omits them because his `plan_type` is `pro`. Measured: `codex doctor` loads a config naming `estimated-thread-cost` without complaint, but it also loads one naming a nonsense item, so config parsing is not the gate and that test proves nothing. **Whether the item renders on a Pro plan is unverified**: a pty run captured only the startup animation before the timeout. It costs one minute to settle by adding the item to the live config and looking, and it is harmless if it renders nothing.

Codex also ships no pricing data at all, so even a rendered figure would come from OpenAI, not from Tangent. The honest position: codex's own statusline shows three of the four, Tangent supplies the codex dollar, and the UI says the codex part is estimated.

## 8. Saying what a number leaves out

A total that hides its gaps is worse than one that names them, so exclusions travel with the number rather than being computed and dropped.

`totalCost` carries an `unpriced` list; a part that carried tokens and had no rate is named, and a part that carried no tokens is not, because an unused model cost nothing and naming it would send the reader chasing a gap that is not there. Attempts that could not be reached come back with a reason each. In the top bar, an incomplete figure is prefixed with a tilde and shown in amber, and the breakdown lists every reason with a count.

Measured over one real day: **\$491 across 85 conversations, incomplete**, with four exclusions:

| Excluded | Count |
|---|---|
| `openai/gpt-5.6-sol` has no published rate | 1 model |
| the `codex-gw` harness declares no transcripts folder | 14 attempts |
| no conversation was recorded or found for the attempt | 5 attempts |
| the transcript is no longer on disk | 1 attempt |

Two of those are fixable in the registry rather than in code: **`codex-gw` and `claude-gw` have no `transcripts` entry**, so their attempts are unattributable by construction. Adding `"transcripts": "~/.codex/sessions"` and `"~/.claude/projects"` to those two harness entries recovers them. That is a vault edit and belongs to the brain, not to a worker.

## 9. What this design deliberately does not do

- It does not put provider in the UI. Julian said not to.
- It does not invent a rate for any model. Codex spend counts tokens and reports no dollars until someone who knows the numbers writes them into `~/.tangent/pricing.json`.
- It does not auto-edit `~/.codex/config.toml`, `~/.claude/settings.json`, or `~/.pi/agent/models.json`. The pi edit is proposed with its exact numbers.
- It does not touch `main` or the live shell on port 4321.

## 10. Proof, honestly

Passing: `@tangent/pricing`, 16 of 16 tests, including the five real recorded totals in the table above and the guards that keep an unpriced model unpriced.

Measured, not test-covered: the 13-of-14 whole-session agreement, the 3% Codex overcount, the 0.04% transcript shortfall, the 5.1s and 78ms readings, and the one-day \$491 total. Each was produced by a throwaway script against real data, and each needs a fixture-backed test before it counts as proof.

**Not run**: repository-wide `npm run check`, `npm run test`, `npm run governance`, `npm run build`. A UI test, `focus-shell-paint-lifecycle-ui.test.mjs`, fails with the spike in the tree; whether it fails without it was not determined, and the spike's top-bar wiring hangs that test's stubbed fetch, which is a real thing to fix before any of this ships.

## 11. What a brain should decide next

1. Is the top-bar figure *today across everything*, or the current Job? The machinery serves either.
2. Should the registry gain `transcripts` for `codex-gw` and `claude-gw`, recovering 14 attempts a day?
3. Should the pi `cost` table be written with Julian's numbers now, which is the whole of the pi-code statusline work?
4. Is the 800,000 or the 1,000,000 context window right for ResetData GLM?
5. Someone should spend one minute finding out whether `estimated-thread-cost` renders on a Pro plan.
