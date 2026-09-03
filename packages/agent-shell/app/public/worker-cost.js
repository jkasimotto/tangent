import { escapeHtml } from "./text-format.js";

// What one worker cost, on the two surfaces where a person meets a worker:
// the Work table's Cost column and the header of the session they entered.
//
// The figure obeys the rules the cost work already established. No rate is
// guessed, so a model with no rate shows its tokens rather than a wrong
// dollar or a silent zero. A figure that leaves anything out carries a tilde
// and says what, because a number that quietly under-reports is worse than
// one that admits it is a floor. A worker that is still running is always a
// floor: it has not finished spending.

/** The figure itself: a dollar, a token count, or a dash. */
export function workerCostText(entry) {
  if (!entry) return "—";
  if (entry.amount > 0) return entry.floor ? `~${entry.display}` : entry.display;
  if (entry.unpricedTokens > 0) return entry.unpricedDisplay;
  if (entry.conversations > 0) return entry.floor ? `~${entry.display}` : entry.display;
  return "—";
}

/** True when the figure is a floor, so the surface can mark it. */
export function workerCostIsFloor(entry) {
  return Boolean(entry?.floor);
}

/** True when nothing was priced and the figure is a token count instead. */
export function workerCostIsTokens(entry) {
  return Boolean(entry && entry.amount === 0 && entry.unpricedTokens > 0);
}

/**
 * The hover: what the figure covers, then what it leaves out.
 *
 * `subject` names the thing in the reader's words, so the same function
 * serves a Goal row and a session header without either of them guessing.
 */
export function workerCostTitle(entry, subject = "this work") {
  if (!entry) return `Nothing has been recorded for ${subject} yet.`;
  const lines = [`${coverage(entry, subject)}.`];
  if (entry.subagents) lines.push(entry.subagents);
  if (entry.reasons?.length) lines.push("Not in this figure:", ...entry.reasons.map((reason) => `· ${reason}`));
  lines.push("List prices. On a subscription this measures work done, not money spent.");
  return lines.join("\n");
}

/** The one-line statement of what the figure counted. */
function coverage(entry, subject) {
  const conversations = `${entry.conversations} conversation${entry.conversations === 1 ? "" : "s"}`;
  const workers = entry.workers > 1 ? `${entry.workers} workers over ` : "";
  const harnesses = entry.harnesses?.length ? ` on ${entry.harnesses.join(" and ")}` : "";
  if (!entry.conversations) return `No conversation was reached for ${subject}`;
  return `${workerCostText(entry)} for ${subject}: ${workers}${conversations}${harnesses}`;
}

/** The class list that colours one figure. */
export function workerCostClass(entry) {
  return ["worker-cost", entry ? "" : "worker-cost-none", workerCostIsFloor(entry) ? "worker-cost-floor" : "", workerCostIsTokens(entry) ? "worker-cost-tokens" : ""].filter(Boolean).join(" ");
}

/** One figure as the markup both surfaces print. */
export function workerCostMarkup(entry, subject) {
  return `<span class="${workerCostClass(entry)}" title="${escapeHtml(workerCostTitle(entry, subject))}">${escapeHtml(workerCostText(entry))}</span>`;
}

/**
 * Writes the current figures into every element that asked for one.
 *
 * The Work table repaints on its own clock and the cost reading runs on
 * another, so the figures are written in place rather than by repainting the
 * screen: a repaint for a changed dollar would move the cursor and the
 * keyboard focus under a person who was reading a row.
 */
export function paintWorkerCosts(root, index) {
  for (const element of root?.querySelectorAll?.("[data-worker-cost]") ?? []) {
    const key = element.dataset.workerCost;
    const scope = element.dataset.workerCostScope === "session" ? index?.sessions : index?.work;
    element.innerHTML = workerCostMarkup(scope?.[key] ?? null, element.dataset.workerCostSubject || "this work");
  }
}
