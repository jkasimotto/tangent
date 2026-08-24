// The Area Work graph's pure projection (design contract:
// otto/tangent/design-a-better-view-over-my-work-past-and-present).
const PAGE_SIZE = 12;
const CLOSED = new Set(["done", "dropped"]);
/** True when a path belongs to one Area subtree. */
function isInside(path, scope) { return path === scope || path.startsWith(`${scope}/`); }
/** Orders Goals by Area-note order, latest change, and title. */
function stableGoals(goals) {
  return [...goals].sort((a, b) => Number(a.order ?? 1e9) - Number(b.order ?? 1e9)
    || Number(b.changedAt ?? b.mtime ?? 0) - Number(a.changedAt ?? a.mtime ?? 0) || a.title.localeCompare(b.title));
}
/** Derives one Goal's readiness and unfinished blockers. */
function readiness(goal, byFile) {
  const unresolved = goal.unresolvedDependencies ?? [];
  if (unresolved.length) return { kind: "error", blockers: unresolved };
  const unfinished = (goal.dependsOn ?? []).filter((item) => item.status !== "done");
  if (!unfinished.length) return { kind: "ready", blockers: [] };
  if (unfinished.some((item) => item.status === "dropped")) return { kind: "broken", blockers: unfinished };
  return { kind: "blocked", blockers: unfinished.map((item) => byFile.get(item.file) ?? item) };
}
/** True when a Goal matches one normalized person filter. */
function matchesPerson(goal, person) {
  if (!person || person === "all") return true;
  if (person === "mine") return (goal.assignees ?? []).some((name) => name.toLowerCase() === "julian");
  if (person === "unassigned") return !(goal.assignees ?? []).length;
  return (goal.assigneeKeys ?? []).includes(person);
}
/** Projects a bounded ready-first graph for one selected Area. */
function project({ scope, goals, areaPaths, filters = {}, limits = {} }) {
  const open = goals.filter((goal) => isInside(goal.area, scope) && !CLOSED.has(goal.status));
  const byFile = new Map(goals.map((goal) => [goal.file, goal]));
  const facts = new Map(goals.map((goal) => [goal.file, readiness(goal, byFile)]));
  const query = String(filters.query ?? "").trim().toLowerCase();
  const targetScope = filters.scope || scope;
  const reduced = (filters.person && filters.person !== "all") || (filters.state && filters.state !== "all") || query || targetScope !== scope;
  const matches = stableGoals(open.filter((goal) => isInside(goal.area, targetScope))
    .filter((goal) => matchesPerson(goal, filters.person))
    .filter((goal) => !filters.state || filters.state === "all" || facts.get(goal.file).kind === filters.state
      || (filters.state === "working" && goal.status === "active") || (filters.state === "waiting" && Boolean(goal.waitingOn)))
    .filter((goal) => !query || `${goal.title}\n${goal.doneWhen ?? ""}`.toLowerCase().includes(query)));
  const context = new Map();
  /** Retains every unfinished prerequisite path for one matching Goal. */
  const keepPrerequisites = (goal, neededBy, seen = new Set()) => {
    if (seen.has(goal.file)) return;
    seen.add(goal.file);
    for (const reference of goal.dependsOn ?? []) {
      if (reference.status === "done") continue;
      const prerequisite = byFile.get(reference.file) ?? { ...reference, area: reference.file.split("/").slice(0, -1).join("/"), missing: true };
      if (!matches.some((item) => item.file === prerequisite.file)) context.set(prerequisite.file, { ...prerequisite, neededBy });
      if (!prerequisite.missing) keepPrerequisites(prerequisite, neededBy, seen);
    }
  };
  if (reduced) for (const goal of matches) keepPrerequisites(goal, goal.title);
  const directReady = stableGoals(open.filter((goal) => goal.area === scope && facts.get(goal.file).kind === "ready"));
  const depth = scope.split("/").length + 1;
  const portals = areaPaths.filter((path) => path.startsWith(`${scope}/`) && path.split("/").length === depth).sort().map((path) => {
    const childGoals = open.filter((goal) => isInside(goal.area, path));
    const ready = stableGoals(childGoals.filter((goal) => facts.get(goal.file).kind === "ready"));
    return { kind: "portal", path, title: path.split("/").pop(), openCount: childGoals.length, readyCount: ready.length, preview: ready[0] ?? null };
  }).filter((portal) => portal.openCount);
  const allFrontier = reduced
    ? [...context.values(), ...matches].map((goal) => ({ kind: goal.neededBy ? "context" : "goal", goal, fact: facts.get(goal.file) ?? readiness(goal, byFile) }))
    : [...directReady.map((goal) => ({ kind: "goal", goal, fact: facts.get(goal.file) })), ...portals];
  const frontier = allFrontier.slice(0, Math.max(PAGE_SIZE, Number(limits.frontier ?? PAGE_SIZE)));
  const readyFiles = new Set(frontier.filter((item) => item.kind === "goal" && item.fact.kind === "ready").map((item) => item.goal.file));
  const allSuccessors = stableGoals(open.filter((goal) => (goal.dependsOn ?? []).some((item) => readyFiles.has(item.file))));
  const successors = allSuccessors.slice(0, Math.max(PAGE_SIZE, Number(limits.successors ?? PAGE_SIZE))).map((goal) => ({ kind: "goal", goal, fact: facts.get(goal.file) }));
  return { openCount: open.length, readyCount: open.filter((goal) => facts.get(goal.file).kind === "ready").length, matchCount: matches.length,
    frontier, frontierHidden: allFrontier.length - frontier.length, successors, successorHidden: allSuccessors.length - successors.length, reduced };
}
export default { PAGE_SIZE, isInside, matchesPerson, project, readiness, stableGoals };
