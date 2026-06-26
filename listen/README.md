# listen

Event-driven agent pipelines for any project. `listen` watches for new work landing on disk and runs
a **fresh agent per item** through stages you define (e.g. scope → ux → plan → implement → review →
deploy). It is the generalization of Tangent's feedback-to-shipped-features pipeline: same engine,
your stages.

## Why it is shaped this way

- **Event-driven, not polling.** A watcher (`fs.watch`) fires a dispatch sweep when feedback is
  captured, a stage advances an item, or a user answers. No timers, no idle agents.
- **Fresh process per item.** Each work item is handled by its own short-lived agent in its own tmux
  session, so one item's context never pollutes another. The tmux session is also the in-flight lock,
  which makes dispatch idempotent.
- **Disk is the message bus.** Stages never call each other. Each item is a dossier folder under the
  state dir with a `manifest.json` status cursor and accumulating `NN-*.md` artifacts. An agent reads
  upstream artifacts, writes its own, and advances the status; that status change is itself an event
  that dispatches the next stage.
- **Stages are data.** The whole pipeline is declared in `.listen/config.json`. Reorder, rename, add,
  or remove stages to fit your project. The prompts are editable files you own.

## Install

It is a self-contained Node package (needs `node >= 20`, `tmux`, and your agent CLI, default
`claude`). Copy the `listen/` folder into a project, or `npm install -g <path-to-listen>`. Then:

```
listen init                 # scaffold .listen/ (config + editable stage prompts)
# edit .listen/prompts/*.md for your project's build/test/deploy and conventions
listen start --yes          # start the watcher
listen feedback "..."       # drop work in (or point your app at .listen/feedback.jsonl)
listen status               # see items by stage + running agents
listen stop                 # stop everything
```

## Configuring

`.listen/config.json` (scaffolded by `init`, fully commented):

- `feedbackFile` / `feedbackKey` — where new work lands and the field that ids each entry.
- `stateDir` / `logDir` — where item dossiers and agent logs live.
- `agent` — the command run per item (`{ "cmd": "claude", "args": ["-p", ...] }`). A `{PROMPT}`
  token in `args` is substituted; otherwise the stage prompt is appended. Swap to any agent CLI.
- `statuses` — the status flow. New items start at the first status.
- `stages` — one agent per stage: `name`, `inbox` (the status it processes), `prompt`. `batch: true`
  makes a stage read the feedback file instead of items (triage). `requiresFile` only dispatches an
  item once that artifact exists in its dossier (e.g. wait for `12-answers.md`).

## What you customize vs. what is generic

Generic (the engine): the watcher, dispatcher, dossier state CLI, per-item agent runner, run/stop.
Yours: the **prompts** (your project's validation, architecture, deploy steps), the **status flow**,
the **paths**, and the **feedback source**. Edit `.listen/prompts/*.md` and `.listen/config.json`.

## Safety

`listen start` runs your agent **unattended with whatever permissions you configure** (the default
prompts assume `--dangerously-skip-permissions`), so it can edit files and, depending on your deploy
prompt, commit and ship. That is why `start` refuses without `--yes`. The brakes are yours to set: a
strict promotion gate in `0-feedback.md`, isolation in `4-implement.md`, and a real review in
`5-review.md` (v1 is a pass-through stub).

## Commands

`init` · `start [--yes]` · `stop` · `status` · `feedback "<text>"` · `triage <id> [status] [note]` ·
`promote --slug S [--title T] [--feedback id,id]` · `dossier <list|show|path|create|advance>`

The `dossier`, `promote`, and `triage` commands are what stage agents call from their prompts to read
and advance item state.
