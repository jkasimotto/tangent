import type { SessionDigestInput } from "../types/digest.js";
import { sessionDigestJsonSchema } from "./schemas.js";

export function sessionDigestPrompt(input: SessionDigestInput): string {
  return `You are generating a private engineering daily-log digest from one coding-agent conversation.

Rules:
- Use only the provided conversation input.
- Do not claim work was completed unless the input supports it.
- Prefer concrete decisions, experiments, implementation details, and follow-ups.
- Ignore low-signal back-and-forth.
- Do not include secrets, credentials, tokens, or long code blocks.
- Keep quotes short.
- Keep evidence references attached to each important claim.
- Prefer omission over speculation.
- Output valid JSON matching the schema.

JSON schema:
${JSON.stringify(sessionDigestJsonSchema)}

Conversation input:
${JSON.stringify(input)}
`;
}
