# ADR-0026: The study partner is an interactive agent session, not a screen

Date: 2026-08-22

Status: accepted.

## Context

The first cut of studying (design `otto/tangent/design-learning-ai-written-code`, solution `impl-learning-ai-written-code`) was a Q&A tutor screen in Agent Shell: a headless `claude` turn graded Julian's typed answers against a snippet it revealed. Julian rejected it: slow, unpleasant, and it taught him nothing. He wants to read real code, classes, and data structures with a partner who explores alongside him and gets him to change the code, on any repo, not only a Tangent Area.

The replacement design (`otto/tangent/design-code-first-study-partner.md`, solution `impl-code-first-study-partner.md`) reframed studying as pairing, not grading. Its Decision 2, Julian's own word: the study partner is a plain agent session beside nvim, no screen. Its Decision 7, also Julian's own word: delete the existing study screen and machinery rather than rebuild it.

## Decision

- `tangent study`, a new top-level CLI noun in `@tangent/agent-shell`, spawns an interactive `claude` session (`CLAUDE_CONFIG_DIR=~/.claude-otto`, `--dangerously-skip-permissions`) with the partner contract appended as its system prompt. `tangent study contract` prints that contract. No repo argument: the opening question of the contract, "What do you want to be able to explain?", starts the scoping conversation.
- The contract (`packages/agent-shell/src/cli/commands/study-contract.ts`, `STUDY_CONTRACT`) is the whole product. It is prose, not code: it tells the partner how to scope, how to pair (explore-and-do, Julian guesses first, no verdicts), which rights it holds (read anywhere, edit and run only inside a per-repo study worktree), and how to end (keep or discard, then a facts-only record).
- The study worktree (`<repo-basename>-study`, branch `study`) and the session record (`~/.tangent/study/records/<date>-<repo>-<part>.md`) are conventions the contract states; the partner executes them with its own tools. No server, no routes, no polling, no state outside git and one record directory.
- The old study screen is deleted end to end: `public/study.js`, its CSS, the Area-card `Study code…` button, the five `/api/study/*` routes, the tutor turn machinery in `server.mjs`, `study-tutor.mjs`, `study-record.mjs`, and their tests. The Agent Shell server now knows nothing about studying.
- `tangent study` is the second command in `@tangent/agent-shell` that does not go through the Agent Shell server (`vault commit` is the first): it spawns its own local interactive process directly, because the session must own the terminal.

## Consequences

- New files: `packages/agent-shell/src/cli/commands/study.ts`, `study-contract.ts`, `packages/agent-shell/test/cli-study-spec.test.mjs`.
- Removed files: `packages/agent-shell/app/study-tutor.mjs`, `study-record.mjs`, `study-http.test.mjs`, `study-tutor.test.mjs`, `study-record.test.mjs`, `packages/agent-shell/app/public/study.js`.
- `packages/agent-shell/app/server.mjs` loses the `STUDY_*` constants, the tutor turn machinery, the `/api/study/*` routes, and the `sweepStudies()` boot call. `public/shell.js` and `shell.html` lose every reference to the study view.
- Never rebuild a study screen or study routes in the Agent Shell server; the partner contract is the one product to change when studying needs to change.
- Old version-1 records under `~/.tangent/agent-shell/study/` stay on disk, unread. The design's deferred data-flow graph view stays deferred; nothing here depends on it or blocks it.
