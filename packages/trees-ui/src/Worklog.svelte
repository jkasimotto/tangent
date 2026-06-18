<script lang="ts">
  import { onMount } from "svelte";
  import { createWorklogApiClient, type WorklogClient, type WorklogEntry } from "./worklog-client.js";

  export let worklog: WorklogClient = createWorklogApiClient();

  let entries: WorklogEntry[] = [];
  let loading = true;
  let drafts: Record<string, number> = {};

  onMount(load);

  async function load(): Promise<void> {
    loading = true;
    try {
      entries = await worklog.list();
    } finally {
      loading = false;
    }
  }

  // Reverse-chronological: newest work at the top is the timeline.
  $: sorted = [...entries].sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  /** Rough pre-fill: wall-clock minutes since the work started. */
  function elapsedMinutes(startedAt: string): number {
    return Math.max(1, Math.round((Date.now() - new Date(startedAt).getTime()) / 60000));
  }

  async function logActual(entry: WorklogEntry): Promise<void> {
    // ponytail: terminal-elapsed is a rough pre-fill, not truth; the real actual-measurement design is deferred.
    const minutes = drafts[entry.id] ?? elapsedMinutes(entry.startedAt);
    if (!(minutes > 0)) return;
    await worklog.setActual(entry.id, minutes);
    await load();
  }

  function fmtMinutes(m: number): string {
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem ? `${h}h ${rem}m` : `${h}h`;
  }

  function fmtDate(iso: string): string {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function ratio(entry: WorklogEntry): number {
    if (entry.actualMinutes == null || !entry.estimateMinutes) return 0;
    return entry.actualMinutes / entry.estimateMinutes;
  }

  /** Estimate sits at the half-way tick; 2x over fills the bar. */
  function fillPct(entry: WorklogEntry): number {
    return (Math.min(ratio(entry), 2) / 2) * 100;
  }

  function isOver(entry: WorklogEntry): boolean {
    return (entry.actualMinutes ?? 0) > entry.estimateMinutes;
  }

  function deltaLabel(entry: WorklogEntry): string {
    const diff = (entry.actualMinutes ?? 0) - entry.estimateMinutes;
    const sign = diff > 0 ? "+" : diff < 0 ? "-" : "±";
    return `${sign}${fmtMinutes(Math.abs(diff))} · ${ratio(entry).toFixed(1)}×`;
  }
</script>

<main class="worklog-view" aria-label="Worklog">
  <header class="worklog-header">
    <div>
      <p>Tangent Trees</p>
      <h1>Worklog</h1>
    </div>
    <button type="button" class="refresh" on:click={load}>Refresh</button>
  </header>

  {#if loading}
    <div class="worklog-empty">Loading worklog…</div>
  {:else if sorted.length === 0}
    <div class="worklog-empty">
      <strong>No work logged yet.</strong>
      <span>Open an agent from a tree node with a name and estimate to start.</span>
    </div>
  {:else}
    <ul class="worklog-list">
      {#each sorted as entry (entry.id)}
        <li class="worklog-item" class:pending={entry.actualMinutes == null}>
          <div class="item-head">
            <span class="item-name">{entry.name}</span>
            <span class="item-meta">{entry.entityPath ?? entry.cwd} · {fmtDate(entry.startedAt)}</span>
          </div>
          {#if entry.description}
            <p class="item-desc">{entry.description}</p>
          {/if}
          {#if entry.actualMinutes == null}
            <div class="item-log">
              <span class="est">est {fmtMinutes(entry.estimateMinutes)}</span>
              <label class="log-input">
                <span>Actual (min)</span>
                <input type="number" min="1" bind:value={drafts[entry.id]} placeholder={String(elapsedMinutes(entry.startedAt))} />
              </label>
              <button type="button" on:click={() => logActual(entry)}>Log</button>
            </div>
          {:else}
            <div class="item-bar" class:over={isOver(entry)} aria-label={`Estimated ${fmtMinutes(entry.estimateMinutes)}, actual ${fmtMinutes(entry.actualMinutes)}`}>
              <div class="bar-track">
                <div class="bar-fill" style={`width: ${fillPct(entry)}%`}></div>
                <div class="bar-tick" title="estimate"></div>
              </div>
              <div class="bar-legend">
                <span>est {fmtMinutes(entry.estimateMinutes)} → {fmtMinutes(entry.actualMinutes)}</span>
                <span class="delta">{deltaLabel(entry)}</span>
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  .worklog-view {
    --surface: #f3f5f1;
    --pane: #fbfcf9;
    --pane-muted: #e8ede6;
    --line: #d4dcd2;
    --text: #14231b;
    --muted: #657268;
    --accent: #246b58;
    --under: #246b58;
    --over: #c0392b;

    min-height: 0;
    height: 100%;
    overflow: auto;
    background: var(--surface);
    color: var(--text);
    padding: 20px 22px 32px;
  }

  .worklog-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 18px;
    margin-bottom: 14px;
  }

  .worklog-header p {
    margin: 0;
    color: var(--muted);
    font-size: 12px;
    font-weight: 750;
    text-transform: uppercase;
  }

  .worklog-header h1 {
    margin: 2px 0 0;
    font-size: 22px;
    line-height: 1.12;
  }

  .refresh {
    min-height: 34px;
    border: 1px solid var(--line);
    border-radius: 7px;
    background: transparent;
    color: var(--text);
    padding: 0 14px;
    font-size: 13px;
    font-weight: 700;
  }

  .worklog-empty {
    min-height: 220px;
    display: grid;
    place-content: center;
    gap: 6px;
    color: var(--muted);
    text-align: center;
  }

  .worklog-empty strong {
    color: var(--text);
  }

  .worklog-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
    max-width: 760px;
  }

  .worklog-item {
    display: grid;
    gap: 8px;
    padding: 14px 16px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--pane);
  }

  .worklog-item.pending {
    border-style: dashed;
  }

  .item-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .item-name {
    font-size: 15px;
    font-weight: 760;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-meta {
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .item-desc {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.45;
  }

  .item-bar {
    display: grid;
    gap: 6px;
  }

  .bar-track {
    position: relative;
    height: 10px;
    border-radius: 999px;
    background: var(--pane-muted);
  }

  .bar-fill {
    height: 100%;
    border-radius: 999px;
    background: var(--under);
    transition: width 0.2s;
  }

  .item-bar.over .bar-fill {
    background: var(--over);
  }

  .bar-tick {
    position: absolute;
    left: 50%;
    top: -2px;
    bottom: -2px;
    width: 2px;
    background: var(--text);
    opacity: 0.45;
  }

  .bar-legend {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 12px;
    color: var(--muted);
  }

  .delta {
    font-weight: 760;
    color: var(--under);
  }

  .item-bar.over .delta {
    color: var(--over);
  }

  .item-log {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .est {
    font-size: 12px;
    font-weight: 700;
    color: var(--muted);
  }

  .log-input {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--muted);
    font-weight: 700;
  }

  .log-input input {
    width: 84px;
    min-height: 32px;
    border: 1px solid #c6d1c8;
    border-radius: 7px;
    background: #fff;
    color: var(--text);
    outline: none;
    padding: 4px 8px;
  }

  .log-input input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgb(36 107 88 / 13%);
  }

  .item-log button {
    min-height: 32px;
    border: 0;
    border-radius: 7px;
    background: var(--accent);
    color: #fff;
    padding: 0 14px;
    font-size: 13px;
    font-weight: 760;
  }
</style>
