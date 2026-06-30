import type { CorrectionRunnerInput } from "./types.js";

/**
 * Builds the correction-judging prompt for one conversation. The judge sees only the user's
 * messages in order, never the agent's, because the correction signal lives in how the user
 * redirects the agent. The prompt's job is to make the "correction vs. new task" distinction
 * concrete and to demand quoted evidence so the count can be audited.
 */
export function correctionPrompt(input: CorrectionRunnerInput): string {
  const messages = input.userMessages.map((message, index) => `[${index + 1}] ${message.text}`).join("\n\n");
  return [
    "You are analyzing a coding-agent session to count how many times the user had to correct the agent.",
    "You are given ONLY the user's messages, in order. You do not see the agent's replies; infer them from how the user responds.",
    "",
    "A CORRECTION is a user message that rejects, redirects, or fixes what the agent just did:",
    "- rejecting the result (\"no\", \"that's wrong\", \"that broke X\", \"revert that\")",
    "- redirecting the approach (\"don't do it that way\", \"use a map instead\", \"I meant Y, not Z\")",
    "- restating a constraint the agent ignored (\"again, do not touch the schema\")",
    "",
    "NOT a correction:",
    "- a new task or the next step (\"now add tests\", \"next, wire up the API\")",
    "- added detail or clarification the agent asked for",
    "- the very first message in the session (there is nothing yet to correct)",
    "",
    "Count each correcting message once. For every correction, quote the user's exact words and explain briefly why it is a correction.",
    "Return JSON matching the schema: { correctionCount, corrections: [{ quote, why }] }. correctionCount must equal corrections.length.",
    "",
    `Conversation${input.title ? `: ${input.title}` : ""}`,
    "User messages:",
    messages
  ].join("\n");
}
