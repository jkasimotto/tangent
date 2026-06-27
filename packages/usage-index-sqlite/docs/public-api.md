# @tangent/usage-index-sqlite Public API

Public import paths:
- `@tangent/usage-index-sqlite`

Notable exports:
- `readConversationsUserMessages({ conversationIds, repo?, scope?, providers? })` reads the ordered user messages (text and timestamp) for a set of conversations from the slim index, one cheap per-conversation projection at a time. Assistant and tool messages are excluded. Used by Rollup's correction-metrics rollup.
