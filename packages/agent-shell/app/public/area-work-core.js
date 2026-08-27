// The Area Work graph's pure projection (design contract:
// otto/tangent/design-a-better-view-over-my-work-past-and-present).
const PAGE_SIZE = 12;
const CLOSED = new Set(["done", "dropped", "parked", "deferred"]);
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
/** Returns the files that participate in a dependency cycle. */
function cycleFiles(goals) {
  const files = new Set(goals.map((goal) => goal.file));
  const edges = new Map(goals.map((goal) => [goal.file, (goal.dependsOn ?? []).map((item) => item.file).filter((file) => files.has(file))]));
  const visiting = [];
  const active = new Set();
  const visited = new Set();
  const cyclic = new Set();
  /** Visits one dependency path and records its repeated active section. */
  const visit = (file) => {
    if (active.has(file)) {
      const start = visiting.indexOf(file);
      for (const item of visiting.slice(start)) cyclic.add(item);
      return;
    }
    if (visited.has(file)) return;
    active.add(file);
    visiting.push(file);
    for (const next of edges.get(file) ?? []) visit(next);
    visiting.pop();
    active.delete(file);
    visited.add(file);
  };
  for (const file of edges.keys()) visit(file);
  return cyclic;
}
/** Projects a bounded ready-first graph for one selected Area. */
function project({ scope, goals, areaPaths, filters = {}, limits = {} }) {
  const open = goals.filter((goal) => isInside(goal.area, scope) && !CLOSED.has(goal.status));
  const byFile = new Map(goals.map((goal) => [goal.file, goal]));
  const facts = new Map(goals.map((goal) => [goal.file, readiness(goal, byFile)]));
  for (const file of cycleFiles(goals)) facts.set(file, { kind: "error", blockers: ["dependency cycle"] });
  const query = String(filters.query ?? "").trim().toLowerCase();
  const targetScope = filters.scope || scope;
  const reduced = (filters.state && filters.state !== "all") || query || targetScope !== scope;
  const matches = stableGoals(open.filter((goal) => isInside(goal.area, targetScope))
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
  /** Assigns a Goal to the selected Area or one direct child Area. */
  const lane = (goal) => {
    const child = areaPaths.find((path) => path.startsWith(`${scope}/`) && path.split("/").length === depth && isInside(goal.area, path));
    return child ?? scope;
  };
  const boundaryEdges = [];
  const seenBoundary = new Set();
  for (const goal of open) for (const prerequisite of goal.dependsOn ?? []) {
    const source = byFile.get(prerequisite.file);
    if (!source || !isInside(source.area, scope) || lane(source) === lane(goal)) continue;
    const key = `${source.file}->${goal.file}`;
    if (seenBoundary.has(key)) continue;
    seenBoundary.add(key);
    boundaryEdges.push({ from: source, to: goal, fromLane: lane(source), toLane: lane(goal) });
  }
  const portals = areaPaths.filter((path) => path.startsWith(`${scope}/`) && path.split("/").length === depth).sort().map((path) => {
    const childGoals = open.filter((goal) => isInside(goal.area, path));
    const ready = stableGoals(childGoals.filter((goal) => facts.get(goal.file).kind === "ready"));
    return { kind: "portal", path, title: path.split("/").pop(), openCount: childGoals.length, readyCount: ready.length, preview: ready[0] ?? null,
      dependencyCount: boundaryEdges.filter((edge) => edge.fromLane === path || edge.toLane === path).length };
  }).filter((portal) => portal.openCount);
  const allFrontier = reduced
    ? [...stableGoals(context.values()), ...matches].map((goal) => ({ kind: goal.neededBy ? "context" : "goal", goal, fact: facts.get(goal.file) ?? readiness(goal, byFile) }))
    : [...directReady.map((goal) => ({ kind: "goal", goal, fact: facts.get(goal.file) })), ...portals];
  const frontier = allFrontier.slice(0, Math.max(PAGE_SIZE, Number(limits.frontier ?? PAGE_SIZE)));
  const readyFiles = new Set(frontier.filter((item) => item.kind === "goal" && item.fact.kind === "ready").map((item) => item.goal.file));
  const successorDepth = Math.max(1, Number(limits.successorDepth ?? 1));
  const successorLayers = [];
  let previous = readyFiles;
  const reached = new Set(readyFiles);
  for (let level = 1; level <= successorDepth + 1 && previous.size; level += 1) {
    const layer = stableGoals(open.filter((goal) => !reached.has(goal.file) && (goal.dependsOn ?? []).some((item) => previous.has(item.file))));
    if (!layer.length) break;
    successorLayers.push(layer);
    previous = new Set(layer.map((goal) => goal.file));
    for (const file of previous) reached.add(file);
  }
  const shownLayers = successorLayers.slice(0, successorDepth);
  const allSuccessors = shownLayers.flat();
  const successorLimit = Math.max(PAGE_SIZE, Number(limits.successors ?? PAGE_SIZE) * successorDepth);
  const successors = allSuccessors.slice(0, successorLimit).map((goal) => ({ kind: "goal", goal, fact: facts.get(goal.file) }));
  const deeperSuccessors = successorLayers.length > successorDepth;
  const boundaryLimit = Math.max(PAGE_SIZE, Number(limits.boundaries ?? PAGE_SIZE));
  const visibleBoundaryEdges = boundaryEdges.slice(0, boundaryLimit);
  const emptyReason = open.length && !open.some((goal) => facts.get(goal.file).kind === "ready")
    ? (open.some((goal) => facts.get(goal.file).kind === "error") ? "No Goal is ready because the dependency graph has an error."
      : open.some((goal) => facts.get(goal.file).kind === "broken") ? "No Goal is ready because a prerequisite will not be done."
      : "No Goal is ready because every Goal has an unfinished prerequisite.") : "";
  return { openCount: open.length, readyCount: open.filter((goal) => facts.get(goal.file).kind === "ready").length, matchCount: matches.length,
    frontier, frontierHidden: allFrontier.length - frontier.length, successors, successorHidden: allSuccessors.length - successors.length,
    deeperSuccessors, successorDepth, boundaryEdges: visibleBoundaryEdges, boundaryHidden: boundaryEdges.length - visibleBoundaryEdges.length, emptyReason, reduced };
}
export default { PAGE_SIZE, cycleFiles, isInside, project, readiness, stableGoals };
