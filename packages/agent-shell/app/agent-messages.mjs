// Cross-agent messaging rules: the pure decisions behind /api/agents/send.
// The server owns the queue and the typing; this module owns the contract,
// so the rules are unit-testable without tmux.
//
// A message is delivered as typed text plus Enter, exactly like a message
// from Julian. Two rules keep that safe:
// - The provenance banner is stamped by the server, never written by the
//   sender, so a receiving agent can always tell agent words from Julian's
//   words. Authority phrases ("on Julian's word") stay unforgeable.
// - Delivery happens only into a positively identified empty composer.
//   Anything else queues or refuses: a dialog would treat typed text as an
//   answer, a draft would be corrupted, and a shell would execute the text as
//   a command.
//
// An empty composer is not the same as an idle agent. A waiting agent shows
// one (stateDetail "idle"); a WORKING agent also has one whenever it is not
// being typed into (`composer` "idle", from classifyWorkingComposer). Waiting
// for the idle state alone made a busy Area brain unreachable: a worker's
// typed report was written to the inbox, queued, and then held in memory
// until the brain's turn ended, so the assignment queue that report unblocks
// stood still for as long as the brain kept working (Goal
// probe-brain-worker-handover-message-2026-08-26). Claude Code and codex both
// take typed text while they work and read it at their next turn boundary, so
// a working agent with an empty composer is delivered to now.
//
// The server's own prompt writer is the exception. A brain generation that is
// still booting shows a working pane with an empty composer for as long as
// its activation prompt takes to arrive, so `promptPending` holds a notice
// back until that prompt is in. Overlapping writes are also serialized per
// pane (pane-writes.mjs); this rule keeps the notice behind the prompt
// instead of merely beside it.

/** The provenance header typed before the message body. */
export function messageBanner(from, area, text) {
  const origin = area ? `${from} (${area})` : from;
  return `[Message from ${origin}] ${text}`;
}

/**
 * Decides what to do with one message given the target session's live facts,
 * or null when the session does not exist. Returns one of:
 *   { action: "deliver", composer: "idle" | "working" }
 *   { action: "queue", reason }
 *   { action: "refuse", error }
 *
 * `composer` says which empty composer was found: "idle" is an agent waiting
 * for input, "working" is an agent mid-turn whose composer holds nothing. The
 * caller needs the difference, because a working harness is already up and
 * must not be waited on for a quiet screen before the text is typed.
 *
 * `promptPending` is the server's own writer: a prompt armed for this pane or
 * being typed into it right now. It queues whatever the composer shows,
 * because a booting generation reads as working with an empty composer for
 * the whole time its activation prompt is on its way.
 */
export function deliveryDecision(target) {
  if (!target) return { action: "refuse", error: "no such session; run \"tangent agent list\" to see live agents" };
  if (["process", "service", "command"].includes(target.kind ?? "")) {
    return { action: "refuse", error: `${target.name} is a ${target.kind} session, not an agent` };
  }
  if (target.state === "shell") {
    return { action: "refuse", error: `${target.name} has no agent running; typed text would execute in its shell` };
  }
  if (target.promptPending) {
    return { action: "queue", reason: `${target.name} is still taking a prompt Tangent sent it` };
  }
  if (target.state === "waiting" && target.stateDetail === "idle") return { action: "deliver", composer: "idle" };
  if (target.state === "working" && target.composer === "idle") return { action: "deliver", composer: "working" };
  const reason = target.state === "working"
    ? target.composer === "draft"
      ? `${target.name} is working and its composer holds unsent text`
      : `${target.name} is working and shows no empty composer`
    : target.stateDetail === "decision"
      ? `${target.name} waits on a decision dialog`
      : target.stateDetail === "draft"
        ? `${target.name} holds an unsent draft`
        : `${target.name} is not at an empty composer`;
  return { action: "queue", reason };
}

/** Trims and validates one outgoing message body. */
export function normalizeMessage(text) {
  const message = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!message) throw new Error("write the message text after the session name");
  if (message.length > 4000) throw new Error("keep messages under 4000 characters");
  return message;
}

/** The longest brain notice kept whole; a longer one is clipped, never lost. */
const NOTICE_MAX_CHARS = 4000;

/**
 * One brain notice as a single line. A notice carries text Tangent does not
 * control: Julian's own words in a Request answer, or a worker's handover.
 * `normalizeMessage` refuses text over the limit, which is right for
 * `tangent agent send`, where the sender sees the error and can shorten it.
 * It is wrong for a notice: the only reader of the error is a log, so an
 * over-long answer used to disappear before it was ever written to the
 * inbox, and no brain generation ever learned it existed. A notice is
 * therefore clipped and says so. Only empty text is an error.
 */
export function noticeMessage(text, max = NOTICE_MAX_CHARS) {
  const message = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!message) throw new Error("a notice needs text");
  if (message.length <= max) return message;
  const tail = ` … (clipped from ${message.length} characters; read the full text at its source)`;
  return `${message.slice(0, Math.max(1, max - tail.length)).trimEnd()}${tail}`;
}
