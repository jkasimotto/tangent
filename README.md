# tangent

`tangent` is an npm workspace for local coding-agent conversation tools.

Packages:

- `@tangent/core`: shared command metadata, help, and shell completion primitives.
- `@convos/convos` / `convos`: local conversation telemetry and queryability for Claude Code and Codex sessions.
- `@tangent/daily` / `daily`: private daily engineering notes generated from `convos` conversations.
- `@tangent/search`: structural repository search for Dart and TypeScript/JavaScript.

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

tangent search index
tangent search "horizontal tension"
tangent search symbol calculateHorizontalTension
tangent search bench . --query "horizontal tension"
```

`convos` stores conversation telemetry under `~/.convos`.

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

Temporary Rust comparison support is available with `--engine rust`, `TANGENT_SEARCH_ENGINE=rust`, and `tangent search bench`. Build the Rust engine with:

```bash
cargo build -p tangent-search-engine
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

Shell completion is generated from the shared command registry:

```bash
tangent completion zsh > ~/.zsh/completions/_tangent
tangent completion bash > ~/.tangent-completion.bash
tangent completion fish > ~/.config/fish/completions/tangent.fish
```
