import { eventsToProjections } from "@tangent/usage-core/core/projections";
import { isUsageProvider, usageProviders, type UsageProvider } from "@tangent/usage-core/core/schema/usage-jsonl-v1";
import { providerCapabilities } from "@tangent/usage-providers/providers/index";

import { ensureSchema, openDb, usageIndexTarget } from "./indexStore.js";

export type ConversationUserMessage = {
  at?: string;
  /** The message's stable per-session position, counted across every role (see the slim usage schema). */
  ordinal: number;
  text: string;
};

export type ConversationUserMessages = {
  conversationId: string;
  title?: string;
  provider?: string;
  userMessages: ConversationUserMessage[];
};

export type ReadConversationsUserMessagesOptions = {
  conversationIds: string[];
  repo?: string;
  scope?: "repo" | "all";
  providers?: UsageProvider[];
};

/**
 * Reads the ordered user messages for each requested conversation from the slim usage index.
 * Opens the index database once and projects one conversation's events at a time, the same cheap
 * per-conversation path the UI client uses, so a handful of selected conversations resolve without
 * loading the whole window into memory. Assistant and tool messages are intentionally excluded:
 * correction metrics are judged from the user's words alone, and agent transcripts are too large to
 * carry. Each message keeps its `ordinal`, the session-wide position counted across every role, so
 * a caller anchored to a specific ordinal (e.g. a `tangent.mark.v1` anchor) can select the user
 * message at or nearest before it. Returns one entry per requested id in the order requested; a
 * conversation with no user messages yields an empty `userMessages` array rather than being dropped.
 */
export async function readConversationsUserMessages(options: ReadConversationsUserMessagesOptions): Promise<ConversationUserMessages[]> {
  const providers = options.providers?.filter(isUsageProvider);
  const capabilities = (providers || usageProviders).map(providerCapabilities);
  const db = await openDb(await usageIndexTarget({ repo: options.repo || ".", scope: options.scope }));
  try {
    ensureSchema(db);
    const loadEvents = db.prepare("select json from events where conversation_id = ? order by coalesce(observed_at, recorded_at), recorded_at");
    return options.conversationIds.map((conversationId) => {
      const events = (loadEvents.all(conversationId) as Array<{ json: string }>).map((row) => JSON.parse(row.json));
      const projections = eventsToProjections({ events, capabilities, contentMode: "metadata-with-excerpts", index: { kind: "sqlite", version: "usage.index.v2" } });
      const session = projections.sessions[0];
      const userMessages = projections.messages
        .filter((message) => message.role === "user")
        .sort((left, right) => left.ordinal - right.ordinal)
        .map((message) => ({ at: message.createdAt ?? undefined, ordinal: message.ordinal, text: (message.text ?? message.textPreview ?? "").trim() }))
        .filter((message) => message.text.length > 0);
      return { conversationId, title: session?.title, provider: session?.provider, userMessages };
    });
  } finally {
    db.close();
  }
}
