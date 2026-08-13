// Pure tree-mode rules shared by Agent Shell's browser UI and its focused
// unit tests. Kept as a classic script so the monolithic prototype can use it
// synchronously; Node tests load it for the same global side effect.
(function exposeTreeModes(root) {
  const TREE_MODES = ["visible", "active", "inactive", "all"];

  /** True when an outcome belongs to work already handed to a live session. */
  function outcomeInFlight({ hasSession, status }) {
    return Boolean(hasSession) || status === "active";
  }

  /** Whether a mode admits the outcome before hierarchy and scope are applied. */
  function modeIncludesOutcome(mode, facts) {
    const inFlight = outcomeInFlight(facts);
    if (mode === "active") return inFlight || Boolean(facts.fresh);
    if (mode === "inactive") return !inFlight;
    return true;
  }

  /** Finds the nearest retained ancestor after a mode removes intermediate rows. */
  function nearestIncludedParent(file, parentByFile, included) {
    const seen = new Set();
    let parent = parentByFile.get(file) ?? null;
    while (parent && !included.has(parent) && !seen.has(parent)) {
      seen.add(parent);
      parent = parentByFile.get(parent) ?? null;
    }
    return parent && included.has(parent) ? parent : null;
  }

  root.AgentShellTreeModes = { TREE_MODES, outcomeInFlight, modeIncludesOutcome, nearestIncludedParent };
})(globalThis);
