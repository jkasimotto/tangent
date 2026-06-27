# tangent

`tangent` is a collection of local applications for improving how you use LLMs and coding agents. They are small, focused tools that sit tangential to agentic coding: they watch what your agents do, measure it, and help you spend less to get more.

The name is a small joke. A tangent line touches a curve at a single point, and at a minimum that point is where the cost is lowest. These tools are about finding the lowest cost. They are also, literally, tangents to the main work of coding.

## The apps

Two apps are proven and ship by default:

- **Usage** reads your Claude Code and Codex transcripts and turns them into readable activity views: what ran, how long, how much it cost. Data is indexed locally under `~/.tangent/usage`.
- **Eval** prepares, runs, and reports local coding-agent evals so you can compare agents and prompts on real tasks.

Everything runs locally against your own data. Nothing is uploaded.

The default install gives you Usage and Eval, and `tangent ui` opens exactly those two.

## Install

```bash
npm install -g tangent

tangent ui          # opens Usage and Eval
```

Quick CLI entry points without the UI:

```bash
tangent usage today
tangent eval ui
```

## Add more apps (opt-in)

`tangent ui` shows whichever app packages are installed, so adding an app is just installing it. These are available but not part of the default experience:

- **Trees** (experimental, not design-validated yet): agent run trees in the UI.
  ```bash
  npm install -g @tangent/trees-server @tangent/trees-cli
  ```
- **Rollup**: private engineering notes generated from your Usage conversations.
  ```bash
  npm install -g @tangent/rollup
  ```
- **Search**: structural repository search for Dart and TypeScript/JavaScript.
  ```bash
  npm install -g @tangent/search
  ```

After installing one of these, run `tangent ui` again and the new app appears. Trees is included so you can try it, but its design is still in flux; treat it as a preview.

## Standalone installs

The monorepo is the single development home, but each app package is installable on its own with a collision-resistant binary name:

```bash
npm install -g @tangent/usage   # tangent-usage today
npm install -g @tangent/search  # tangent-search index
npm install -g @tangent/rollup  # tangent-rollup today
npm install -g @tangent/eval    # tangent-eval ui
```

The full-suite `tangent` package keeps the shorter root subcommands: `tangent usage`, `tangent eval`, `tangent search`, `tangent rollup`.

## Where data lives

- Usage indexes normalized activity under `~/.tangent/usage`. Human commands default to readable text; raw provenance and event streams live under `tangent usage export` and `tangent usage events --json`.
- Rollup stores generated notes and processing state under `~/.tangent/rollup/repos/<repo-name>`. Repo-local output is opt-in:
  ```bash
  tangent rollup init . --output repo-local-private
  ```
- Search stores its SQLite index under `~/.tangent/search/repos/<repo-name>-<hash>`. It is zero-config: run `tangent search index` in a repo, then `tangent search "query"`.

## Shell completion

```bash
tangent completion zsh > ~/.zsh/completions/_tangent
tangent completion bash > ~/.tangent-completion.bash
tangent completion fish > ~/.config/fish/completions/tangent.fish
```

## Develop from source

```bash
git clone <repo-url>
cd tangent
npm install
npm run build

tangent ui
```

Validate changes with `npm run check`, `npm run test`, `npm run governance`, and `npm run build`. See `ARCHITECTURE.md` and `docs/` for package boundaries and design notes.

## Release

Maintainers cut a release by bumping every package in lockstep and pushing a tag:

```bash
node scripts/release.mjs version minor   # bumps all packages, rewrites cross-refs, commits, tags vX.Y.Z
git push --follow-tags
```

The `release` workflow publishes the public packages to npm in dependency order on tag push. `node scripts/release.mjs check` verifies all versions and internal ranges are consistent, and `node scripts/release.mjs publish --dry-run` previews what would ship.
