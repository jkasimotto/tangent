import { escapeHtml } from "./text-format.js";

// The estimated cost in the top bar.
//
// It is one small dim figure. Reading it must cost a glance and nothing else,
// so there is no button, no panel to open, and no refresh to ask for: the
// number is simply there, and resting on it shows what it is made of.
//
// A number that leaves something out says so. When work could not be reached
// or a model has no published rate, the figure carries a tilde and the
// breakdown names every reason, because a total that silently under-reports
// is worse than one that admits its gaps.

/** The top-bar figure for one cost snapshot. */
export function costAmountText(snapshot) {
  if (!snapshot || snapshot.status !== "ready") return "…";
  return snapshot.complete ? snapshot.display : `~${snapshot.display}`;
}

/** The one-line summary a reader gets before opening anything. */
export function costTitleText(snapshot) {
  if (!snapshot || snapshot.status !== "ready") return "Reading what today cost";
  const window = snapshot.days === 1 ? "today" : `the last ${snapshot.days} days`;
  return snapshot.complete
    ? `Estimated cost of ${window}`
    : `Estimated cost of ${window}, and it excludes work named in the breakdown`;
}

/**
 * The hover breakdown.
 *
 * Ordered by what a person wants first: where the money went, then which
 * models spent it, then what the figure does not cover. The subscription
 * caveat is last and always present, because these are list prices and the
 * number measures work rather than money that left an account.
 */
export function costBreakdownMarkup(snapshot) {
  if (!snapshot || snapshot.status !== "ready") return `<p class="cost-breakdown-note">Reading transcripts…</p>`;
  const window = snapshot.days === 1 ? "Today" : `Last ${snapshot.days} days`;
  const sections = [
    `<h3>${escapeHtml(window)} · ${escapeHtml(snapshot.display)}</h3>`,
    rows("Work", snapshot.work.map((entry) => ({ label: workLabel(entry), display: entry.display }))),
    rows("Harness", snapshot.byHarness.map((entry) => ({ label: entry.harness, display: entry.display }))),
    rows("Model", snapshot.byModel.map((entry) => ({ label: entry.id, display: entry.display }))),
    excludedRows(snapshot.excluded),
    `<p class="cost-breakdown-note">List prices over ${snapshot.conversations} conversation${snapshot.conversations === 1 ? "" : "s"}. On a subscription this measures work done, not money spent.</p>`,
  ];
  return sections.filter(Boolean).join("");
}

/** Names one piece of work the way its own surface names it. */
function workLabel(entry) {
  const name = String(entry.name ?? "").replace(/^goal-/, "").replace(/\.md$/, "").replaceAll("-", " ");
  return entry.scope === "brain" ? `${entry.area} brain` : name || entry.area || "unnamed work";
}

/** One titled group of amount rows, or nothing when the group is empty. */
function rows(title, entries) {
  if (!entries.length) return "";
  const body = entries.map((entry) => `<div class="cost-breakdown-row"><span>${escapeHtml(entry.label)}</span><b>${escapeHtml(entry.display)}</b></div>`).join("");
  return `<h4>${escapeHtml(title)}</h4>${body}`;
}

/** What the number leaves out, one line per reason. */
function excludedRows(excluded) {
  if (!excluded?.length) return "";
  const body = excluded.map((entry) => `<div class="cost-breakdown-row cost-breakdown-excluded"><span>${escapeHtml(entry.reason)}</span><b>${entry.count}</b></div>`).join("");
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
