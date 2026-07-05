<script lang="ts">
  import { onMount } from "svelte";
  import type { EvalUiClient, MarkKind, MarkRecord, MarkStatus } from "./client.js";
  import { actionDisabled, kindLabel, markAge, repoLabel, statusChipClass, statusLabel, toEvalCommand, USAGE_APP_ROUTE } from "./marks-model.js";

  export let client: EvalUiClient;

  let marks: MarkRecord[] = [];
  let loading = true;
  let error = "";
  let statusFilter: MarkStatus | "" = "";
  let kindFilter: MarkKind | "" = "";
  let updatingId = "";
  let toEvalOpenId = "";
  let copiedId = "";
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    void load();
  });

  /** Loads marks from the server for the current status/kind filters. */
  async function load(): Promise<void> {
    loading = true;
    error = "";
    try {
      const { marks: fetched } = await client.listMarks({
        status: statusFilter || undefined,
        kind: kindFilter || undefined
      });
      marks = fetched;
    } catch (caught) {
      error = friendlyError(caught);
    } finally {
      loading = false;
    }
  }

  /** Applies a new status filter from the select's native change event and reloads. One-way value plus a
      single change handler, never bind:value + on:change (see App.svelte's topbar run-select comment: the
      combination raced and stuck the run picker on "Loading run…" in this codebase before). */
  function selectStatusFilter(value: string): void {
    statusFilter = value as MarkStatus | "";
    void load();
  }

  /** Applies a new kind filter from the select's native change event and reloads. */
  function selectKindFilter(value: string): void {
    kindFilter = value as MarkKind | "";
    void load();
  }

  /** Patches one mark's status (dismiss / mark fixed) and updates it in place on success. */
  async function setStatus(mark: MarkRecord, status: MarkStatus): Promise<void> {
    if (updatingId || actionDisabled(mark, status)) return;
    updatingId = mark.id;
    try {
      const updated = await client.updateMark(mark.id, { status });
      marks = marks.map((candidate) => (candidate.id === updated.id ? updated : candidate));
    } catch (caught) {
      error = friendlyError(caught);
    } finally {
      updatingId = "";
    }
  }

  /** Toggles the to-eval command affordance open for one mark, closing any other open one. */
  function toggleToEval(id: string): void {
    toEvalOpenId = toEvalOpenId === id ? "" : id;
  }

  /** Copies text to the clipboard and shows a brief "Copied" confirmation next to the control. */
  async function copyText(key: string, value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      copiedId = key;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        if (copiedId === key) copiedId = "";
      }, 1500);
    } catch {
      // Clipboard permission can be denied by the browser; the text stays visible and selectable either way.
    }
  }

  /** Renders a caught error into a short, user-facing message. */
  function friendlyError(value: unknown): string {
    const message = value instanceof Error ? value.message : String(value);
    return message.includes("<!doctype") ? "Eval API unavailable. Start the app with `tangent eval ui`." : message;
  }
</script>

<section class="marks-inbox" aria-label="Marks inbox">
  <header class="marks-toolbar">
    <label class="topbar-pick" aria-label="Filter by status">
      <select value={statusFilter} on:change={(event) => selectStatusFilter(event.currentTarget.value)}>
        <option value="">All statuses</option>
        <option value="new">New</option>
        <option value="suggested">Suggested</option>
        <option value="triaged">Triaged</option>
        <option value="eval-created">Eval created</option>
        <option value="fixed">Fixed</option>
        <option value="dismissed">Dismissed</option>
      </select>
    </label>
    <label class="topbar-pick" aria-label="Filter by kind">
      <select value={kindFilter} on:change={(event) => selectKindFilter(event.currentTarget.value)}>
        <option value="">All kinds</option>
        <option value="failure">Failure</option>
        <option value="candidate">Candidate</option>
      </select>
    </label>
    <span class="topbar-spacer"></span>
    <small class="marks-count">{marks.length} mark{marks.length === 1 ? "" : "s"}</small>
  </header>

  {#if error}
    <div class="notice" role="alert">{error}</div>
  {/if}

  {#if loading}
    <div class="state">Loading marks…</div>
  {:else if marks.length === 0}
    <div class="state">No marks match this filter.</div>
  {:else}
    <ul class="marks-list">
      {#each marks as mark (mark.id)}
        <li class="mark-row">
          <div class="mark-row-top">
            <span class={statusChipClass(mark.status)}>{statusLabel(mark.status)}</span>
            <span class="mark-kind">{kindLabel(mark.kind)}</span>
            <span class="mark-repo">{repoLabel(mark.repo.root)}</span>
            <span class="mark-age">{markAge(mark.at)}</span>
          </div>
          <p class="mark-observed">{mark.observed}</p>
          {#if mark.expected || mark.hypothesis}
            <p class="mark-secondary">
              {#if mark.expected}<span>expected: {mark.expected}</span>{/if}
              {#if mark.expected && mark.hypothesis}<span> · </span>{/if}
              {#if mark.hypothesis}<span>hypothesis: {mark.hypothesis}</span>{/if}
            </p>
          {/if}
          <div class="mark-row-actions">
            <button type="button" class="ghost-button" disabled={updatingId === mark.id || actionDisabled(mark, "dismissed")} on:click={() => setStatus(mark, "dismissed")}>
              Dismiss
            </button>
            <button type="button" class="ghost-button" disabled={updatingId === mark.id || actionDisabled(mark, "fixed")} on:click={() => setStatus(mark, "fixed")}>
              Mark fixed
            </button>
            <button type="button" class="ghost-button" aria-expanded={toEvalOpenId === mark.id} on:click={() => toggleToEval(mark.id)}>
              to-eval
            </button>
            <a class="mark-usage-link" href={USAGE_APP_ROUTE}>Open in Usage</a>
            <button type="button" class="mark-session-id" title="Copy session id" on:click={() => copyText(`session:${mark.id}`, mark.anchor.sessionId)}>
              {copiedId === `session:${mark.id}` ? "Copied" : mark.anchor.sessionId}
            </button>
          </div>
          {#if toEvalOpenId === mark.id}
            <div class="mark-to-eval">
              <code>{toEvalCommand(mark.id)}</code>
              <button type="button" class="ghost-button" on:click={() => copyText(mark.id, toEvalCommand(mark.id))}>
                {copiedId === mark.id ? "Copied" : "Copy"}
              </button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>
