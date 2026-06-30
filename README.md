# tangent

`tangent` is a local toolkit for working with coding-agent conversations: it captures
your Claude Code and Codex activity, shows it in a local UI, and runs side-by-side
evals to compare prompts, context, and models on real tasks.

Two surfaces ship in this repo, mounted together by `tangent ui`:

- **usage** (`tangent usage`): local conversation telemetry and readable activity views for Claude Code and Codex sessions, plus correction-rate metrics.
- **eval** (`tangent eval`): prepare, run, and report coding-agent evals that compare task variants.

A third command, **rollup** (`tangent rollup`), turns Usage conversations into private
daily engineering notes and powers the correction-metrics panel in the Usage UI.

## Setup

Prerequisites:

- **Node 20 or newer.**
- A **C/C++ toolchain** for the one native dependency (`better-sqlite3`): `build-essential` and `python3` on Linux, or Xcode Command Line Tools on macOS. Only needed if no prebuilt binary matches your platform.
- For running evals: an authenticated **`claude`** or **`codex`** CLI on your PATH (the eval runner shells out to whichever agent you select).

Install:

```bash
git clone <repo-url>
cd tangent
./install.sh
```

`./install.sh` checks your Node version, installs dependencies, builds every package,
and links the `tangent` command onto your PATH. It is safe to re-run. (Equivalent
manual steps: `npm install && npm run build && npm link`.)

Then start the combined interface:

```bash
tangent ui
```

`usage` and `eval` are workspace packages built by the install step; there is no
separate "install usage" or "install eval" step.

## Usage

```bash
tangent ui                 # combined Usage + Eval UI (start here)

tangent usage today        # recent activity, human-readable
tangent usage transcript codex:019ea3ad
```

`usage` reads Claude Code and Codex native transcripts by default and indexes
normalized activity under `~/.tangent/usage`. It defaults to all projects across every
Claude profile, bounded to a recent window (`--days`, default 7). Raw provenance and
event streams live behind `usage export` and `usage events --json`.

## Rollup

```bash
tangent rollup today
tangent rollup yesterday
tangent rollup 20260601-20260610   # one combined note for an inclusive range
```

`rollup` reads selected Usage turns and uses one summary-provider call to write a
private note. Notes and processing state live under `~/.tangent/rollup/repos/<repo>`
by default; repo-local output is opt-in:

```bash
tangent rollup init . --output repo-local-private    # writes to .tangent/rollup/, git-excluded
tangent rollup init . --base-dir ~/notes/tangent      # or a custom location
```

## Eval

```bash
tangent eval quick \
  --prompt evals/haiku-poems/prompts/task.md \
  --context empty --context repo \
  --agent codex-cli --model gpt-5.4-mini

tangent eval run evals/haiku-poems/eval.json
tangent eval report latest
tangent eval ui latest
```

Eval specs and prompts live under `evals/<name>/`; run artifacts land under
`~/.tangent/eval/runs/`. See `evals/haiku-poems/` for a complete worked example, and the
`setup-tangent-eval` skill (in `.claude/skills/`) for the full workflow. Personal evals
that hardcode absolute repo paths are git-ignored by default (see `.gitignore`).

## Configure capture

```bash
tangent setup --provider codex --usage --rollup --summary-provider codex-cli --model gpt-5.4-mini --yes
tangent status
```

## Claude skills

This repo ships Claude Code skills under `.claude/skills/`:

- `setup-tangent-eval`: create and run a `tangent eval`.
- `verify-app`: boot the UI read-only and verify a change in a browser.

They load automatically in Claude Code when you open this repo. To use one in another
project or for yourself globally, copy the skill directory into that project's
`.claude/skills/` or into `~/.claude/skills/`.

## Shell completion

```bash
tangent completion zsh  > ~/.zsh/completions/_tangent
tangent completion bash > ~/.tangent-completion.bash
tangent completion fish > ~/.config/fish/completions/tangent.fish
```

## Standalone installs

Each app package is also publishable on its own, with a collision-resistant binary:

```bash
npm install @tangent/usage   # tangent-usage today
npm install @tangent/rollup  # tangent-rollup today
npm install @tangent/eval    # tangent-eval ui
```

The full-suite `tangent` binary keeps the shorter `tangent usage`, `tangent rollup`,
and `tangent eval` subcommands.
