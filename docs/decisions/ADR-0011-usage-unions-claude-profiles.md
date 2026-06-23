# ADR-0011 Usage Unions All Claude Profile Directories

Date: 2026-06-23

## Decision

Claude native discovery scans every Claude profile directory, not just `~/.claude`.

The user runs more than one Claude Code profile, each with its own data directory and `projects/` transcript tree (`~/.claude`, `~/.claude-otto`, ...). Previously discovery resolved a single home, so conversations recorded under the extra profiles were invisible in Usage.

1. `claudeHomes()` (in `@tangent/usage-providers` `providers/claude/native/discover.ts`) returns every `~/.claude*` entry under the home directory that is a directory holding a `projects/` subdir, sorted for stable order. `CLAUDE_HOME` overrides the glob with an explicit `path.delimiter`-separated list, which tests use to point at fixtures.
2. `discoverClaudeNative(repoRoot?)` unions transcript files across all homes. A repo key can exist under several profiles; all are returned.
3. `nativeWatchRoots()` watches each profile's `projects/` dir for live updates.
4. `claudeHome()` is retained as `claudeHomes()[0]` for the rare single-home caller.

Command-and-control transcript resolution (`src/cli/focus.ts`) carries a small self-contained copy of the same profile glob. It does not import `claudeHomes()` because the product/C&C layer must not take a vertical dependency on the usage package (root AGENTS.md boundary rule); the duplicated logic is a few lines.

## Consequences

- Usage is cross-profile by default. Adding a new `~/.claude*` profile with a `projects/` tree makes its transcripts appear with no configuration.
- Discovery does a synchronous `readdirSync(homedir())` per call. This is cheap (one home-directory listing) and keeps `nativeWatchRoots()` synchronous.
- A directory named `.claude*` that lacks a `projects/` subdir is ignored, so backups and unrelated dotfiles do not pollute discovery.
- The glob is duplicated in `focus.ts` by design; if a third consumer appears, promote a shared profile resolver into `@tangent/repo` rather than importing across the usage boundary.
