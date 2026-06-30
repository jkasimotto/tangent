# tangent

`tangent` is a local toolkit for the coding agents you already use. It captures your Claude Code, Codex, and Gemini CLI sessions, keeps them on your machine, and lets you run side-by-side evals to see how a change to your prompt, your context files, or your model actually affects the agent.

Two things ship here, mounted together by `tangent ui`:

- **usage** — read your own agent activity. A local UI and a queryable API over every Claude Code, Codex, and Gemini CLI session on your machine.
- **eval** — compare. Run the same task under different contexts, prompts, or models and look at the results next to each other.

## Get started

You need Node 20 or newer. Running evals also needs an authenticated `claude` or `codex` CLI on your PATH, since the eval runner shells out to whichever you pick. (One native dependency, `better-sqlite3`, compiles from source when no prebuilt binary fits your platform; that needs a C/C++ toolchain, `build-essential` and `python3` on Linux or Xcode Command Line Tools on macOS.)

```bash
git clone <repo-url>
cd tangent
npm install && npm run build && npm link
```

That builds every package and puts the `tangent` command on your PATH. It is safe to re-run. Then start the combined interface:

```bash
tangent ui
```

To have Claude Code do the eval work for you, enable the `setup-tangent-eval` skill (see [Drive it from Claude Code](#drive-it-from-claude-code)). It loads automatically when you open this repo.

## usage — read your agent activity

`tangent usage` reads the native Claude Code, Codex, and Gemini CLI transcripts already on your disk and indexes them under `~/.tangent/usage`. Nothing leaves your machine. It discovers Claude Code conversations under `~/.claude*/projects`, Codex rollouts under `~/.codex/sessions`, and Gemini CLI chat sessions under `~/.gemini/tmp/<project>/chats` (both the single-document `session-*.json` and the newer `session-*.jsonl` formats).

Most of the time you live in the UI (the Usage panel of `tangent ui`), which defaults to every project and every agent across all your Claude profiles for the last week (`--days`, default 7). From the command line, the same data is also an API:

```bash
tangent usage today                      # recent activity, human-readable
tangent usage transcript codex:019ea3ad  # one full session
tangent usage events --json              # the normalized event stream, for your own tooling
tangent usage export                     # raw provenance
```

## eval — compare contexts, prompts, and models

An eval runs the same task several times, changing one thing each run, and lays the results side by side. The thing you change is a *variant*. Repeat a flag and each value becomes a variant:

```bash
tangent eval quick \
  --prompt evals/haiku-poems/prompts/task.md \
  --context empty --context repo \
  --agent codex-cli --model gpt-5.4-mini
```

That runs the same task twice under Codex, once with no project context and once with your repo's context, then lets you compare them. To work from a saved spec instead:

```bash
tangent eval run evals/haiku-poems/eval.json   # run a saved spec
tangent eval report latest                     # compact text report
tangent eval ui latest                         # the side-by-side UI
```

Specs and prompts live in `evals/<name>/`; results land in `~/.tangent/eval/runs/`. `evals/haiku-poems/` is a complete worked example.

What you can vary:

- `--prompt` and `--context` are repeatable. Pass each more than once to compare prompts or contexts in a single run.
- `--agent` picks one runner for the run: `claude-cli`, `codex-cli`, or `manual` (you drive it yourself, as a human baseline).
- `--model` picks one model: `gpt-5.4`, `gpt-5.4-mini`, `sonnet`, `haiku`, or `opus`.

### What "context" means here, and how to capture it

Context is the set of files that quietly steer a coding agent: `CLAUDE.md`, `AGENTS.md`, `.claude/`, and friends. They never appear in your prompt, yet they shape every answer the agent gives. An eval lets you measure that influence instead of guessing at it.

`--context` accepts four kinds, and you mix them in one run to compare:

- `empty` — no context files at all. The baseline: what does the model do with nothing but the task?
- `repo` — your repo's context files as committed at the base ref.
- `git-ref:<ref>` — context as it was at any commit or branch, so you can pit last month's `CLAUDE.md` against today's.
- `snapshot:<ref>` — a frozen capture, so a comparison stays reproducible even after you keep editing the originals.

Freeze the current files into a reusable snapshot with:

```bash
tangent eval context capture my-context   # add --include-ancestors to pull in parent-directory context files
```

The classic experiment is `--context empty --context repo`: same task, same model, and the only difference is whether the agent can see your guidance files. The report tells you whether they earned their keep.

## Drive it from Claude Code

This repo ships skills that let your agent do the work for you (`.claude/skills/`):

- `setup-tangent-eval` — have Claude Code build and run an eval for you.
- `verify-app` — boot the UI read-only and verify a change in a browser.

They load automatically when you open this repo in Claude Code. To use one elsewhere, copy its directory into that project's `.claude/skills/` or into your `~/.claude/skills/`.

## Shell completion

```bash
tangent completion zsh  > ~/.zsh/completions/_tangent
tangent completion bash > ~/.tangent-completion.bash
tangent completion fish > ~/.config/fish/completions/tangent.fish
```

## Standalone installs

Each app is also publishable on its own, with a collision-resistant binary:

```bash
npm install @tangent/usage   # tangent-usage today
npm install @tangent/eval    # tangent-eval ui
```

The full-suite `tangent` binary keeps the shorter `tangent usage` and `tangent eval` subcommands.
