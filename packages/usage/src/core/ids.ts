import { randomUUID } from "node:crypto";

export function eventId(): string {
  return `evt_${randomUUID()}`;
}

export function conversationId(provider: string, sessionId: string): string {
  return `${provider}:${sessionId}`;
}
