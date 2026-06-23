# @tangent/usage-providers Architecture

Provider-native parsing and loading belongs here, not in `usage-schema` or `usage-core`.

Claude native capture is verbatim: tool input and output are stored without redaction or truncation, assistant `thinking` blocks are extracted, and `ExitPlanMode` is categorized as `plan` with its `input.plan` markdown preserved. Codex native capture still redacts. See ADR-0010.

Claude discovery unions every Claude profile. `claudeHomes()` returns all `~/.claude*` data dirs that hold a `projects/` tree (`~/.claude`, `~/.claude-otto`, ...); `discoverClaudeNative()` and `nativeWatchRoots()` scan and watch all of them, so transcripts under extra profiles are not invisible. `CLAUDE_HOME` overrides the glob with an explicit `path.delimiter`-separated list (used by tests). See ADR-0011.
