# Feature pipeline: a system of loops

This turns in-app feedback into shipped features through a chain of autonomous loops. Each loop owns
exactly one step. Loops never call each other; they coordinate only through a **dossier folder per
feature** on disk. That folder is the message bus, so the pipeline is durable across ticks, restarts,
and days of waiting on you.

## The flow

```
feedback.jsonl  ──[0 feedback]──►  promoted
   (⌘/ capture)                       │
                  [1 scope] ◄─────────┘   ⇄ 11-questions.md ↔ 12-answers.md  (you, batched)
                      │ scoped
                  [2 ux]                 context: ux-short.md + ux.md + current Tangent IA
                      │ ux-done
                  [3 plan]               context: ARCHITECTURE + package boundaries + coding rules
                      │ planned
                  [4 implement]          in a per-feature git worktree (dev/<slug>)
                      │ implemented
                  [5 review]             v1 STUB: passes straight through (you design the real one)
                      │ deploy-ready
                  [6 deploy]             merge dev/<slug> → main, rebuild, refresh app + PWA
                      │ deployed
                     done
```

Each loop, every tick, does the same three things and nothing else:
**read its inbox by status → read upstream artifacts → write its own artifact + advance the status.**

## The dossier (message bus)

One folder per feature at `~/.tangent/features/<slug>/` (honors `TANGENT_HOME` like the rest of the
app). `feature.json` is the manifest and status cursor; artifacts accumulate beside it:

| File | Written by | Holds |
|------|-----------|-------|
| `feature.json`        | every stage (via `dossier.mjs`) | status cursor, source feedback ids, recurrence, worktree branch, stage log |
| `00-feedback.md`      | 0 feedback   | every source feedback entry verbatim + triage judgment |
| `10-scope.md`         | 1 scope      | the real problem, minimal solution, explicit non-goals |
| `11-questions.md`     | 1 scope      | batched questions for you (each with a default) |
| `12-answers.md`       | **you**      | your batched answers (unblocks scoping) |
| `20-ux.md`            | 2 ux         | user flow, IA placement, first/second/never hierarchy, decisions |
| `30-plan.md`          | 3 plan       | files, public APIs, seams, schema, validation steps |
| `40-implementation.md`| 4 implement  | what changed, worktree branch, validation results |
| `50-review.md`        | 5 review     | (when you build the real review loop) |
| `60-deploy.md`        | 6 deploy     | merge SHA, what shipped, how to see it |

### Status flow (one stage owns each transition)

```
promoted → scoped | awaiting-answers     (scope; awaiting-answers resumes through scope)
scoped   → ux-done                        (ux)
ux-done  → planned                        (plan)
planned  → implemented                    (implement)
implemented → deploy-ready | planned      (review; v1 stub always passes to deploy-ready)
deploy-ready → deployed                   (deploy)
```

## The state CLI: `dossier.mjs`

The single writer of `feature.json`, so the schema stays consistent no matter which stage writes it.

```
node pipeline/dossier.mjs list <status>                     slugs in a status, oldest first
node pipeline/dossier.mjs create --slug S --title T [--recurrence N] [--feedback id,id]
node pipeline/dossier.mjs show <slug>                       print the manifest
node pipeline/dossier.mjs path <slug>                       print the dossier directory
node pipeline/dossier.mjs advance <slug> <status> [--note "..."] [--block reason|--unblock] [--worktree branch]
```

Stages always resolve a dossier's directory with `path` rather than hardcoding `~/.tangent`.

## Running the loops

```
TANGENT_LOOPS_YES=1 ./pipeline/run-loops.sh     start the watcher (+ an initial dispatch sweep)
./pipeline/stop-loops.sh                          stop the watcher + any in-flight agents
tmux attach -t tangent-loop-watch                 watch the dispatcher
tmux ls | grep tangent-loop                       list the watcher + in-flight per-feature agents
```

The pipeline is **event-driven**, not a set of always-on loops. One tmux session (`tangent-loop-watch`)
runs the watcher (`watch.mjs`), which watches `~/.tangent` with Node's recursive `fs.watch`. On any
change (new feedback captured, a stage advancing a feature, you answering questions), it debounces
~1.5s and runs the dispatcher (`dispatch.mjs`). A cron job calling `node pipeline/dispatch.mjs` every
minute is a coarser polling alternative.

The dispatcher scans every stage's inbox and, for each work item **not already in flight**, spawns a
**fresh `claude -p` for that one feature** (`loop-stage.sh`) in its own tmux session
`tangent-loop-<stage>-<slug>` (or `tangent-loop-feedback` for the triage batch). Fresh process per
feature means **clean context per feature**: one feature's reasoning never leaks into the next. The
agent does its single unit of work, advances the dossier, and exits, which ends the session; that
status advance is itself a `~/.tangent` change, so the watcher immediately dispatches the next stage.

The in-flight lock is the tmux session itself: a feature whose `tangent-loop-<stage>-<slug>` session
already exists is skipped, so repeated dispatches are idempotent. `awaiting-answers` features are not
re-dispatched until you write `12-answers.md` (the watcher sees it land and resumes scope). Agents are
headless but their panes are attachable and mirrored to `~/.tangent/loops/<stage>-<slug>.log`; when an
agent needs a human (parked on answers, blocked, or shipped something you were waiting on) it pings you
with `terminal-notifier`.

Knobs: `TANGENT_LOOPS_MODEL` (`claude --model`), `TANGENT_LOOPS_LOG_DIR`, `TANGENT_HOME`. There is no
tick/sleep timer; agents run only when there is work.

### ⚠️ Autonomy and safety

The loops run with `--dangerously-skip-permissions` so they can act unattended. They will, on their
own: edit files, create git worktrees, run builds, **merge to `main`, and redeploy the app**. That is
why `run-loops.sh` refuses to start without `TANGENT_LOOPS_YES=1`. The brakes that keep this sane:

- **Promotion gate (loop 0).** Nothing enters the pipeline unless feedback recurs ≥ 3 times or is a
  single genuinely-pressing, unambiguous item. The idea log is curated, not drained.
- **Worktree isolation (loop 4).** Implementation never touches the checkout you run live; each
  feature builds on its own `dev/<slug>` branch and must pass `check`/`test`/`governance`/`build`.
- **Review slot (loop 5).** Currently a pass-through stub. Replace `prompts/5-review.md` with a real
  review before you trust the pipeline to deploy unattended.

## Customizing a loop

Every loop is just a markdown prompt in `pipeline/prompts/`. Edit the file; the next dispatch picks it up.
The review loop (`5-review.md`) is the one you intend to design yourself: keep its contract (inbox
`implemented`; outbox `deploy-ready` to ship or `planned` to send back for rework).
