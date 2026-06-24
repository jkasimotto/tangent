<script lang="ts">
  // The day's session ledger: a reviewable, repairable list of finished sessions. Its whole reason to exist is
  // estimate-vs-actual calibration, which is only as true as the recorded boundaries. So every finished session
  // shows est -> actual, and any boundary can be retimed (a forgotten "done", an overnight runaway) into a
  // rough-but-true number. Sessions group by the day they STARTED; the window is today + yesterday so a session
  // left running overnight is still reachable the next morning. See docs/design/day-ledger-retime.md.
  import type { Task } from "./focus-client.js";

  export let tasks: Task[] = [];
  export let now: number = Date.now();
  export let retime: (taskId: string, bounds: { startedAt?: number; doneAt?: number }) => Promise<void>;
  export let reload: () => Promise<void> = async () => {};

  type Edit = "start" | "finish";
  let editingId: string | undefined;
  let editField: Edit = "finish";
  /** Which input is driving the finish: a rough duration ("took ~90m") or an absolute clock time. */
  let mode: "duration" | "clock" = "duration";
  let draftDate = "";
  let draftTime = "";
  let draftDuration: number | null = null;
  let toast = "";
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const MINUTE = 60000;
  const LONG_MIN = 240; // 4h: past here a session was probably left running, so flag it for a look.

  /** Finished sessions, newest first. The live/focused task lives in the focus zone, not here. */
  $: sessions = tasks
    .filter((task) => task.status === "done" || task.status === "dropped")
    .sort((a, b) => b.startedAt - a.startedAt);

  $: todayKey = dayKey(now);
  $: yesterdayKey = dayKey(startOfYesterday(now));
  // Today + yesterday only; each session sits under the day it started.
  $: groups = [
    { key: todayKey, label: "Today" },
    { key: yesterdayKey, label: "Yesterday" }
  ]
    .map((group) => ({ ...group, sessions: sessions.filter((task) => dayKey(task.startedAt) === group.key) }))
    .filter((group) => group.sessions.length > 0);
  $: olderCount = sessions.filter((task) => dayKey(task.startedAt) < yesterdayKey).length;

  $: editTask = editingId ? sessions.find((task) => task.id === editingId) : undefined;
  // If a poll refresh drops the task being edited, close the editor rather than strand it.
  $: if (editingId && !editTask) closeEditor();
  $: candidate = editTask ? candidateBounds(editTask) : undefined;
  $: previewStart = candidate?.startedAt ?? editTask?.startedAt ?? 0;
  $: previewDone = candidate?.doneAt ?? editTask?.doneAt ?? 0;
  $: previewValid =
    !!editTask &&
    Number.isFinite(previewStart) &&
    Number.isFinite(previewDone) &&
    previewDone >= previewStart + MINUTE &&
    previewDone <= now + MINUTE &&
    previewStart <= now;
  $: previewActual = previewValid ? Math.round((previewDone - previewStart) / MINUTE) : null;
  $: invalidReason = invalidWhy();

  function invalidWhy(): string {
    if (!editTask || previewValid) return "";
    if (!Number.isFinite(previewStart) || !Number.isFinite(previewDone)) return "Enter a valid date and time.";
    if (previewDone < previewStart + MINUTE) return "Finish must be after the start.";
    if (previewDone > now + MINUTE || previewStart > now) return "That is in the future.";
    return "That does not add up.";
  }

  /** The corrected bounds implied by the current draft, with only the edited field set. */
  function candidateBounds(task: Task): { startedAt?: number; doneAt?: number } {
    if (editField === "start") return { startedAt: combine(draftDate, draftTime) };
    if (mode === "duration") return { doneAt: draftDuration && draftDuration > 0 ? task.startedAt + draftDuration * MINUTE : NaN };
    return { doneAt: combine(draftDate, draftTime) };
  }

  function openEditor(task: Task, field: Edit): void {
    editingId = task.id;
    editField = field;
    const base = field === "finish" ? task.doneAt ?? now : task.startedAt;
    draftDate = dateValue(base);
    draftTime = timeValue(base);
    draftDuration = field === "finish" && task.doneAt != null ? Math.max(1, Math.round((task.doneAt - task.startedAt) / MINUTE)) : null;
    mode = field === "finish" ? "duration" : "clock";
  }

  function closeEditor(): void {
    editingId = undefined;
    draftDate = "";
    draftTime = "";
    draftDuration = null;
  }

  /** Sets the clock fields from an evidence anchor and switches the finish to clock mode. */
  function pickAnchor(ts: number): void {
    draftDate = dateValue(ts);
    draftTime = timeValue(ts);
    mode = "clock";
  }

  async function commit(): Promise<void> {
    if (!editTask || !previewValid) return;
    const task = editTask;
    const patch = editField === "start" ? { startedAt: previewStart } : { doneAt: previewDone };
    const when = editField === "start" ? previewStart : previewDone;
    await retime(task.id, patch);
    toast = `${task.entity}: ${editField} ${clockTime(when)} · actual ${durationLabel(previewActual ?? 0)}`;
    closeEditor();
    await reload();
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ""), 2600);
  }

  function onEditorKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") { event.preventDefault(); closeEditor(); }
    else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void commit(); }
  }

  /** Finish-time anchors drawn from what the log already knows: when you last had it focused, when the next task
   *  began (a hard upper bound), and now. Each is offered only when it would actually move the finish. */
  function finishAnchors(task: Task): { label: string; ts: number }[] {
    const out: { label: string; ts: number }[] = [];
    const lastOff = task.segments.reduce((max, seg) => (seg.off != null && seg.off > max ? seg.off : max), 0);
    if (lastOff && task.doneAt != null && lastOff < task.doneAt - 2 * MINUTE) out.push({ label: `last focused ${clockTime(lastOff)}`, ts: lastOff });
    const next = tasks
      .filter((other) => other.id !== task.id && other.startedAt > task.startedAt)
      .map((other) => other.startedAt)
      .sort((a, b) => a - b)[0];
    if (next && next > task.startedAt + MINUTE) out.push({ label: `next task ${clockTime(next)}`, ts: next });
    if (now > task.startedAt + MINUTE) out.push({ label: `now ${clockTime(now)}`, ts: now });
    return dedupe(out);
  }

  /** Start-time anchor: when the previous session finished (you likely began right after). */
  function startAnchors(task: Task): { label: string; ts: number }[] {
    const ceiling = task.doneAt ?? now;
    const prevFinish = tasks
      .filter((other) => other.id !== task.id && other.doneAt != null && other.doneAt <= ceiling)
      .map((other) => other.doneAt as number)
      .sort((a, b) => b - a)[0];
    return prevFinish && prevFinish < ceiling - MINUTE ? [{ label: `prev finish ${clockTime(prevFinish)}`, ts: prevFinish }] : [];
  }

  function dedupe(items: { label: string; ts: number }[]): { label: string; ts: number }[] {
    const seen = new Set<number>();
    return items.filter((item) => (seen.has(item.ts) ? false : (seen.add(item.ts), true)));
  }

  // --- estimate-vs-actual bar (estimate sits at the half-way tick; 2x over fills the bar) ---
  function ratio(task: Task): number {
    return task.actualMin != null && task.estimateMin ? task.actualMin / task.estimateMin : 0;
  }
  function fillPct(task: Task): number {
    return (Math.min(ratio(task), 2) / 2) * 100;
  }
  function isOver(task: Task): boolean {
    return (task.actualMin ?? 0) > task.estimateMin;
  }
  function deltaLabel(task: Task): string {
    const diff = (task.actualMin ?? 0) - task.estimateMin;
    const sign = diff > 0 ? "+" : diff < 0 ? "-" : "±";
    return `${sign}${durationLabel(Math.abs(diff))} · ${ratio(task).toFixed(1)}×`;
  }

  function spansDays(task: Task): boolean {
    return task.doneAt != null && dayKey(task.doneAt) !== dayKey(task.startedAt);
  }
  function isLong(task: Task): boolean {
    return (task.actualMin ?? 0) > LONG_MIN;
  }

  function recap(group: { sessions: Task[] }): { count: number; est: number; act: number; pct: number } {
    const done = group.sessions.filter((task) => task.status === "done");
    const est = done.reduce((sum, task) => sum + task.estimateMin, 0);
    const act = done.reduce((sum, task) => sum + (task.actualMin ?? 0), 0);
    return { count: group.sessions.length, est, act, pct: est ? Math.round(((act - est) / est) * 100) : 0 };
  }

  function doneCount(task: Task): number {
    return task.outcomes.filter((outcome) => outcome.doneAt).length;
  }

  /** The entity's leaf segment. The full path repeats across rows and just steals title width; the leaf
   *  ("autodesign", "delivery") carries the distinction, and the full path stays on hover. */
  function entityLeaf(entity: string): string {
    return entity.split("/").at(-1) || entity;
  }

  // --- time + date formatting (all from epoch ms, never from local-time fields, so DST stays coherent) ---
  function durationLabel(minutes: number): string {
    const m = Math.max(0, Math.round(minutes));
    if (m < 60) return `${m}m`;
    return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`;
  }
  function clockTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  function weekday(ts: number): string {
    return new Date(ts).toLocaleDateString([], { weekday: "short" });
  }
  /** Finish label, prefixed with the weekday only when the session crossed midnight. */
  function finishLabel(task: Task): string {
    if (task.doneAt == null) return "running";
    return spansDays(task) ? `${weekday(task.doneAt)} ${clockTime(task.doneAt)}` : clockTime(task.doneAt);
  }
  function dayKey(ts: number): number {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  function startOfYesterday(ts: number): number {
    const d = new Date(ts);
    d.setDate(d.getDate() - 1);
    return d.getTime();
  }
  function pad(n: number): string {
    return String(n).padStart(2, "0");
  }
  function dateValue(ts: number): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function timeValue(ts: number): string {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function combine(date: string, time: string): number {
    if (!date || !time) return NaN;
    return new Date(`${date}T${time}`).getTime();
  }
</script>

<aside class="day-ledger" aria-label="Today's sessions">
  <header class="ledger-head"><h2>Today</h2></header>

  {#if sessions.length === 0}
    <div class="ledger-empty"><strong>No finished sessions yet.</strong><span>Today and yesterday's work shows here, ready to review.</span></div>
  {:else if groups.length === 0}
    <div class="ledger-empty"><strong>Nothing in the last two days.</strong>{#if olderCount}<span>{olderCount} older {olderCount === 1 ? "session" : "sessions"} not shown.</span>{/if}</div>
  {/if}

  {#each groups as group (group.key)}
    {@const r = recap(group)}
    <section class="ledger-day" aria-label={group.label}>
      <div class="day-head">
        <span class="day-label">{group.label}</span>
        <span class="day-recap">{r.count} {r.count === 1 ? "session" : "sessions"}{#if r.est} · est {durationLabel(r.est)} → {durationLabel(r.act)} · {r.pct >= 0 ? "+" : ""}{r.pct}%{/if}</span>
      </div>

      {#each group.sessions as task (task.id)}
        <article class="session" class:flagged={spansDays(task) || isLong(task)} class:editing={editingId === task.id}>
          <div class="session-head">
            <span class="s-title">{task.title}</span>
            <span class="s-tags">
              <span class="s-entity" title={task.entity}>{entityLeaf(task.entity)}</span>
              {#if task.outcomes.length}<span class="s-outcomes">{doneCount(task)}/{task.outcomes.length}</span>{/if}
              {#if spansDays(task)}<span class="flag" title="Finished on a later day — probably left running">spans days</span>
              {:else if isLong(task)}<span class="flag" title="Over 4 hours — check the finish time">long</span>{/if}
            </span>
          </div>

          <div class="bet" class:over={isOver(task)} class:is-dropped={task.status === "dropped"}>
            <div class="bar-row">
              <button type="button" class="t" aria-label="Edit start time" on:click={() => openEditor(task, "start")}>{clockTime(task.startedAt)}</button>
              {#if task.status === "dropped"}
                <span class="dropped-mid">dropped</span>
              {:else}
                <div class="bar-track" aria-label={`Estimated ${durationLabel(task.estimateMin)}, actual ${durationLabel(task.actualMin ?? 0)}`}>
                  <div class="bar-fill" style={`width: ${fillPct(task)}%`}></div><div class="bar-tick" title="estimate"></div>
                </div>
              {/if}
              <button type="button" class="t t-finish" aria-label="Edit finish time" on:click={() => openEditor(task, "finish")}>{finishLabel(task)}</button>
            </div>
            <div class="bar-legend"><span>est {durationLabel(task.estimateMin)} → {durationLabel(task.actualMin ?? 0)}</span><span class="delta">{deltaLabel(task)}</span></div>
          </div>

          {#if editingId === task.id}
            <div class="editor" role="group" aria-label="Retime session" on:keydown={onEditorKeydown}>
              <div class="editor-tabs">
                <button type="button" class:active={editField === "finish"} on:click={() => openEditor(task, "finish")}>Finish</button>
                <button type="button" class:active={editField === "start"} on:click={() => openEditor(task, "start")}>Start</button>
              </div>

              {#if editField === "finish"}
                <label class="field"><span>Took about</span>
                  <span class="dur"><input type="number" min="1" bind:value={draftDuration} on:input={() => (mode = "duration")} aria-label="Actual minutes" /><em>min</em></span>
                </label>
                <div class="or">or finish at</div>
              {/if}
              <div class="field clock-field">
                <input type="date" bind:value={draftDate} on:input={() => (mode = "clock")} aria-label="{editField} date" />
                <input type="time" bind:value={draftTime} on:input={() => (mode = "clock")} aria-label="{editField} time" />
              </div>

              {#if (editField === "finish" ? finishAnchors(task) : startAnchors(task)).length}
                <div class="anchors">
                  {#each (editField === "finish" ? finishAnchors(task) : startAnchors(task)) as anchor}
                    <button type="button" class="anchor" on:click={() => pickAnchor(anchor.ts)}>{anchor.label}</button>
                  {/each}
                </div>
              {/if}

              <p class="preview" class:bad={!previewValid}>
                {#if previewValid}
                  {clockTime(previewStart)} → {finishPreview(previewStart, previewDone)} · actual {durationLabel(previewActual ?? 0)} · est {durationLabel(task.estimateMin)}
                {:else}{invalidReason}{/if}
              </p>
              <div class="editor-actions">
                <button type="button" class="secondary" on:click={closeEditor}>Cancel</button>
                <button type="button" class="primary" disabled={!previewValid} on:click={commit}>Set</button>
              </div>
            </div>
          {/if}
        </article>
      {/each}
    </section>
  {/each}

  {#if toast}<div class="toast" role="status">{toast}</div>{/if}
</aside>

<script context="module" lang="ts">
  // Finish label for the live preview: weekday prefix only when it crosses midnight from the start.
  function finishPreview(start: number, done: number): string {
    const sameDay = new Date(start).toDateString() === new Date(done).toDateString();
    const time = new Date(done).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return sameDay ? time : `${new Date(done).toLocaleDateString([], { weekday: "short" })} ${time}`;
  }
</script>

<style>
  .day-ledger {
    --pane: #fbfcf9; --line: #d4dcd2; --text: #14231b; --muted: #657268; --accent: #246b58; --over: #c0392b; --flag: #b06f17;
    color-scheme: light;
    display: flex; flex-direction: column; gap: 14px;
    padding: 6px 4px 48px;
    color: var(--text);
    min-width: 0;
  }
  .ledger-head h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.07em; opacity: 0.5; margin: 0; font-weight: 600; }
  .ledger-empty { display: flex; flex-direction: column; gap: 4px; color: var(--muted); font-size: 13px; padding: 18px 6px; }
  .ledger-empty strong { color: var(--text); font-size: 14px; }

  .ledger-day { display: flex; flex-direction: column; gap: 8px; }
  .day-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-top: 4px; }
  .day-label { font-size: 13px; font-weight: 760; }
  .day-recap { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; text-align: right; }

  .session { display: flex; flex-direction: column; gap: 6px; padding: 9px 12px; border: 1px solid var(--line); border-radius: 11px; background: var(--pane); }
  .session.flagged { border-color: var(--flag); background: #fdf7ee; }
  .session.editing { box-shadow: 0 8px 24px rgba(20, 35, 27, 0.12); }

  /* Headline: the title leads; entity, progress, and any flag are small tags trailing right. */
  .session-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
  .s-title { font-size: 13px; font-weight: 700; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
  .s-tags { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .s-entity { font-family: var(--font-mono, ui-monospace, monospace); font-size: 10px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 128px; }
  .s-outcomes { font-size: 10px; font-variant-numeric: tabular-nums; color: var(--muted); flex-shrink: 0; }
  .flag { font-size: 9px; font-weight: 760; text-transform: uppercase; letter-spacing: 0.04em; color: var(--flag); background: #f6e8d2; border-radius: 999px; padding: 1px 6px; white-space: nowrap; }

  /* The bet: clock times flank the bar as small endpoints (start ▓▓ finish), each click-to-edit. */
  .bet { display: flex; flex-direction: column; gap: 4px; }
  .bet.is-dropped { opacity: 0.6; }
  .bar-row { display: flex; align-items: center; gap: 8px; }
  .t { border: 0; background: transparent; padding: 1px 3px; border-radius: 5px; cursor: pointer; font-size: 11px; font-weight: 700; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; flex-shrink: 0; }
  .t:hover { background: #eef2ec; color: var(--text); }
  .t:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .t-finish { color: var(--accent); }
  .bar-track { position: relative; flex: 1; min-width: 56px; height: 8px; border-radius: 999px; background: #e8ede6; }
  .bar-fill { height: 100%; border-radius: 999px; background: var(--accent); transition: width 0.2s; }
  .bet.over .bar-fill { background: var(--over); }
  .bar-tick { position: absolute; left: 50%; top: -2px; bottom: -2px; width: 2px; background: var(--text); opacity: 0.4; }
  .dropped-mid { flex: 1; text-align: center; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  .bar-legend { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 3px; font-size: 10px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .delta { font-weight: 760; color: var(--accent); }
  .bet.over .delta { color: var(--over); }

  /* Inline retime editor: rough duration first, clock + evidence anchors for precision, live preview. */
  .editor { display: flex; flex-direction: column; gap: 9px; margin-top: 3px; padding: 11px; border: 1px solid var(--line); border-radius: 10px; background: #fff; }
  .editor-tabs { display: flex; gap: 4px; }
  .editor-tabs button { flex: 1; border: 1px solid var(--line); background: #fff; border-radius: 8px; padding: 6px 0; font-size: 12px; font-weight: 700; color: var(--muted); cursor: pointer; }
  .editor-tabs button.active { border-color: var(--accent); color: var(--accent); background: #eef5f1; }
  .field { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; font-weight: 700; color: var(--muted); }
  .dur { display: inline-flex; align-items: center; gap: 6px; }
  .dur em { font-style: normal; }
  .field input { border: 1px solid var(--line); border-radius: 8px; padding: 7px 9px; font-size: 13px; background: #fff; color: var(--text); box-sizing: border-box; }
  .field input[type="number"] { width: 72px; text-align: center; }
  .clock-field { gap: 6px; }
  .clock-field input { flex: 1; min-width: 0; }
  .field input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .or { font-size: 11px; color: var(--muted); text-align: center; text-transform: uppercase; letter-spacing: 0.05em; }
  .anchors { display: flex; flex-wrap: wrap; gap: 6px; }
  .anchor { border: 1px solid var(--line); background: #fff; border-radius: 999px; padding: 5px 10px; font-size: 11px; font-weight: 700; color: var(--text); cursor: pointer; font-variant-numeric: tabular-nums; }
  .anchor:hover { border-color: var(--accent); color: var(--accent); }
  .preview { margin: 0; font-size: 12px; color: var(--text); font-variant-numeric: tabular-nums; }
  .preview.bad { color: var(--over); }
  .editor-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .editor-actions button { border-radius: 8px; padding: 7px 14px; font-size: 13px; font-weight: 700; cursor: pointer; border: 1px solid var(--line); background: #fff; color: var(--text); }
  .editor-actions .primary { background: var(--accent); color: #fff; border-color: transparent; }
  .editor-actions .primary:disabled { opacity: 0.5; cursor: not-allowed; }

  .toast { position: sticky; bottom: 12px; align-self: center; background: var(--text); color: #fff; font-size: 12px; font-weight: 700; padding: 9px 14px; border-radius: 999px; box-shadow: 0 8px 24px rgba(20, 35, 27, 0.28); animation: toast-in 0.16s ease-out; }
  @keyframes toast-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
</style>
