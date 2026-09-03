# Statuslines: the same four facts on three harnesses

Julian asked for dollar, context, directory and model on every harness. Claude
Code already shows all four. This document records what each harness can do,
the mechanism it does it with, what was changed, and what was only proposed.

Claude Code's order is the shared order:

```
[Opus 5] ▓▓▓▓░░░░░░ 38% (76k/200k) $23.95 ~/Projects/otto-tangent
  model     context bar   context     dollar   directory
```

## What each harness shows

| Harness | Mechanism | Model | Context | Dollar | Directory |
|---|---|---|---|---|---|
| claude, claude-otto | `statusLine` command hook, a shell script on stdin JSON | yes | yes | yes | yes |
| pi-code | built-in footer, priced from `~/.pi/agent/models.json` | yes | yes | yes, once the rates are real | yes |
| codex, codex-otto, codex-gw | `[tui] status_line`, a fixed item picker | yes | yes | **no** | yes |

## Claude Code

Already correct, and unchanged. `~/.claude/statusline.sh` reads
`.cost.total_cost_usd`, the context window, the model display name and the
working directory from the JSON it receives on stdin.

`~/.claude/statusline.sh` and `~/.claude-otto/statusline.sh` are two separate
files that are byte-identical today. They must be edited together, or one made
a symlink to the other.

The dollar is Claude Code's own running ledger. It survives a resume, is zeroed
by `/clear`, and already includes subagents, because a subagent records into
the same in-process total.

## pi-code

pi's footer already prints the model with its thinking level, the context
percentage against the window, the directory with its git branch, and the
provider when more than one is configured. It prints the dollar only when the
session's cost total is non-zero:

```js
if (usageTotals.cost || usingSubscription) { ... }   // dist/modes/interactive/components/footer.js
```

That total was zero for one reason: pi prices each message from the `cost`
block in `~/.pi/agent/models.json` (`dist/core/provider-composer.js` reads
`definition.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }`), and
the ResetData model carried four zeros.

**Changed, with a backup.** `~/.pi/agent/models.json` now gives
`resetdata-glm` the rates Julian supplied on 2026-09-02:

```json
"cost": { "input": 1.58, "output": 4.96, "cacheRead": 0.16, "cacheWrite": 1.58 }
```

The previous file is kept at `~/.pi/agent/models.json.backup-2026-09-03-cost-attribution`.
Restore it to undo the change.

Cache writes bill at the input rate, because the endpoint publishes no separate
write price. That assumption is stated here because it is an assumption.

**Still unpriced.** `zai-openai` and `zai-anthropic` carry no `cost` block at
all and no rates were supplied for them, so a pi session on either of those
providers still shows no dollar. Rates for them belong in this file and in
`pricing.md`.

**One difference from Claude Code's order.** pi prints the dollar before the
context, where Claude prints it after. Correcting that means patching the
footer inside `node_modules`, which the next pi upgrade would overwrite. Not
done.

**Open, and unrelated to cost.** `models.json` says the ResetData context
window is 1,000,000 and Julian's own note says 800,000. pi's context percentage
depends on which is right. The largest single request across 34,071 pi
assistant messages is 528,565 tokens, so measurement settles nothing. Nothing
in the cost path depends on it.

## Codex

Codex cannot show a dollar, and this is now settled rather than assumed.

Its statusline is configured by the `/statusline` slash command and persisted
as `[tui] status_line` in `~/.codex/config.toml`. It is a fixed item picker,
not a shell hook: there is no way to run a script.

Two cost items exist in the binary, `estimated-thread-cost` and
`thread-credits`. The binary's own help text for them reads:

> Estimated current-thread cost in USD (Enterprise workspaces only; omitted when unavailable)

Julian's `plan_type` is `pro`, so both are omitted. There is nothing to try and
nothing to configure. Codex also ships no pricing data at all, so even a
rendered figure would come from OpenAI rather than from Tangent.

**Unchanged, deliberately.** `~/.codex/config.toml` already reads:

```toml
[tui]
status_line = ["model-with-reasoning", "context-used", "weekly-limit", "current-dir"]
status_line_use_colors = true
```

That is model, context, quota, directory: three of the four facts in Claude's
order, with the weekly quota in the position Claude uses for the dollar. On a
Pro plan the weekly quota is the binding constraint, not dollars; one rollout
on 2026-09-02 recorded `rate_limits.primary.used_percent` at 99.0 with a reset
seven days out. Keeping it there is the better line, and Tangent supplies the
codex dollar in its own top bar.

Codex spend has no dollar figure in Tangent either until a rate is written into
`~/.tangent/trees/pricing.md`. Until then the top-bar breakdown names codex and
prints the tokens it moved, rather than counting it as zero.

## Where Tangent gets its own numbers

Nothing above feeds the top-bar figure. Tangent reads the transcripts each
harness writes, which is durable, covers finished work, and does not depend on
a statusline being installed. Design pass B proposed that each statusline also
write a small sidecar JSON file per tmux session, which would give Tangent a
live dollar and replace the screen-scraping regular expression in
`pane-state.mjs`. That is a good idea and it is recorded in
`decision.md` as deliberately out of scope here: it changes how Tangent
observes every live pane, which is load-bearing for liveness, and it buys a
fresher number rather than a more correct one.
