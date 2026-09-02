# Cost attribution: where design A and design B differ, and what was built

Goal: `goal-price-every-job-across-providers-and-show-it`.
Brief: `~/.tangent/trees/otto/tangent/records/cost-attribution-brief.md`.
Inputs: `design-a.md` (pass A, with a preserved spike at `ef755099` on `dev/cost-attribution-spike-a`) and `design-b.md` (pass B).

Where the two passes agree, the implementation follows them and this document does not repeat them. The agreements are: provider is an optional registry field that a model option can override and that `resolveLaunch` stamps on `resolvedLaunch.ref` at launch time; provider never enters `launchRef()`; one canonical usage shape modelled on pi's, where `input` means tokens charged at the full input rate and `reasoning` is inside `output` and never billed twice; cost is summed per conversation, not per attempt, because a resume reuses the conversation; no rate is ever guessed; the top bar reads its own `GET /api/cost` rather than the Work snapshot; the figure is today's total across every harness; and anything a number leaves out is named on the same surface.

Nine places needed a choice.

## 1. Where the price table lives

**A:** a new platform package `@tangent/pricing`, with Eval and Usage moved onto it.
**B:** a vault Document `~/.tangent/trees/pricing.md` holding a fenced `tangent.pricing.v1` block, on the `harnesses.md` precedent.

**Chosen: B's location, with a seed table shipped in the repository.**

B is right about the package. It is about forty lines of arithmetic, and paying for it costs an entry in `allowedPackageDeps`, an edit to `package-boundaries.md`, an ADR, and a TypeScript build in front of an `app/` directory that has no build step today. The authority for a rate is the table, not the code that multiplies it.

B is not right that `pricing.md` can be the only place a rate is written. A worker cannot create a vault Document, and a machine with no `pricing.md` would price nothing at all, which fails the brief's instruction to seed the table with the verified prices. So the verified rates ship in `packages/agent-shell/app/pricing-catalog.mjs` and `~/.tangent/trees/pricing.md` layers over them: a provider and model named in the Document replaces the seeded rate for that model, and a model the seed does not know is added by writing it there. Julian can still correct a rate without a rebuild, and vault git still records when a rate changed. The exact Document to install is written out at `docs/design/cost-attribution/pricing.md.proposed`.

This drops B's invariant 8. The replacement invariant: **a rate is written in exactly two places, the seed and the Document, and the Document always wins.**

## 2. How a codex subagent is found

**A:** walk `source.subagent.thread_spawn.parent_thread_id` recursively.
**B:** keep rollouts whose `payload.parent_thread_id` matches the parent.

**Chosen: neither. Anchor on `payload.session_id`.**

Both passes read the same field and both under-count. Measured across all 2,005 rollouts under `~/.codex/sessions` on 2026-09-03:

| `thread_source` | rollouts | carry `thread_spawn.parent_thread_id` |
|---|---:|---:|
| `user` | 962 | 0 |
| `subagent` | 766 | 373 |
| `guardian_review` | 277 | 0 |

A child rollout always sets `payload.session_id` to the id of the **root** thread and `payload.id` to its own, and `session_id` resolves to a rollout that exists in 1,043 of 1,043 cases. `parent_thread_id` is present on only 373 of those 1,043, and where it is present it names the **immediate** parent: it agrees with `session_id` on all 333 rollouts at `depth: 1`, and disagrees on all 40 at depth 2 or 3, where the immediate parent is itself a subagent.

So the rule is: a rollout is a descendant of thread `T` when `payload.session_id === T` and `payload.id !== T`. One lookup, no recursion, complete at every depth. A's rule would have missed 670 of 1,043 child rollouts, including every `guardian_review` thread, which neither design mentions.

`parent_thread_id` is still read and its edge still walked, so a future rollout that carries the spawn link but not the session link is picked up. The seen set makes the overlap free.

## 3. Whether a codex subagent repeats its parent's tokens

B recorded this as unverified and asked for a measurement before it was trusted.

**Measured: it does not.** Each subagent rollout keeps its own cumulative `total_token_usage`, starting from its own first request. On parent `019f6520`, the parent's final counter reads 41,868,772 input tokens and its three children sum to 57,456,048; each child's first `token_count` event reads 19,906 input tokens, which is the forked context it was actually charged for, not a copy of the parent's running total. Subagent tokens are additive. They are added.

## 4. Ledger or recomputation

**A:** prefer Claude Code's `cost-state` ledger, but only when no billed assistant row follows it.
**B:** prefer the ledger.

**Chosen: A's rule, for B's reason.**

B's measurement is the stronger argument for the ledger: over 249 sessions, every session with no subagents matched to four decimal places and every session with subagents under-reported by 4 to 26 percent, because `claude-haiku-4-5` background calls and the `claude-opus-5[1m]` billing SKU appear in the ledger and never in the transcript. A's refinement is what keeps that safe: the ledger is a snapshot, and an interrupted session has one written before its final response, which A measured reporting $0.002 for a session that cost $0.23. A ledger with billed work after it is stale and falls through to recomputation.

## 5. The `claude-opus-5[1m]` SKU

**A:** it bills at the plain `claude-opus-5` rate, derived by solving a real record.
**B:** treat it as a separate SKU and report it unpriced.

**Chosen: A.** A's derivation is arithmetic on a recorded total, not an assumption, and B's own evidence shows the SKU carries real tokens (38,809 output on one session) that would otherwise go unpriced. The family match in the seed covers the suffix. The `[1m]` suffix is kept as part of the model id and never stripped, which is B's rule and the right one.

## 6. The live dollar and the statusline sidecar

**B:** every statusline writes `~/.tangent/agent-shell/statusline/<session>.json`, and `pane-state.mjs` reads that instead of grepping the pane text.

**Chosen: not now.** It is a good idea and it is out of this assignment's scope. The assignment asks for a cost in the top bar and for statuslines that show four facts; the sidecar is a third thing, a replacement for how Tangent observes a live pane. It changes `contextFill` for every harness, which is load-bearing for liveness, and its value is a fresher number rather than a correct one. Recorded here so it is not lost. The seam it needs already exists: `pane-state.mjs` is the only reader.

The top-bar figure therefore comes from A's route: the server prices transcripts, holds a snapshot, answers every request from the snapshot, and reads the next one behind the request.

## 7. Renaming `providerSession.provider`

**B:** the field holds a harness id, so rename it to `harness`, keep reading the old name, and never write it again.

**Chosen: write both, read the new one.** B is right that one word with two meanings is a defect. A rename is also a change to every stored Job record and to eleven call sites in `server.mjs` for no behaviour. So `newConversation` now writes `{ harness, provider, id }` with the same value in both, every reader in the cost path prefers `harness`, and the old key stays for records already on disk and for code not touched by this change. The ambiguity is gone going forward without a migration.

## 8. Codex's fourth statusline fact

Both passes agree codex cannot show a dollar: its statusline is a fixed item picker with no script hook, and the two cost items are Enterprise-only while Julian's `plan_type` is `pro`.

**Chosen: B's answer.** Codex keeps `weekly-limit` in the fourth position and Tangent supplies the codex dollar in its own UI. On a Pro plan the weekly quota is the binding constraint, and A's open question 5 does not need to be settled first: if `estimated-thread-cost` ever renders, it is one word in a config file.

## 9. pi's zero prices

Both passes say the same thing and the brief permits the edit. Done, with a backup: `~/.pi/agent/models.json` now gives `resetdata-glm` the rates Julian supplied. Cache writes bill at the input rate because that endpoint publishes no separate write price, and that assumption is written next to the numbers.

The 800,000 against 1,000,000 context window for ResetData GLM is still unresolved. Nothing in the cost path depends on it. pi's own footer percentage does.
