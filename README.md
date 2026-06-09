# tangent

`tangent` is an npm workspace for local coding-agent conversation tools.

Packages:

- `@tangent/core`: shared command metadata, help, and shell completion primitives.
- `@tangent/usage` / `usage`: local conversation telemetry and human-readable activity views for Claude Code and Codex sessions.
- `@tangent/daily` / `daily`: private daily engineering notes generated from `usage` conversations.
- `@tangent/eval` / `eval`: local coding-agent eval preparation, execution, and reports.
- `@tangent/search`: structural repository search for Dart and TypeScript/JavaScript.

## Quick start

```bash
npm install
npm run build

tangent setup --provider codex --usage --daily --search --summary-provider codex-cli --model gpt-5.4-mini --yes
tangent status
tangent usage today
tangent usage transcript codex:019ea3ad

tangent daily status .
tangent daily process --date today
tangent daily today
tangent daily yesterday
tangent daily 2026-06-07

tangent search index
tangent search "horizontal tension"
tangent search symbol calculateHorizontalTension
tangent eval quick --prompt prompts/task.md --context empty --context repo
```

`usage` is the human-facing telemetry surface. Raw telemetry API/debug views require explicit JSON/export commands.

`usage` reads Claude Code and Codex native transcripts by default and indexes normalized activity under `~/.tangent/usage`. Human commands default to readable text; raw provenance and event streams live under `usage export` and `usage events --json`. Legacy hook capture is still available through hidden `usage hooks` commands.

`daily` stores private generated notes, cached digests, and processing state under `~/.tangent/daily/repos/<repo-name>` by default. Repo-local output is opt-in:

`search` stores its derived SQLite index under `~/.tangent/search/repos/<repo-name>-<hash>` by default. It is zero-config: run `tangent search index` in a repo, then query with `tangent search "query"`. Private overrides are created with:

```bash
tangent search init .
tangent search config set search.maxResults 20
```

Repo-shared defaults are explicit and should contain only team-safe indexing/search settings:

```bash
tangent search init . --scope repo-shared --language typescript
```

```bash
tangent daily init . --output repo-local-private
```

Repo-local `daily` output is written to `.tangent/daily/` and excluded through `.git/info/exclude`.

Custom locations are supported:

```bash
tangent daily init . --base-dir ~/daily-agent-notes/otto-tangent
tangent daily config set output.baseDir ~/daily-agent-notes/otto-tangent
```

Daily runner failures are summarized in the terminal and written to `artifacts/failures/<date>/*.log`; use `--verbose` or `--json` when debugging.

Shell completion is generated from the shared command registry:

```bash
tangent completion zsh > ~/.zsh/completions/_tangent
tangent completion bash > ~/.tangent-completion.bash
tangent completion fish > ~/.config/fish/completions/tangent.fish
```
