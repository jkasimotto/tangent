import { normalizeGoalStatus } from "./goal-lifecycle.mjs";

/** Reads canonical Goal links from the Dependencies section. */
export function dependencySlugs(text) {
  const body = markdownSection(text, "Dependencies");
  return [...new Set([...body.matchAll(/\[\[goal-([a-z0-9-]+)(?:[^\]]*)\]\]/g)].map((match) => match[1]))];
}

/** Replaces or removes the Dependencies section without changing other Goal content. */
export function writeDependencySlugs(text, slugs) {
  const lines = [...new Set(slugs)].map((slug) => `- [[goal-${slug}]]`).join("\n");
  const heading = /^## Dependencies\s*$/m;
  const match = heading.exec(text);
  if (!match) return lines ? `${text.trimEnd()}\n\n## Dependencies\n\n${lines}\n` : text;
  const end = text.slice(match.index + match[0].length).search(/^##\s+/m);
  const sectionEnd = end < 0 ? text.length : match.index + match[0].length + end;
  const before = text.slice(0, match.index).trimEnd();
  const after = text.slice(sectionEnd).trimStart();
  return [before, lines ? `## Dependencies\n\n${lines}` : "", after].filter(Boolean).join("\n\n") + "\n";
}

/** Adds resolved forward and reverse dependency references to Goal records. */
export function projectGoalDependencies(goals) {
  const groups = groupBySlug(goals);
  for (const goal of goals) {
    goal.dependsOn = [];
    goal.requiredBy = [];
    goal.unresolvedDependencies = [];
  }
  for (const goal of goals) {
    for (const slug of goal.dependencySlugs ?? []) {
      const matches = groups.get(slug) ?? [];
      if (matches.length !== 1) {
        goal.unresolvedDependencies.push(slug);
        continue;
      }
      const prerequisite = matches[0];
      goal.dependsOn.push(goalReference(prerequisite));
      prerequisite.requiredBy.push(goalReference(goal));
    }
  }
  for (const goal of goals) goal.requiredBy.sort((a, b) => a.file.localeCompare(b.file));
  return goals;
}

/** Validates and calculates one idempotent dependency mutation. */
export function changeGoalDependencies(goals, dependentSlug, prerequisiteSlugs, remove = false) {
  const groups = groupBySlug(goals);
  const dependent = uniqueGoal(groups, dependentSlug);
  if (dependent.error) return dependent;
  const prerequisites = [];
  for (const slug of [...new Set(prerequisiteSlugs)]) {
    const found = uniqueGoal(groups, slug);
    if (found.error) return found;
    if (found.goal.slug === dependent.goal.slug) return { error: `goal ${dependentSlug} cannot depend on itself` };
    prerequisites.push(found.goal);
  }
  const current = [...new Set(dependent.goal.dependencySlugs ?? [])];
  const changed = remove
    ? current.filter((slug) => !prerequisiteSlugs.includes(slug))
    : [...current, ...prerequisites.map((goal) => goal.slug).filter((slug) => !current.includes(slug))];
  if (!remove) {
    const edges = new Map(goals.map((goal) => [goal.slug, [...new Set(goal.dependencySlugs ?? [])]]));
    edges.set(dependent.goal.slug, changed);
    if (hasCycle(edges)) return { error: `dependency change would create a cycle from goal ${dependentSlug}` };
  }
  return { goal: dependent.goal, slugs: changed, changed: changed.join("\n") !== current.join("\n") };
}

/** Formats advisory dependency facts for agent prompts. */
export function dependencyPromptLines(goals, include = () => true) {
  projectGoalDependencies(goals);
  return goals.filter(include).flatMap((goal) => goal.dependsOn.map((prerequisite) => `- ${goal.title} depends on ${prerequisite.title}.`));
}

/** Reads one level-two Markdown section. */
function markdownSection(text, name) {
  const match = new RegExp(`^## ${escapeRegExp(name)}\\s*$`, "m").exec(String(text ?? ""));
  if (!match) return "";
  const rest = String(text).slice(match.index + match[0].length);
  const end = rest.search(/^##\s+/m);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

/** Groups Goal records without hiding duplicate legacy slugs. */
function groupBySlug(goals) {
  const groups = new Map();
  for (const goal of goals) groups.set(goal.slug, [...(groups.get(goal.slug) ?? []), goal]);
  return groups;
}

/** Resolves exactly one Goal or returns an actionable lookup error. */
function uniqueGoal(groups, slug) {
  const matches = groups.get(slug) ?? [];
  if (!matches.length) return { error: `no goal ${slug}` };
  if (matches.length > 1) return { error: `goal ${slug} is ambiguous: ${matches.map((goal) => goal.file).join(", ")}` };
  return { goal: matches[0] };
}

/** Reports whether a dependency adjacency map contains a directed cycle. */
function hasCycle(edges) {
  const visiting = new Set();
  const visited = new Set();
  /** Visits one Goal with temporary marks for cycle detection. */
  const visit = (slug) => {
    if (visiting.has(slug)) return true;
    if (visited.has(slug)) return false;
    visiting.add(slug);
    for (const next of edges.get(slug) ?? []) if (edges.has(next) && visit(next)) return true;
    visiting.delete(slug);
    visited.add(slug);
    return false;
  };
  return [...edges.keys()].some(visit);
}

/** Reduces one Goal to the stable relationship projection. */
function goalReference(goal) {
  return { file: goal.file, title: goal.title, doneWhen: goal.doneWhen, status: normalizeGoalStatus(goal.status) };
}

/** Escapes a literal Markdown heading for a regular expression. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
