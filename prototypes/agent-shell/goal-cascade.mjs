/**
 * Returns one Goal and every reachable Subgoal, starting with the root.
 * Goals are keyed by vault-relative file; Subgoals links use vault-unique
 * slugs, matching the agent shell's index. Missing links and cycles are safe.
 */
export function doneCascade(rootFile, goalsByFile) {
  const bySlug = new Map([...goalsByFile.values()].map((goal) => [goal.slug, goal]));
  const ordered = [];
  const seen = new Set();

  /** Adds one Goal and recursively follows its unvisited Subgoals. */
  const visit = (goal) => {
    if (!goal || seen.has(goal.file)) return;
    seen.add(goal.file);
    ordered.push(goal);
    for (const slug of goal.subgoals) visit(bySlug.get(slug));
  };

  visit(goalsByFile.get(rootFile));
  return ordered;
}
