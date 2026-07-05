# @tangent/usage-index-sqlite Public API

Public import paths:
- `@tangent/usage-index-sqlite`

Notable exports:
- `readConversationsUserMessages({ conversationIds, repo?, scope?, providers? })` reads the ordered user messages (text, timestamp, and per-session `ordinal` counted across every role) for a set of conversations from the slim index, one cheap per-conversation projection at a time. Assistant and tool messages are excluded. Used by Rollup's correction-metrics rollup and by `@tangent/eval`'s `tangent mark to-eval` to select the user message nearest a mark's anchor.
- `claudeHomes()`, `claudeHome()`, `claudeProjectKey(repoRoot)`, `discoverClaudeNative(repoRoot?)` re-export Claude native transcript discovery so consumers that may depend only on `@tangent/usage-index-sqlite` (not `@tangent/usage-providers` directly) can resolve a cwd to its transcript files. Used by `@tangent/eval`'s marks session resolution (`src/marks/resolve.ts`).
