import type { UsageJsonlLineV1 } from "@tangent/usage-index-sqlite";

/** Returns a stable string reference for a usage event in the form provider:conversationId#eventId. */
export function evidenceRef(event: Pick<UsageJsonlLineV1, "provider" | "conversation" | "event_id">): string {
  return `${event.provider}:${event.conversation.id}#${event.event_id}`;
}

/** Returns the short kind string for a usage event. */
export function eventShortType(event: Pick<UsageJsonlLineV1, "kind">): string {
  return event.kind;
}
