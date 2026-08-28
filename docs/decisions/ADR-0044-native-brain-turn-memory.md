# ADR-0044: Native brain turns are Journal memory

Date: 2026-08-28

Status: accepted. Design: `docs/design/agent-shell-work-briefing/design-record.md`.

## Context

The user talks to an Area brain through a native terminal. The browser transports terminal bytes and does not own semantic user turns.

The product must save one complete user turn when that turn contains “remember this.” A model copy cannot prove exact text or boundaries.

Usage already owns provider transcript normalization. Agent Shell must stay independent from Usage package imports.

## Decision

1. Each brain attempt stores its native conversation locator. Claude gets an identifier before launch. Codex uses the attempt folder and start time.
2. Agent Shell polls changed native transcripts for active brains. It never reconstructs canonical text from xterm bytes or model output.
3. Agent Shell calls `tangent usage native messages <path> --provider <provider> --json`. The command normalizes one transcript without a global index scan.
4. The normalized user message supplies the complete text, boundary, creation time, and stable native identifier.
5. The monitor selects only turns that contain “remember this” or start with `/remember`.
6. The stable native identifier is the Journal idempotency key. The existing Journal route commits before it sends a success notice.
7. Root uses the API identity `@root`. This identity maps to `~/.tangent/trees/` and never creates a `root/` folder.
8. A routed entry must contain an exact source excerpt. New routes also name the source Journal entry identifier.
9. The vault-root brain instructions define orientation. Root reads the complete tree. Another brain reads its Area subtree and local routed entries.

## Consequences

- Claude and Codex brain turns have an exact native capture path.
- Gemini and Pi have no exact capture claim in this implementation.
- Journal retries create no duplicate entry after a process restart or archive rollover.
- A failed vault commit sends an error notice and no success receipt.
- Agent Shell has no Usage package dependency. The process boundary preserves the vertical package rule.
- The existing Capture note and conclusion-memory paths remain unchanged.
