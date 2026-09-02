import { escapeHtml } from "./text-format.js";

// The estimated cost in the top bar.
//
// It is one small dim figure. Reading it must cost a glance and nothing else,
// so there is no button, no panel to open and no refresh to ask for: the
// number is simply there, and resting on it or reaching it with the keyboard
// shows what it is made of.
//
// A number that leaves something out says so. When work could not be reached,
// or a model has no rate, the figure carries a tilde and the breakdown names
// every reason, because a total that silently under-reports is worse than one
// that admits its gaps.

/** The top-bar figure for one cost snapshot. */
export function costAmountText(snapshot) {
  if (!snapshot || snapshot.status !== "ready") return "…";
  return snapshot.complete ? snapshot.display : `~${snapshot.display}`;
}

/** The window one snapshot covers, in the words a person would use. */
function windowName(snapshot) {
  return snapshot.days === 1 ? "today" : `the last ${snapshot.days} days`;
}

/** The one-line summary a reader gets before opening anything. */
export function costTitleText(snapshot) {
  if (!snapshot || snapshot.status !== "ready") return "Reading what today cost";
  return snapshot.complete
    ? `Estimated cost of ${windowName(snapshot)}`
    : `Estimated cost of ${windowName(snapshot)}, and it leaves out the work named in the breakdown`;
}

/**
 * The hover breakdown.
 *
 * Ordered by what a person wants first: where the money went, then which
 * harnesses spent it, then which models, then what the figure does not cover.
 * The subscription caveat is last and always present, because these are list
 * prices: the number measures work done rather than money that left an
 * account.
 */
export function costBreakdownMarkup(snapshot) {
  if (!snapshot || snapshot.status !== "ready") return `<p class="cost-breakdown-note">Reading transcripts…</p>`;
  const heading = snapshot.days === 1 ? "Today" : `Last ${snapshot.days} days`;
  return [
    `<h3>${escapeHtml(heading)} · ${escapeHtml(snapshot.display)}</h3>`,
    amountRows("Work", snapshot.work.map((entry) => ({ label: workLabel(entry), display: entry.display }))),
    amountRows("Harness", snapshot.byHarness.map((entry) => ({ label: entry.harness, display: entry.display }))),
    amountRows("Model", snapshot.byModel.map((entry) => ({ label: entry.id, display: entry.display }))),
    excludedRows(snapshot.excluded),
    `<p class="cost-breakdown-note">List prices over ${snapshot.conversations} conversation${snapshot.conversations === 1 ? "" : "s"}. On a subscription this measures work done, not money spent.</p>`,
  ].filter(Boolean).join("");
}

/**
 * Names one piece of work the way a person would say it.
 *
 * A Job record stores its Goal as a vault path, so the Area, the `goal-`
 * prefix and the `.md` suffix all have to come off before the name is
 * readable in a line this narrow.
 */
function workLabel(entry) {
  if (entry.scope === "brain") return `${entry.area} brain`;
  if (entry.scope === "repair") return `${entry.area} repair`;
  const name = String(entry.name ?? "").split("/").pop().replace(/^goal-/, "").replace(/\.md$/, "").replaceAll("-", " ");
  return name || entry.area || "unnamed work";
}

/** One titled group of amount rows, or nothing when the group is empty. */
function amountRows(title, entries) {
  if (!entries.length) return "";
  const body = entries.map((entry) => `<div class="cost-breakdown-row"><span>${escapeHtml(entry.label)}</span><b>${escapeHtml(entry.display)}</b></div>`).join("");
  return `<h4>${escapeHtml(title)}</h4>${body}`;
}

/** What the number leaves out, one line per reason. */
function excludedRows(excluded) {
  if (!excluded?.length) return "";
  const body = excluded.map((entry) => {
    const detail = entry.detail ? `<em>${escapeHtml(entry.detail)}</em>` : "";
    const count = entry.count > 1 ? `<b>${entry.count}</b>` : "";
    return `<div class="cost-breakdown-row cost-breakdown-excluded"><span>${escapeHtml(entry.reason)}${detail}</span>${count}</div>`;
  }).join("");
  return `<h4>Not in this number</h4>${body}`;
}

/** Writes one cost snapshot into the top bar. */
export function renderCostReadout({ readout, amount, breakdown }, snapshot) {
  if (!readout || !amount || !breakdown) return;
  readout.hidden = !snapshot;
  if (!snapshot) return;
  amount.textContent = costAmountText(snapshot);
  amount.title = costTitleText(snapshot);
  readout.classList.toggle("cost-incomplete", snapshot.status === "ready" && !snapshot.complete);
  breakdown.innerHTML = costBreakdownMarkup(snapshot);
}
