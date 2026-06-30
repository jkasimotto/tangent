import { randomUUID } from "node:crypto";

/** Generates a unique prefixed event ID. */
export function eventId(): string {
  return `evt_${randomUUID()}`;
}

/** Constructs a canonical conversation ID from provider name and provider session ID. */
export function conversationId(provider: string, sessionId: string): string {
  return `${provider}:${sessionId}`;
}
