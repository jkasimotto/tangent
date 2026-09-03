# ADR-0057: Provider axis and cost attribution

Status: accepted. Design: `docs/design/cost-attribution/design-a.md`, `design-b.md`, and the choice between them in `docs/design/cost-attribution/decision.md`.

## Context

Tangent knew what harness, model and effort a Job ran on. It did not know what
that Job cost. Claude Code reports a dollar, Codex and pi report token counts,
and nothing turned any of it into the cost of a piece of work.

Three facts made this more than arithmetic.

A model id is not enough to price a request. The same id served through a
gateway bills at a different rate, and one pi-code harness reaches three
different accounts. The account that served a model is a fourth axis, and
without it a price is a confident wrong answer.

The harnesses disagree about what `input_tokens` means. Anthropic excludes
cache reads from it. OpenAI leaves cached tokens inside it: one measured Codex
rollout reported 209,124 input tokens of which 208,128 were cached. A reader
that does not normalize this over-charges by two orders of magnitude on the
cached part.

Subagents are most of the spend on a large Job and each harness records them
somewhere different. Claude writes them beside the parent, Codex writes each
one as its own rollout, and pi runs them inside the conversation.

## Decision

**Provider is a fourth launch axis.** An optional `provider` on a harness entry
and on a model option in `~/.tangent/trees/harnesses.md`. A model option's
declaration wins over its harness's, and a provider named in the launch
arguments wins over a harness-wide declaration, because that is what actually
runs. `resolveLaunch` returns it and the attempt records it in
`resolvedLaunch.ref` at launch time, so a later registry edit cannot rewrite
what finished work ran on. It stays out of `launchRef()`, which stays three
parts forever: that string is stored in `@tangent_launch_ref`, in every Area
harness contract, and in `launch-memory.json`, and `parseLaunch` rejects a
fourth part. The registry parser already tolerated an unknown key, so this
needs no version bump and no migration.

**Rates live in a seed and a vault Document, and the Document wins.** The
verified prices ship in `packages/agent-shell/app/pricing-catalog.mjs`, and a
`tangent.pricing.v1` block in `~/.tangent/trees/pricing.md` overrides them by
provider and model. `harnesses.md` is the precedent: a machine-wide table in a
vault Document, parsed from a fenced block, applying without a restart, with
vault git recording when a value changed. A new platform package was rejected:
it is about forty lines of arithmetic and would add a governance allowlist
entry, a boundary-document edit, and a TypeScript build in front of an `app/`
directory that has no build step.

**A model with no rate is never guessed at.** Codex publishes no prices, so
codex work reports tokens and no dollars until a rate is written into
`pricing.md`. An unpriced model that carried tokens is named on the surface
that shows the number.

**One usage shape, pi's.** `input` means the tokens charged at the full input
rate and nothing else; every reader normalizes to it and the Codex reader
subtracts the cached part. `reasoning` is carried for a reader and never
billed, because every provider that reports it already counts it inside
`output`.

**A harness's own ledger wins while it is the last word.** Claude Code writes a
`cost-state` record that already includes subagents and the background calls
that never reach the transcript. It is a snapshot, not a footer, so a ledger
with billed work after it is stale and the tokens are priced instead.

**The unit of cost is the conversation, not the attempt.** A resume reopens the
conversation it already had and the ledger carries across it, so two attempts
that share a conversation are one cost counted once. Brains and repairs are
priced beside Jobs: they record the same five facts and they spend the same
money.

**The top bar reads its own `GET /api/cost`.** Not the Work snapshot: that is
validated with `exactKeys`, capped, and suppressed on an unchanged semantic
hash, so a moving dollar inside it would push an SSE `changed` event and a
repaint to every client on every publish. The service answers from the
snapshot it holds and reads the next one behind the request, so the figure is
there without a press.

**What a number leaves out travels with the number.** Every total carries the
models it could not price, the attempts it could not reach, and the
conversations it could only price from tokens, each with a reason, and the
face of an incomplete figure says so. A running or interrupted Claude
conversation has no ledger that is still the last word, so its part of the
figure is a floor and is named as one: measured over 137 model rows whose
transcript tokens match the ledger exactly, the rate is right to 0.1 percent,
but `claude-haiku-4-5` background calls and the `claude-opus-5[1m]` SKU reach
the ledger and never the transcript.

**The Document replaces a rate, it does not merge with it.** A model named in
`pricing.md` takes its whole rate from there, `fastMode` included. A Document
entry that omits `fastMode` for a model whose seeded rate has one prices fast
work at the standard rate. `pricing.md.proposed` carries the fast rates for
that reason.

## Consequences

`transcript-tail.mjs` now resolves transcripts through the same module the cost
path uses, which fixed a pi path that had never resolved and had silently
disabled liveness for every pi attempt ever recorded.

`providerSession.provider` held a harness id, which collides with the new axis.
New records write `harness` alongside it with the same value and readers prefer
`harness`. The old key is still read, so nothing on disk had to change.

Codex cannot show a dollar on its own statusline: the item exists in the binary
and its own description reads "Enterprise workspaces only". Codex keeps its
weekly quota in that position and Tangent supplies the codex dollar.

Two registry entries, `codex-gw` and `claude-gw`, declare no `transcripts`
folder, so their attempts are unattributable by construction. Both wrappers run
on the real `~/.codex` and `~/.claude`. Adding those paths to the two entries
recovers them; that is a vault edit, not a code change. The same edit must give
each entry a `provider`, because a harness whose id ends in `-gw` is never
inferred from its family: a gateway reaches an account this table cannot name,
and reading `claude-gw` as `anthropic` would price gateway work at the vendor's
direct rate. A profile shim is not a gateway; `claude-otto` sets
`CLAUDE_CONFIG_DIR` on the same account and still infers `anthropic`.
