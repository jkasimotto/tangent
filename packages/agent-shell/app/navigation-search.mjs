const MAX_RESULT_ROWS = 100;
const MAX_AREA_FACET_ROWS = 2_000;

/**
 * Builds one bounded mixed navigation result and an independent Area facet.
 * The facet is built before material rows consume the mixed result limit.
 */
export async function buildNavigationSearch({ query, requestedLimit, areaIds, readAreaGoals, readAreaDocuments, brains = [] }) {
  const limit = Math.min(MAX_RESULT_ROWS, Math.max(1, Number(requestedLimit) || MAX_RESULT_ROWS));
  const needle = String(query ?? "").trim().toLocaleLowerCase();
  const facetIds = areaIds.slice(0, MAX_AREA_FACET_ROWS);
  const areas = facetIds.map((area) => ({ path: area, name: area.split("/").at(-1) }));
  const rows = [];
  /** Returns whether one bounded navigation row matches the query. */
  const matches = (...values) => !needle || values.some((value) => String(value ?? "").toLocaleLowerCase().includes(needle));
  for (const area of areaIds) {
    if (rows.length >= limit) break;
    if (matches(area, area.split("/").at(-1))) rows.push({ kind: "area", id: area, area, name: area.split("/").at(-1), file: `${area}/${area.split("/").at(-1)}.md` });
    const [goals, documents] = await Promise.all([readAreaGoals(area), readAreaDocuments(area)]);
    for (const goal of goals) {
      if (rows.length >= limit) break;
      if (matches(goal.title, goal.file, goal.slug)) rows.push({ kind: "goal", id: goal.file, area, name: goal.title, file: goal.file, status: goal.status });
    }
    for (const document of documents) {
      if (rows.length >= limit) break;
      if (matches(document.title, document.file)) rows.push({ kind: "document", id: document.file, area, name: document.title, file: document.file, docKind: document.docKind ?? "page" });
    }
  }
  for (const brain of brains) {
    if (rows.length >= limit) break;
    if (matches(brain.areaId)) rows.push({ kind: "brain", id: brain.areaId, area: brain.areaId, name: `${brain.areaId.split("/").at(-1)} brain`, live: Boolean(brain.agentId), session: brain.agentId });
  }
  return {
    schema: "agent-shell-navigation.v1",
    query: String(query ?? ""),
    limit,
    rows,
    areas,
    areasComplete: areaIds.length <= MAX_AREA_FACET_ROWS,
  };
}
