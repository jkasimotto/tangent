# ADR-0021: Refined pane states and cross-agent messages

Date: 2026-08-15

Status: accepted

## Context

The Agent Shell classified an agent pane by screen-hash diffing alone: a repainting screen was `working`, a static screen was `waiting`, a shell pane was `shell`. `waiting` conflated two states that demand different attention: an agent blocked on a permission dialog or question (stalled, costs wall-clock), and an agent that finished its response (review at leisure). The conflation also blocked cross-agent messaging: text typed into a dialog answers the dialog ("1" selects Yes in a claude permission prompt), text typed into a draft corrupts it, and text typed into a shell executes.

Agents also had no way to address each other. Every agent-to-agent handoff routed through Julian's attention as a copy-paste bus.

## Decision

**Refined pane states** (`packages/agent-shell/app/pane-state.mjs`): when the screen hash is static, the server reads the pane text it already captured plus the cursor position (`#{cursor_x} #{cursor_y}`) and classifies against a per-harness signature table:

- a busy marker ("esc to interrupt") means `working` despite the static screen;
- a dialog pattern ("Do you want", `❯ 1.`) means detail `decision`, with the question extracted for attention surfaces;
- a composer prompt line (`❯` claude, `›` codex) with the cursor at the home column means detail `idle` (empty composer; placeholder text never moves the cursor);
- the same prompt with the cursor past home means detail `draft`;
- anything else stays plain `waiting` with no detail.

The wire `state` stays `working|waiting|shell` so the frontend's existing branches keep working; the refinement rides beside it as `stateDetail` and `stateQuestion`. Detection is passive by rule: the server never types a key to discover state, because a probe keystroke can be a dialog answer. The signatures are data with fixture tests (`fixtures/panes/`, real captures where possible); a harness UI change fails a fixture test instead of misdelivering a message.

**Cross-agent messages** (`packages/agent-shell/app/agent-messages.mjs`, `/api/agents`, `/api/agents/send`, `tangent agent list|send`): agents message each other through the server, never through raw tmux. The server stamps a provenance banner (`[Message from <session> (<area>)] ...`) derived from the live sender session, so a receiving agent can always tell agent words from Julian's words and status authority ("on Julian's word") stays unforgeable. Delivery is state-gated: only a positively identified empty composer (`stateDetail === "idle"`) is typed into (echo-verified, then submitted); a working, dialog, draft, or unrecognized-waiting target queues (2s delivery tick); a shell or process target refuses. Messages are at-most-once: a dead target drops the queue with an audit entry. Every send, delivery, and drop appends to `~/.tangent/agent-shell-messages.jsonl`.

## Consequences

- Attention surfaces can rank `decision` above `idle`; the sidebar labels already distinguish them.
- Message delivery is conservative by design: attention tolerates false positives, delivery does not.
- The signature table is the single place to update when a harness changes its chrome; unknown harnesses degrade to plain `waiting` (never deliverable, still visible).
- Sender identity is only as strong as localhost: any local process can claim a session name. The server verifies the claimed session exists and stamps its own view of it; unknown claims are stamped "unknown sender", never trusted.
