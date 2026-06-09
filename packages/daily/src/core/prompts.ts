import type { TurnDigest, TurnDigestInput } from "../types/digest.js";
import { dayRollupJsonSchema, topicRollupJsonSchema, turnDigestJsonSchema } from "./schemas.js";

export function turnDigestPrompt(input: TurnDigestInput): string {
  return `You are generating a private engineering daily-log digest from one coding-agent turn.

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

export function dayRollupPrompt(args: { inputPath?: string; date: string; inputJson?: string }): string {
  const inputInstruction = args.inputJson
    ? `Use this JSON input:\n${args.inputJson}`
    : `Read the JSON input file at:\n${args.inputPath}`;
  return `You are generating the private engineering daily note for ${args.date}.

${inputInstruction}

Rules:
- Use only the provided JSON input.
- Do not inspect the repository or read any other files.
- Write useful engineering notes, not a chat transcript.
- Preserve concrete decisions, debugging findings, implementation details, validation commands, and follow-ups.
- Follow the style of input.examples when provided.
- Do not include secrets, credentials, tokens, or long code blocks.
- Keep direct quotes short.
- Prefer omission over speculation.
- markdown must be the full generated note body for the daily generated block.
- Output valid JSON matching the schema.

JSON schema:
${JSON.stringify(dayRollupJsonSchema)}
`;
}
