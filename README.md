# tangent

Tangent gives you a queryable API over Claude Code, Codex, and Gemini CLI sessions, and lets you evaluate under different context, prompts, and models and look at the results next to each other.

Two things ship here, mounted together by `tangent ui`:

- **usage** — read your own agent activity. A local UI and queryable API over every Claude Code, Codex, and Gemini CLI session on your machine.
- **eval** — compare. Run the same task under different contexts, prompts, or models and look at the results side by side.

## Get started

You need Node 20 or newer and an authenticated `claude`, `codex`, or `gemini` CLI on your PATH.

```bash
git clone <repo-url>
cd tangent
npm install && npm run build && npm link
```

That builds every package and puts the `tangent` command on your PATH. Then:

```bash
tangent ui
```

## usage — read your agent activity

`tangent usage` reads the native Claude Code, Codex, and Gemini CLI transcripts already on your disk and indexes them under `~/.tangent/usage`. Nothing leaves your machine. It discovers Claude Code conversations under `~/.claude*/projects`, Codex rollouts under `~/.codex/sessions`, and Gemini CLI chat sessions under `~/.gemini/tmp/<project>/chats`.

Most of the time you live in the UI (the Usage panel of `tangent ui`), which defaults to every project and every agent across all your Claude profiles for the last week. From the command line:

```bash
tangent usage today                      # recent activity, human-readable
tangent usage transcript codex:019ea3ad  # one full session
tangent usage events --json              # the normalized event stream, for your own tooling
```

## eval — compare contexts, prompts, and models

An eval runs the same task several times, changing one thing each run, and lays the results side by side. The thing you change is a *variant*. Repeat a flag and each value becomes a variant:

```bash
tangent eval run \
  --prompt evals/haiku-poems/prompts/task.md \
  --context empty --context repo \
  --agent claude-cli --model claude-sonnet-4-6
```

That runs the same task twice under Claude, once with no project context and once with your repo's context. To work from a saved spec:

```bash
tangent eval run evals/haiku-poems/eval.json   # run a saved spec
tangent eval report latest                     # compact text report
tangent eval ui latest                         # the side-by-side UI
```

Specs and prompts live in `evals/<name>/`; results land in `~/.tangent/eval/runs/`. `evals/haiku-poems/` is a complete worked example.

What you can vary:

- `--prompt` and `--context` are repeatable. Pass each more than once to compare prompts or contexts in a single run.
- `--agent` picks the runner: `claude-cli` or `codex-cli` (or `manual` to drive it yourself as a human baseline).
- `--model` picks the model. For `claude-cli`, pass any Claude model ID: `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5`. For `codex-cli`, pass any OpenAI model: `gpt-4.1`, `gpt-4.1-mini`.
- `--cwd` sets the working directory the agent starts from.

### What "context" means here, and how to capture it

Context is the set of files that quietly steer a coding agent: `CLAUDE.md`, `AGENTS.md`, `.claude/`, and friends. They never appear in your prompt, yet they shape every answer the agent gives. An eval lets you measure that influence instead of guessing at it.

`--context` accepts four kinds, and you mix them in one run to compare:

- `empty` — no context files at all. The baseline: what does the model do with nothing but the task?
- `repo` — your repo's context files as committed at the base ref.
- `git-ref:<ref>` — context as it was at any commit or branch, so you can pit last month's `CLAUDE.md` against today's.
- `snapshot:<ref>` — a frozen capture, so a comparison stays reproducible even after you keep editing the originals.

Freeze the current files into a reusable snapshot:

```bash
tangent eval context capture my-context   # add --include-ancestors to pull in parent-directory context files
```

The classic experiment is `--context empty --context repo`: same task, same model, and the only difference is whether the agent can see your guidance files. The report tells you whether they earned their keep.

## Let the agent set it up

This repo ships a `setup-tangent-eval` skill in `.claude/skills/`. Most of the time, just open this repo in Claude Code and ask it to build and run an eval for you — the skill loads automatically and handles the setup.

To use the skill in another project, copy `.claude/skills/setup-tangent-eval/` into that project's `.claude/skills/` or into your `~/.claude/skills/`.
