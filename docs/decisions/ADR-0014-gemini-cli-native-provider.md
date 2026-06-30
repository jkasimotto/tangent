# ADR-0014 Gemini CLI Native Provider

Date: 2026-06-30

## Decision

Usage indexes Gemini CLI chat sessions as a first-class native provider alongside Claude Code and Codex. `gemini` joins `UsageProvider`, and a `providers/gemini/native` adapter discovers, reads, and normalizes Gemini sessions.

Gemini CLI stores chat sessions under `~/.gemini/tmp/<project>/chats` in two on-disk formats that share one logical schema: a single pretty-printed JSON document (`session-*.json`, older) and line-delimited JSONL (`session-*.jsonl`, newer). Both carry a session header (`sessionId`, `projectHash`, `startTime`, `lastUpdated`, `kind`) followed by `user` and `gemini` messages.

1. `providers/gemini/native/read.ts` reads either format into one record stream: record 1 is the session header, the rest are message records. The single-document case is split into header + one record per `messages[]` entry; the JSONL case is parsed line by line. This keeps `normalizeGeminiNativeRecords` format-agnostic.
2. Working directory is not present per record. It is resolved from the session's `projectHash` (which is `sha256(cwd)`) via `~/.gemini/projects.json` (`{ projects: { "<cwd>": "<name>" } }`), with the chat directory name as a fallback. `buildGeminiProjectMap()` indexes that file by name and by `sha256(cwd)`; orphan hash directories absent from `projects.json` import without a resolved cwd rather than being dropped.
3. One `gemini` message bundles reasoning (`thoughts`), the visible reply (`content`, a string or `[{ text }]`), `toolCalls` (call args and result inline), and provider token counts. The normalizer fans it out into one `message.assistant.visible` event with reasoning folded into `thinking` (mirroring the Claude normalizer, so the UI renders one assistant block, not an empty internal one), `tool.call`/`tool.result` events, and a `token.usage` event.
4. Gemini reports `output` (visible) and `thoughts` (reasoning) token counts separately. They are folded into `output_tokens` so reasoning is counted as the generation cost it is; `cached` maps to `cache_read_input_tokens`. Raw splits are preserved on the usage object for transparency.
5. `nativeWatchRoots()` watches `~/.gemini/tmp` so new sessions appear live. `GEMINI_HOME` overrides the home directory (used by tests).
6. The set of native providers is centralized: `usageProviders` and `isUsageProvider` in `usage-jsonl-v1.ts` replace the scattered `["claude", "codex"]` default lists and `provider === "claude" || provider === "codex"` guards across `usage`, `usage-index-sqlite`, and the Usage server, so a future provider is one edit, not a sweep.

## Consequences

- Gemini conversations appear in `tangent ui` Usage exactly like Claude and Codex, scoped cross-project and cross-profile by default.
- Eval and rollup carry the provider through as data provenance; their local provider unions widen to include `gemini`, but their processing defaults are unchanged (they do not run Gemini as an agent runner).
- The single-document format is pretty-printed, so the schema-status inspector (`native/inspect.ts`) detects a whole-document parse with a `messages` array and expands it, rather than failing line-by-line. Other providers are unaffected (their multi-line JSONL never parses as one document).
- Native Gemini sessions record no CLI version, so schema-version compatibility is reported as unknown and parsing stays permissive.
