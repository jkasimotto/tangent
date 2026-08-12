/**
 * Returns an outcome and every reachable Breakdown descendant, parent first.
 * Outcomes are keyed by vault-relative file; Breakdown links use vault-unique
 * slugs, matching the agent shell's index. Missing links and cycles are safe.
 */
export function doneCascade(rootFile, outcomesByFile) {
  const bySlug = new Map([...outcomesByFile.values()].map((outcome) => [outcome.slug, outcome]));
  const ordered = [];
  const seen = new Set();

  /** Adds one outcome and recursively follows its unvisited children. */
  const visit = (outcome) => {
    if (!outcome || seen.has(outcome.file)) return;
    seen.add(outcome.file);
    ordered.push(outcome);
    for (const slug of outcome.breakdown) visit(bySlug.get(slug));
  };

  visit(outcomesByFile.get(rootFile));
  return ordered;
}
