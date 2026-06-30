# @tangent/rollup Architecture

Private rollup notes generated from selected Usage turns and visible user messages.

Workflow notes:
- `tangent rollup <selector>` preflights the summary provider before model summarization.
- Selectors include `today`, `yesterday`, `YYYY-MM-DD`, `YYYYMMDD`, and inclusive compact ranges such as `YYYYMMDD-YYYYMMDD`.
- Processing builds one cached `rollup.input.v1` containing `messageMode: "user-only"`, selected turn metadata, visible user messages up to `input.maxUserMessageChars`, source caveats, and style examples from `.tangent/rollup/examples/*.md` and previous edited notes.
- Rollup input intentionally excludes assistant messages, tool calls, tool results, assistant-produced context, token metadata, and oversized pasted user messages. Selection is by date/range/purpose; selected turns are not relevance-scored, clamped, or dropped during input construction.
- Rollup artifacts are written under `artifacts/rollups/<key>/` as input JSON, readable messages markdown, prompt markdown, and output JSON. The generated markdown is written directly into the note's generated block.
- Rollup does not expose or preserve a topic architecture; the period-level output is the only generated path.
- Runner failures are summarized in terminal output and written under `artifacts/failures/<date>/*.log`.
- Note rendering preserves the manual section and replaces only the generated block.
- `rollup retry` is an alias for forced reprocessing of failed or selected turns.

Correction metrics (a separate capability beside notes):
- `processMetrics({ conversationIds })` rolls up agent-quality metrics for a hand-picked set of conversations rather than a date period. The headline version judges correction count and first-pass success.
- The judge reads user messages only (via `readConversationsUserMessages` from `@tangent/usage-index-sqlite`), never assistant transcripts: the correction signal lives in how the user redirects the agent, and user messages are cheap to send. A small model (haiku) is the default.
- Each conversation is judged once and cached by a fingerprint of its user messages under `artifacts/metrics/<conversationId>.json`, so re-rolling an unchanged conversation is free. A conversation that fails to judge is reported as `failed` and excluded from the aggregate.
- The Usage UI multi-selects conversations and posts them to the shell's `/api/metrics/rollup` route, which calls `processMetrics`. The route lives in the shell, not Usage, because Usage must not depend on Rollup.

Rules:
- Rollup may consume Usage data.
- Keep Rollup installable with Usage and platform packages, but without Search or Eval.
- Keep Rollup note schemas and prompts in Rollup.

Refer to ../../../docs/architecture/package-boundaries.md and ../../../docs/architecture/dependency-graph.md for monorepo boundaries.
