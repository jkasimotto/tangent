# tangent

Tangent provides a native work shell, conversation telemetry, evals, and structural code search for coding agents.

Four main products ship here:

- **Agent Shell**: organize work by Area and Goal. Start native agent sessions, or a pipeline of steps on a Goal where each step agent hands facts to the next.
- **usage**: read your own agent activity. A local UI and queryable API over every Claude Code, Codex, and Gemini CLI session on your machine.
- **eval**: compare. Run the same task under different contexts, prompts, or models and look at the results side by side.
- **search**: structural code search built for coding agents. A CLI that indexes a repo's source and answers "where is X defined, who calls Y" without reading whole files.

## Get started

You need Node 20 or newer and an authenticated `claude`, `codex`, or `gemini` CLI on your PATH.

```bash
git clone <repo-url>
cd tangent
npm install && npm run build && npm link
tangent usage ui
```

Open the Usage UI to browse your existing sessions. To run your first eval right away:

```bash
tangent eval run \
  --prompt evals/haiku-poems/prompts/task.md \
  --context empty --context repo \
  --agent claude-cli --model claude-sonnet-4-6
```

That runs the same task twice, once with no context and once with your repo's guidance files, and lays the results side by side. Open `tangent eval ui` to compare.

To build and open the native Agent Shell:

```bash
npm --prefix packages/agent-shell/app install
npm --prefix packages/agent-shell/app run app
```

Open a Goal's Start agent control and type the steps, for example design, review, implement, each with its own harness, model, and effort. Every step is an open tmux conversation; the step agent finishes with `tangent send brain --done "<note>"` and the brain starts the next step.

## Create your own eval

Copy `skills/setup-tangent-eval/` into your agent's skills folder, then ask it to create an eval. For example:

> Create an eval comparing [a model / a context / a prompt / a working directory] on [your task].

The skill handles the setup. `evals/haiku-poems/` is a complete worked example you can clone.

## usage — read your agent activity

`tangent usage` reads the native Claude Code, Codex, and Gemini CLI transcripts already on your disk and indexes them under `~/.tangent/usage`. Nothing leaves your machine. Run `tangent usage ui` to browse sessions, filter by project or agent, and drill into individual conversations.

## eval — compare contexts, prompts, and models

An eval runs the same task several times, changing one thing each run, and lays the results side by side. The thing you change is a *variant*. Repeat a flag and each value becomes a variant:

```bash
tangent eval run \
  --prompt evals/haiku-poems/prompts/task.md \
  --context empty --context repo \
  --agent claude-cli --model claude-sonnet-4-6
```

That runs the same task twice under Claude, once with no project context and once with your repo's context. Results land in `~/.tangent/eval/runs/`. Run `tangent eval ui` to open the side-by-side comparison. `evals/haiku-poems/` is a complete worked example.

What you can vary:

- `--prompt` and `--context` are repeatable. Pass each more than once to compare prompts or contexts in a single run.
- `--agent` picks the runner: `claude-cli`, `codex-cli`, or `gemini-cli` (or `manual` to drive it yourself as a human baseline).
- `--model` picks the model. For `claude-cli`: `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5`. For `codex-cli`: `gpt-4.1`, `gpt-4.1-mini`. For `gemini-cli`: `gemini-2.5-pro`, `gemini-2.0-flash`.
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

## search — structural code search for agents

`tangent search` indexes a repo's TypeScript/JavaScript and Dart source into a local SQLite database under `~/.tangent/search/` and answers structural questions about the code. It is syntax-aware but deliberately lightweight: no tsserver, no compiler API, no Dart analyzer, no LSP.

```bash
tangent search index                  # build or refresh the index (fast when little changed)
tangent search "query"                # find symbols, files, and tests
tangent search symbol SymbolName      # where a symbol is defined
tangent search callers SymbolName     # who calls it (callees works too)
tangent search tests src/file.ts      # likely tests for a path or symbol
tangent search skeleton src/file.ts   # file outline, so you read only the ranges you need
tangent search open-plan "<task>"     # recommended read order for a task
```

The point is agent efficiency. Grepping and paging through 4k-line files burns most of an agent's context on re-reads. With the index, the agent orients with `open-plan`, outlines big files with `skeleton`, and answers definition and call-graph questions directly, reading only the line ranges it needs.

`tangent search status` shows index state, and `tangent search rg` runs ripgrep with the index's excludes as a fallback for exact-text misses. Install `skills/tangent-search/` into your agent's skills folder to teach it the full workflow.

## Let the agent set it up

This repo ships skills in `skills/`. Most of the time, just ask your coding agent to build and run an eval for you — install the skill for your agent and it handles the setup.

- `skills/setup-tangent-eval/` — have the agent build and run an eval for you.
- `skills/tangent-search/` — teach the agent to orient with structural search instead of grepping and paging through files.
- `skills/verify-app/` — boot the UI read-only and verify a change in a browser.

To use a skill in another project, copy its directory into that project's agent skill folder.
