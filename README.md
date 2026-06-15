# tangent

`tangent` is an npm workspace for local coding-agent conversation tools.

Packages:

- `@tangent/core`: shared command metadata, help, and shell completion primitives.
- `@tangent/usage` / `tangent-usage`: local conversation telemetry and human-readable activity views for Claude Code and Codex sessions.
- `@tangent/search` / `tangent-search`: structural repository search for Dart and TypeScript/JavaScript.
- `@tangent/rollup` / `tangent-rollup`: private rollup engineering notes generated from Usage conversations.
- `@tangent/eval` / `tangent-eval`: local coding-agent eval preparation, execution, and reports.

## Quick start

```bash
npm install
npm run build

tangent setup --provider codex --usage --rollup --search --summary-provider codex-cli --model gpt-5.4-mini --yes
tangent status
tangent usage today
tangent usage transcript codex:019ea3ad

tangent rollup status .
tangent rollup today
tangent rollup yesterday
tangent rollup 2026-06-07
tangent rollup 20260601-20260610

tangent search index
tangent search "horizontal tension"
tangent search symbol calculateHorizontalTension
tangent eval quick --prompt prompts/task.md --context empty --context repo
```

`usage` is the human-facing telemetry surface. Raw telemetry API/debug views require explicit JSON/export commands.

`usage` reads Claude Code and Codex native transcripts by default and indexes normalized activity under `~/.tangent/usage`. Human commands default to readable text; raw provenance and event streams live under `usage export` and `usage events --json`. Hook capture is retired, but old hook-sourced JSONL remains readable through explicit legacy source options.

`rollup` stores private generated notes, cached digests, and processing state under `~/.tangent/rollup/repos/<repo-name>` by default. `tangent rollup today` writes `notes/YYYY-MM-DD.md`; compact ranges such as `tangent rollup 20260601-20260610` write one combined note at `notes/YYYY-MM-DD--YYYY-MM-DD.md`. Repo-local output is opt-in:

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
tangent rollup init . --output repo-local-private
```

Repo-local `rollup` output is written to `.tangent/rollup/` and excluded through `.git/info/exclude`.

Custom locations are supported:

```bash
tangent rollup init . --base-dir ~/rollup-agent-notes/otto-tangent
tangent rollup config set output.baseDir ~/rollup-agent-notes/otto-tangent
```

Rollup runner failures are summarized in the terminal and written to `artifacts/failures/<date>/*.log`; use `--verbose` or `--json` when debugging.

Shell completion is generated from the shared command registry:

```bash
tangent completion zsh > ~/.zsh/completions/_tangent
tangent completion bash > ~/.tangent-completion.bash
tangent completion fish > ~/.config/fish/completions/tangent.fish
```

## Standalone installs

The monorepo is the single development home, but each app package is installable on its own:

```bash
npm install @tangent/usage
npm install @tangent/search
npm install @tangent/rollup
npm install @tangent/eval
```

Standalone binaries use collision-resistant names:

```bash
tangent-usage today
tangent-search index
tangent-rollup today
tangent-eval ui
```

The full-suite package keeps the shorter root subcommands through `tangent usage`, `tangent search`, `tangent rollup`, and `tangent eval`.
