# tangent

`tangent` is an npm workspace for local coding-agent conversation tools.

Packages:

- `@tangent/core`: shared command metadata, help, and shell completion primitives.
- `@convos/convos` / `convos`: local conversation telemetry and queryability for Claude Code and Codex sessions.
- `@tangent/daily` / `daily`: private daily engineering notes generated from `convos` conversations.

## Quick start

```bash
npm install
npm run build

tangent convos status .
tangent convos hooks install --provider codex --scope repo-local

tangent daily init . --summary-provider codex-cli --model gpt-5.4-mini
tangent daily status .
tangent daily process . --date today
tangent daily today
tangent daily yesterday
tangent daily 2026-06-07
```

`convos` stores conversation telemetry under `~/.convos`.

`daily` stores private generated notes, cached digests, and processing state under `~/.tangent/daily/repos/<repo-name>` by default. Repo-local output is opt-in:

```bash
tangent daily init . --output repo-local-private
```

Repo-local `daily` output is written to `.tangent/daily/` and excluded through `.git/info/exclude`.

Custom locations are supported:

```bash
tangent daily init . --base-dir ~/daily-agent-notes/otto-tangent
tangent daily config set output.baseDir ~/daily-agent-notes/otto-tangent
```

Shell completion is generated from the shared command registry:

```bash
tangent completion zsh > ~/.zsh/completions/_tangent
tangent completion bash > ~/.tangent-completion.bash
tangent completion fish > ~/.config/fish/completions/tangent.fish
```
