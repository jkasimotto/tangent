import type { TurnDigest, TurnDigestInput } from "../types/digest.js";
import type { RollupPeriod } from "../types/period.js";
import { rollupJsonSchema, topicRollupJsonSchema, turnDigestJsonSchema } from "./schemas.js";

export function turnDigestPrompt(input: TurnDigestInput): string {
  return `You are generating a private engineering rollup-log digest from one coding-agent turn.

Rules:
- Use only the provided turn input.
- Do not claim work was completed unless the input supports it.
- Prefer concrete decisions, experiments, implementation details, debugging findings, and follow-ups.
- Group the turn under one or more stable topic hints.
- Ignore low-signal back-and-forth.
- Do not include secrets, credentials, tokens, or long code blocks.
- Keep quotes short.
- Prefer omission over speculation.
- Output valid JSON matching the schema.

JSON schema:
${JSON.stringify(turnDigestJsonSchema)}

Turn input:
${JSON.stringify(input)}
`;
}

export function topicRollupPrompt(args: { date: string; key: string; title: string; digests: TurnDigest[] }): string {
  return `You are rolling up several turn digests from one day into a topic-centric engineering note section.

Rules:
- Use only the provided turn digests.
- Write narrativeMarkdown as useful engineering notes, not a chat transcript.
- Preserve design options, debugging paths, decisions, experiments, open questions, and follow-ups.
- Keep repeated details merged.
- Output valid JSON matching the schema.

JSON schema:
${JSON.stringify(topicRollupJsonSchema)}

Topic:
${JSON.stringify({ date: args.date, key: args.key, title: args.title })}

Turn digests:
${JSON.stringify(args.digests)}
`;
}

export function rollupPrompt(args: { inputPath?: string; period: RollupPeriod; inputJson?: string }): string {
  const inputInstruction = args.inputJson
    ? `Use this JSON input:\n${args.inputJson}`
    : `Read the JSON input file at:\n${args.inputPath}`;
  return `You are generating the private engineering roll-up note for ${args.period.label}.

${inputInstruction}

Purpose:
- Distill what the user discussed, understood, decided, questioned, or learned during the selected period.
- This note is for long-term signal only: decisions, ideas, experiments, hypotheses, constraints, mental models, tradeoffs, and unresolved questions that may be useful again later.
- Assistant messages are context and evidence only. Do not summarize the assistant's work as the main subject unless the user explicitly discussed that work.
- If the user mostly delegated implementation without adding their own reasoning, keep the note short.
- Preserve the user's mental model, constraints, preferences, terminology, and durable tradeoffs.

Rules:
- Use only the provided JSON input.
- Do not inspect the repository or read any other files.
- Write useful engineering notes, not a chat transcript and not a status report of assistant activity.
- Write in full sentences and connected paragraphs. Avoid dot-point summaries for substantive sections.
- Bullets are acceptable only for compact lists of future-useful commands, durable follow-ups, or very short checklists.
- Prefer synthesis over chronology. Merge repeated turns into the idea or decision they support.
- Preserve concrete user decisions, debugging findings, design constraints, implementation details the user reasoned about, validation commands with future diagnostic value, and durable follow-ups.
- Before including any detail, ask whether it would help the user recover useful technical or product context in the future. If not, omit it.
- Omit ephemeral coordination, short-term chores, status updates, requests to commit, requests to rerun tools, and generic facts that an assistant did work.
- Follow the style of input.examples when provided.
- Do not include secrets, credentials, tokens, or long code blocks.
- Keep direct quotes short.
- Prefer omission over speculation. Do not infer motivation from routine instructions.
- markdown must be the full generated note body for the rollup generated block.
- Output valid JSON matching the schema.

Style examples:
Bad:
### Pathfinding and routing work
- Added targeted regressions around route contact selection.
- Made climb attachment a normal pathfinding candidate.
- Reduced pathfinding hot-path cost with bounded transition checks.

Good:
### Pathfinding and routing
The useful thread in the pathfinding discussion was the distinction between surface attachment as an ordinary routing target and surface attachment as a fallback after same-Z movement fails. The user treated that distinction as important because it keeps click routing and climb behavior aligned with the authored surface model instead of letting route generation silently collapse back to tile-level assumptions. The validation commands matter mainly as evidence that this model held across the targeted route-contact, climb-down, and ramp-support regressions.

Bad:
### Review harness
- Reworked the repository review flow.
- The final review cycle passed.
- Addressed reviewer feedback.

Good:
### Review process
The user used the review harness as a quality gate for the surface-system changes rather than as a transcript of every review pass. The durable takeaway was that review categories should stay focused on risks that match the diff, while test feedback should push assertions toward public routing behavior instead of mocked internals.

Bad:
The user asked to commit the work soon, which suggests they were trying to close the loop on the surface-system simplification.

Good:
Omit this. A request to commit soon is short-term coordination, not reusable knowledge.

JSON schema:
${JSON.stringify(rollupJsonSchema)}
`;
}
