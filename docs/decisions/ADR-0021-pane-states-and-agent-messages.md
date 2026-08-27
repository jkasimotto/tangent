# ADR-0021: Refined pane states and cross-agent messages

Date: 2026-08-15

Status: accepted. The `tangent agent send` verb is amended by ADR-0040: agents use `tangent send`, and `tangent agent send` is an alias for one release.

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

**Cross-agent messages** (`packages/agent-shell/app/agent-messages.mjs`, `/api/agents`, `/api/agents/send`, `tangent agent list|send`): agents message each other through the server, never through raw tmux. The server stamps a provenance banner (`[Message from <session> (<area>)] ...`) derived from the live sender session, so a receiving agent can always tell agent words from Julian's words and status authority ("on Julian's word") stays unforgeable. Delivery is composer-gated: only a positively identified empty composer is typed into (echo-verified, then submitted); a dialog, draft, or unrecognized target queues (2s delivery tick); a shell or process target refuses. Messages are at-most-once: a dead target drops the queue with an audit entry. Every send, delivery, and drop appends to `~/.tangent/agent-shell-messages.jsonl`.

## Amendment, 2026-08-27: a working pane also has a composer

The original gate read `stateDetail === "idle"`, which is an agent waiting for input. That is a stricter condition than "the composer is empty", and the difference stalled the pipeline: an Area brain that worked for a whole pipeline never reached `waiting`, so a worker's typed report sat in the server's queue until the brain's turn ended, and the assignment queue that report unblocks stood still with it (Goal `probe-brain-worker-handover-message-2026-08-26`). Claude Code and codex both accept typed text during a turn and read it at the next turn boundary, so the wait bought nothing.

`classifyWorkingComposer` (`pane-state.mjs`) now answers the delivery question on its own, for a pane whose state is `working`: `"idle"`, `"draft"`, or `null` when a dialog is on screen or no known composer is found. The pane observer records it as `composer` beside the unchanged `state`, and `deliveryDecision` delivers to a `working` target whose `composer` is `"idle"`. Everything else queues exactly as before.

Two guards keep this safe. The boot wait is skipped for a working target, because it waits for a screen that stops repainting and a working agent never shows one; in its place the pane must not be a bare shell. And because the observer's sample can be older than the moment Julian started typing, the composer is read again from tmux immediately before typing, and delivery is refused unless it is still empty (`readyForText`, `prompt-delivery.mjs`). The old gate did not need this: eight seconds of an unchanged screen is itself proof that nobody typed.

The rule stays about the pane, not the role. A brain-only carve-out would be more code covering less, and every other message that waits on a busy agent waits for the same wrong reason. Launch is untouched: a freshly started harness is still typed into only after it settles.

## Amendment, 2026-08-27: Tangent's own prompt writer comes first

The amendment above left the server with two writers into one pane and nothing between them. A brain generation is armed with its activation prompt while its pane still sits at the shell, and the arming poll types that prompt as soon as the harness comes up. A booting harness repaints, so it reads as `working` with an empty composer for exactly as long as its prompt takes to arrive: a queued notice was delivered into the middle of the activation prompt and both texts reached the brain as one line. Before the amendment the boot wait had hidden this by accident, because it waited for a screen that a booting harness never shows.

Two rules replace that accident.

`promptPending` is a fact on the session the delivery decision reads: Tangent has a prompt armed for this pane, or is typing one into it right now. It queues whatever the composer shows, so a notice always arrives behind the activation prompt and never beside it. The arm is now held until its prompt settles rather than until it is picked up, because building a Goal prompt reads the vault first and the fact has to stay true across that read.

`pane-writes.mjs` puts every prompt this server types behind the last one for the same pane. `promptPending` reads a snapshot that can be a second old, so the order it gives is the right order but not a guarantee; the write queue is the guarantee. Two writers can queue, but they cannot type at once.

Delivery to a busy brain is unchanged: the pane the notice waits for is the pane Tangent is writing to, and it waits for seconds, not for the brain's turn.

## Consequences

- Attention surfaces can rank `decision` above `idle`; the sidebar labels already distinguish them.
- Message delivery is conservative by design: attention tolerates false positives, delivery does not.
- A busy agent is reachable, so a notice is worth as much as its timing: a worker report, a context-size reminder, or a Request answer arrives at the brain's next turn boundary rather than at the end of its turn.
- The signature table is the single place to update when a harness changes its chrome; unknown harnesses degrade to plain `waiting` (never deliverable, still visible).
- Sender identity is only as strong as localhost: any local process can claim a session name. The server verifies the claimed session exists and stamps its own view of it; unknown claims are stamped "unknown sender", never trusted.
