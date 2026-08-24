import areaMapCore from "./area-map-core.js";
import whatHappenedCore from "./what-happened-core.js";
import { escapeHtml } from "./text-format.js";

/** Creates the recent-close overlay renderer around shell-owned navigation data. */
export function createWhatHappenedView({ state, areaLabel, goalByFile, humanName }) {
  /** Renders one close row. */
  function row(close, panelArea, now, timezoneOffset) {
    const goal = goalByFile(close.file);
    const directory = close.file.split("/").slice(0, -1).join("/");
    const foreign = directory !== panelArea ? `<small class="what-happened-area">${escapeHtml(humanName(directory.split("/").pop()))}</small>` : "";
    const title = goal ? goal.title : humanName(close.file.split("/").pop().replace(/^goal-/, "").replace(/\.md$/, ""));
    const hoverTitle = !goal ? "" : close.kind === "done" ? goal.doneWhen : whatHappenedCore.wontDoReason(goal.stateText);
    const word = close.kind === "done" ? "done" : "won't do";
    const mark = close.kind === "done" ? "✓" : "✕";
    return `<button class="what-happened-row" type="button" data-open-close="${escapeHtml(close.file)}" title="${escapeHtml(hoverTitle)}">
      <span class="what-happened-time">${escapeHtml(whatHappenedCore.closeMomentLabel(close.at, now, timezoneOffset))}</span>
      <span class="what-happened-kind ${close.kind}">${mark} ${escapeHtml(word)}</span>
      <span class="what-happened-title">${escapeHtml(title)}${foreign}</span>
      <span class="what-happened-closer">${escapeHtml(whatHappenedCore.closerLabel(close.session))}</span>
    </button>`;
  }

  /** Renders the recent-close overlay. */
  function overlay() {
    if (!state.whatHappened) return "";
    const { area, anchor } = state.whatHappened;
    const width = Math.min(560, window.innerWidth - 32);
    const left = Math.max(16, anchor.right - width);
    const style = `top:${anchor.top}px;left:${left}px;width:${width}px;max-height:calc(100vh - ${anchor.top + 16}px)`;
    const label = `What happened in ${areaLabel(area)} in the last 12 hours`;
    if (!state.vault) return `<div class="what-happened" data-what-happened role="dialog" aria-label="${escapeHtml(label)}" style="${style}"><header class="what-happened-header"><strong>What happened · last 12 hours</strong><small>esc</small></header><p class="what-happened-empty">Loading the vault…</p></div>`;
    const now = Date.now();
    const closes = whatHappenedCore.windowCloses(whatHappenedCore.areaCloses(state.vault.recentCloses ?? [], area, areaMapCore.isInside), now);
    const body = closes.length ? closes.map((close) => row(close, area, now, new Date().getTimezoneOffset())).join("") : `<p class="what-happened-empty">Nothing was marked done or won't do in the last 12 hours.</p>`;
    return `<div class="what-happened" data-what-happened role="dialog" aria-label="${escapeHtml(label)}" style="${style}"><header class="what-happened-header"><strong>What happened · last 12 hours</strong><small>esc</small></header>${body}<button class="what-happened-all" type="button" data-open-history="${escapeHtml(area)}">See all finished work →</button></div>`;
  }

  /** Returns the overlay's stable render-key contribution. */
  function renderKey() {
    if (!state.whatHappened) return null;
    const { area, anchor } = state.whatHappened;
    const closes = state.vault ? whatHappenedCore.windowCloses(whatHappenedCore.areaCloses(state.vault.recentCloses ?? [], area, areaMapCore.isInside), Date.now()) : [];
    return [area, anchor.top, anchor.right, closes[0]?.file ?? null, closes[0]?.at ?? null];
  }

  return { overlay, renderKey };
}
