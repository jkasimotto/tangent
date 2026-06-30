import type { UsageJsonlLineV1 } from "@tangent/usage-index-sqlite";

export function evidenceRef(event: Pick<UsageJsonlLineV1, "provider" | "conversation" | "event_id">): string {
  return `${event.provider}:${event.conversation.id}#${event.event_id}`;
}

export function eventShortType(event: Pick<UsageJsonlLineV1, "kind">): string {
  return event.kind;
}
