import type { ConvosJsonlLineV1 } from "@convos/convos";

export function evidenceRef(event: Pick<ConvosJsonlLineV1, "provider" | "conversation" | "event_id">): string {
  return `${event.provider}:${event.conversation.id}#${event.event_id}`;
}

export function eventShortType(event: Pick<ConvosJsonlLineV1, "kind">): string {
  return event.kind;
}
