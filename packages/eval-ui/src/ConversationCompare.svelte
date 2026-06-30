<script lang="ts">
  import type { EvalConversationsView, EvalConversationToolCall } from "./client.js";
  import { conversationMatchCount, messageMatches } from "./conversation-model.js";

  export let left: EvalConversationsView | undefined;
  export let right: EvalConversationsView | undefined;
  export let leftLabel = "";
  export let rightLabel = "";
  export let loading = false;
  export let errorText = "";

  let filter = "";
  $: active = filter.trim().length > 0;

  /** Total tool calls a side ran across all its conversations, for the column header. */
  function toolTotal(view: EvalConversationsView | undefined): number {
    return (view?.conversations ?? []).reduce((sum, conversation) => sum + conversation.totals.toolCalls, 0);
  }

  /** How many turns on a side match the needle, summed across its conversations. Takes the needle as an
      argument (not a closure read) so the template re-counts whenever the highlight box changes. */
  function matchTotal(view: EvalConversationsView | undefined, needle: string): number {
    if (!view) return 0;
    return view.conversations.reduce((sum, conversation) => sum + conversationMatchCount(conversation, needle), 0);
  }

  /** Status glyph for a tool call: ran clean, errored, or unknown. */
  function statusGlyph(status: EvalConversationToolCall["status"]): string {
    if (status === "success") return "✓";
    if (status === "error") return "✕";
    return "·";
  }

  /** Formats elapsed time from conversationStart to messageAt as "Xm Ys" or "Xs". */
  function formatDuration(messageAt: string | undefined, startedAt: string | undefined): string {
    if (!messageAt || !startedAt) return "";
    const ms = new Date(messageAt).getTime() - new Date(startedAt).getTime();
    if (ms < 0) return "";
    const totalSec = Math.round(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }
</script>

<div class="convo" aria-label="Conversation comparison">
  {#if errorText}
    <p class="assembled-error">{errorText}</p>
  {:else}
    <div class="convo-filter">
      <input type="text" aria-label="Highlight in conversations" placeholder="highlight a tool, path, or word, e.g. SKILL.md" bind:value={filter} />
      {#if active}<span class="convo-filter-counts">{matchTotal(left, filter)} · {matchTotal(right, filter)} matches</span>{/if}
    </div>
    <div class="convo-cols">
      {#each [{ key: "a", label: leftLabel, view: left }, { key: "b", label: rightLabel, view: right }] as side (side.key)}
        <div class="convo-col convo-{side.key}" aria-busy={loading}>
          <div class="convo-col-head">
            <span class="convo-label">{side.label}</span>
            {#if side.view}<span class="convo-totals">{toolTotal(side.view)} tool calls{active ? ` · ${matchTotal(side.view, filter)} match` : ""}</span>{/if}
          </div>
          {#if loading && !side.view}
            <div class="state">Reconstructing…</div>
          {:else if !side.view || side.view.conversations.length === 0}
            <p class="convo-empty">No conversation captured for this variant.</p>
            {#each side.view?.notes ?? [] as note}<p class="convo-note">{note}</p>{/each}
          {:else}
            {#each side.view.notes as note}<p class="convo-note">{note}</p>{/each}
            {#each side.view.conversations as conversation (conversation.id)}
              {#if side.view.conversations.length > 1}
                <div class="convo-divider">{conversation.provider} · {conversation.totals.assistantMessages} replies · {conversation.totals.toolCalls} tools</div>
              {/if}
              {#each conversation.messages as message (message.id)}
                {@const hit = active && messageMatches(message, filter)}
                <div class="convo-msg convo-{message.role}" class:dim={active && !hit} class:hit={hit}>
                  <div class="convo-role">{message.role}{#if message.model} · {message.model}{/if}{#if message.at && conversation.startedAt}<span class="convo-time">{formatDuration(message.at, conversation.startedAt)}</span>{/if}</div>
                  {#if message.text.trim()}<div class="convo-text">{message.text}</div>{/if}
                  {#if message.thinking && message.thinking.trim()}
                    <details class="convo-thinking"><summary>thinking</summary><pre>{message.thinking}</pre></details>
                  {/if}
                  {#each message.toolCalls as call (call.id)}
                    <div class="convo-tool convo-tool-{call.status ?? 'unknown'}">
                      <span class="convo-tool-status" aria-hidden="true">{statusGlyph(call.status)}</span>
                      <span class="convo-tool-name">{call.name}</span>
                      {#if call.inputPreview}<code class="convo-tool-input">{call.inputPreview}</code>{/if}
                    </div>
                  {/each}
                </div>
              {/each}
            {/each}
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
