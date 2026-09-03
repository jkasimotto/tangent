# Final review: what was checked, what was wrong, what changed

This is step 4 of the Goal `goal-price-every-job-across-providers-and-show-it`.
It reviewed the implementation in commit `b53293b9` against the Goal's done
condition, verified the arithmetic against real sessions on disk, and fixed
every failure it found. It reused designs A and B and `decision.md` as
evidence, and it repeated the measurements rather than trusting them.

## What the review proved

**The rate table is correct.** Each rate was compared against Claude Code's own
per-model ledger. Only rows where the transcript token totals match the ledger
token totals exactly were compared, so any difference is a rate error and not a
missing row. 137 rows qualified: 49 match to the bit and 88 match within 0.1
percent, which is floating-point rounding. No row differs by more than that.
The rows cover `claude-opus-5`, `claude-fable-5`, `claude-fable-5-1`,
`claude-sonnet-5` and `claude-opus-4-6`. The Fable 5.1 cache-read rate of 0.25
is among them. The rates the ledger has no rows for match the brief by
inspection.

**The `claude-opus-5[1m]` rate is right, and it is arithmetic and not a
guess.** Ten ledger rows for that SKU were solved for the write rate they
imply. All ten reproduce the recorded dollar exactly at the plain Opus 5 rate,
nine at the five-minute write rate and one at the one-hour rate.

**The ledger itself is sound.** In 265 of 265 recorded `cost-state` records,
the per-model `costUSD` values sum to `totalCostUSD` exactly.

**Codex token differencing is right.** Summing the differences between
cumulative totals reproduces the final `total_token_usage` on all four billed
buckets in 376 of 400 rollouts. 21 carry no `token_count` event. The other 3
are counter restarts, which are treated below.

**pi transcripts now resolve.** 130 of 135 stored pi attempts that carry a
conversation id are now observed by the liveness reader, the same rate as
Claude's 139 of 142. The 5 misses are transcripts that are no longer on disk.
Before this Goal the number was zero, because the old code looked for
`~/.pi/agent/sessions/<id>.jsonl` and pi has no file at that path.

**The whole path works on real data.** Run against the real Agent Shell state,
one day reads 156 attempts into 114 conversations in 3.8 seconds and prices
them at 977 US dollars, naming every exclusion.

**The top bar renders, and it updates with no press.** Driven in a browser
against an isolated fixture machine. The figure showed `~$170`, which is the
hand-checked sum of the fixture's ledgers and token counts. Hover opened the
breakdown with CSS alone. A ledger changed on disk moved the figure from
`~$170` to `~$270` in 49 seconds with no click, no keypress and no reload.
That is the 30 second client poll plus the 20 second server staleness window.

**pi-code shows all four facts.** `footer.js` prints the cost when the session
total is not zero, the context percentage against the window, the directory
with its git branch, and the model with its thinking level. The rates written
into `~/.pi/agent/models.json` are what makes the dollar appear.

**Codex cannot show a dollar, and this is settled.** The binary's own help text
for `estimated-thread-cost` reads "Enterprise workspaces only". Julian's plan
is `pro`. All four item ids in his `~/.codex/config.toml` exist in the binary,
so the statusline he has is valid and shows model, context, weekly quota and
directory.

**The real vault still loads.** The machine-wide registry parses and validates,
and all 56 Area harness contracts in `~/.tangent/trees` parse without error.
`pi-code`'s one model option resolves to `resetdata-glm` from the
`--provider` in its own arguments, which is the rule the design asks for.
1,396 stored attempts read without error, including the 718 that carry no
`resolvedLaunch.ref`; each of those is named in the breakdown rather than
dropped.

**Provider stays out of `launchRef()`.** `launchRef` joins harness, model and
effort only, `parseLaunch` rejects a fourth part, and `saveMemory` writes only
the three parts into `launch-memory.json`.

**Fast mode is read with the right field.** The Claude Code 2.1.258 binary
contains `speed==="fast"`, which is the field and value the reader tests.
Julian has never used it: across 114,395 recorded usage rows the value is
`standard` 114,249 times and absent 146 times. `inference_geo` is never `us`.
So both modifiers are correct by construction and unexercised by his data.

## What was wrong, and what changed

**Repair crews were never priced.** `job-cost.mjs` said all three record
families are read the same way, and ADR-0057 said brains and repairs are priced
beside Jobs, but `attemptsInWindow` read only the pipelines and brains roots.
30 repair generations in one measured day were invisible. Added
`repairAttempts` and a `repairsRoot`, wired through `cost-service.mjs` and
`server.mjs`. The measured day moved from 123 attempts to 156.

**A figure priced from tokens said nothing about being a floor.** A Claude
conversation that is still running, or that was interrupted, has no ledger that
is still the last word, so its tokens are priced instead. That is a floor:
background calls and the long-context SKU reach the ledger and never the
transcript. Nothing said so. The summary reported such a figure as complete.
Conversations now carry machine-readable `gaps`, the summary folds them into
`excluded` with a count, and a figure with a gap is not complete. 12 of 114
conversations in the measured day carry it.

**A codex counter restart lost one step.** Codex restarts its cumulative total
inside a thread when the context is compacted. The old difference clamped the
falling step to zero, which lost the tokens in it. A fall is now read as the
start of a second run and the new total is charged whole.

**A broken harness registry left the bar reading an ellipsis forever.** The
refresh returned early and never published a snapshot, so the top bar showed
`…` with no reason. It now publishes a snapshot that names the registry error.

**A gateway harness was read as the vendor's own account.** ADR-0057 says the
same model id served through a gateway bills at a different rate, and that
pricing it at the vendor's rate would be a confident wrong answer. The family
fallback did exactly that: `claude-gw` resolved to `anthropic` and `codex-gw`
to `openai`. `claude-gw` runs `harness run claudecode` against a managed
account, not Julian's own. Nothing is mispriced today only because both
entries declare no `transcripts` folder, and the recommended next step is to
add one. A harness whose id ends in `-gw` is no longer inferred. It must
declare its provider, and until it does its work is reported unpriced. A
profile shim is not a gateway: `claude-otto` is an alias that only sets
`CLAUDE_CONFIG_DIR` on the same account, so it still infers `anthropic`.

**`pricing.md.proposed` would have lost the fast-mode rates.** The Document
replaces a seeded rate outright rather than merging with it, so installing the
proposed file would have priced fast-mode Opus 5 work at half rate. The three
models that have a fast rate now carry it, and the rule is written in the file
and in ADR-0057.

## The gates

`npm run check`, `npm run governance`, `npm run build` and the function
docstring lint each exit 0.

The cost and launch surface passes: 65 focused tests over the five cost test
files plus `transcript-receipt` and `harness-conversation`, and 8 provider
tests including the gateway rule.

No regressions, established by running the same files on this branch and on a
clean `c757254e` and comparing the failure sets.

- The launch surface, `launch-environment` with `launch-catalog` and
  `brain-launch`: 16 failures on both, the same names on both. The branch adds
  66 passes and removes none.
- The 30 test files that touch anything this Goal changed: 45 failures on the
  branch, 43 on `c757254e`, with 10 failing only on the branch and 8 only on
  `c757254e`. That asymmetry is contention, not a regression. The four files
  that carried every branch-only failure were re-run alone and sequentially on
  each side: 13 failures on the branch and the same 13 on `c757254e`, name for
  name.

The complete 248-file `app` suite was not run to the end. Several UI test files
never exit, so a worker stops on one and the run does not finish. The brief
already records one of them, `focus-shell-paint-lifecycle-ui.test.mjs`. Two
attempts ran for tens of minutes and were stopped; while they ran, both sides
produced the same results.

## What is still true and still open

`codex-gw` and `claude-gw` declare no `transcripts` folder. 28 attempts in the
measured day are unattributable for that reason alone, and both wrappers run on
the real `~/.codex` and `~/.claude`. Adding those paths is a vault edit, and
the same edit must give each entry a `provider`. Without one, the recovered
attempts stay unpriced; with the wrong one, they are priced at a rate that is
not the gateway's. `pricing.md.proposed` reserves a `litellm` entry for it.

Codex work has no dollar until openai rates are written into `pricing.md`. The
measured day moved 1.78 billion codex tokens that the figure names and does not
price.

718 of 1,396 stored attempts carry no `resolvedLaunch.ref`. Each one is named
in the breakdown as "the attempt recorded no harness".

The ResetData context window is still 1,000,000 in `models.json` against
Julian's note of 800,000. Nothing in the cost path depends on it. pi's own
footer percentage does.

`focus-shell-paint-lifecycle-ui.test.mjs` fails and hangs. It fails the same way
on a clean checkout of `c757254e`, so it is not this work.
