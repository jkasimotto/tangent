import { mapWithConcurrency } from "./bounded-work.mjs";
import areaMapCore from "./public/area-map-core.js";
import goToCore from "./public/go-to-core.js";

const MAX_RESULT_ROWS = 100;
const MAX_AREA_FACET_ROWS = 2_000;
const AREA_READ_CONCURRENCY = 24;

/** Parses one Work timestamp without letting an invalid value affect rank. */
function navigationTime(...values) {
  for (const value of values) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/** Returns the responsible Area recorded directly or through one Work owner. */
function agentArea(agent, goalAreas) {
  if (agent.areaId) return agent.areaId;
  if (agent.owner?.kind === "assignment") return goalAreas.get(agent.owner.goalId) ?? "";
  if (["brain", "repair"].includes(agent.owner?.kind)) return agent.owner.id ?? "";
  return "";
}

/** Projects complete retained Work identities into routable navigation rows. */
function workNavigationRows({ index, areas, goals, agents }) {
  const areaRecords = new Map(index.areas.map((area) => [area.path, {
    kind: "area",
    id: area.path,
    area: area.path,
    name: area.name,
    status: area.status,
    docKind: "area",
    changedAt: 0,
  }]));
  for (const area of areas) {
    if (!area?.id) continue;
    const current = areaRecords.get(area.id);
    areaRecords.set(area.id, {
      kind: "area",
      id: area.id,
      area: area.id,
      name: area.label || current?.name || area.id.split("/").at(-1),
      status: area.state || current?.status || "",
      docKind: "area",
      changedAt: 0,
    });
  }

  const goalAreas = new Map(goals.filter((goal) => goal?.id && goal.areaId).map((goal) => [goal.id, goal.areaId]));
  const goalRows = goals.filter((goal) => goal?.id && goal.areaId).map((goal) => ({
    kind: "goal",
    id: goal.id,
    area: goal.areaId,
    name: goal.title || goal.id.split("/").at(-1).replace(/\.md$/i, ""),
    file: goal.id,
    status: goal.lifecycle ?? "",
    docKind: "goal",
    changedAt: navigationTime(goal.startedAt),
  }));
  const agentRows = agents.filter((agent) => agent?.id && ["live", "unknown"].includes(agent.liveness)).map((agent) => {
    const area = agentArea(agent, goalAreas);
    const title = String(agent.workTitle ?? "").trim();
    return {
      kind: "agent",
      id: agent.id,
      area,
      name: title ? `${title} · ${agent.id}` : agent.id,
      session: agent.id,
      goalId: agent.owner?.kind === "assignment" ? agent.owner.goalId : null,
      target: agent.target ?? agent.id,
      role: agent.role ?? "",
      status: agent.liveness === "live" ? agent.activity ?? "live" : agent.liveness ?? "unknown",
      docKind: "agent",
      live: agent.liveness === "live",
      changedAt: navigationTime(agent.activitySince, agent.observedAt, agent.createdAt),
    };
  });
  return { areas: [...areaRecords.values()], goals: goalRows, agents: agentRows };
}

/** Builds the complete lightweight corpus used by deliberate navigation searches. */
export async function buildNavigationIndex({ areaIds, readAreaDocuments, readAreaNote = async () => "" }) {
  const entries = await mapWithConcurrency(areaIds, AREA_READ_CONCURRENCY, async (area) => {
    const [documents, noteText] = await Promise.all([readAreaDocuments(area), readAreaNote(area)]);
    const name = area.split("/").at(-1);
    const note = noteText ? {
      kind: "note",
      id: `${area}/${name}.md`,
      area,
      name: String(noteText).match(/^# (.+)$/m)?.[1]?.trim() ?? name,
      file: `${area}/${name}.md`,
      status: String(noteText).match(/^status:\s*(.*)$/m)?.[1]?.trim() ?? "",
      docKind: "note",
    } : null;
    return { area, name, note, documents };
  });
  return navigationIndexFromRecords({
    areaIds,
    documents: entries.flatMap((entry) => entry.documents),
    notes: entries.flatMap((entry) => entry.note ? [entry.note] : []),
  });
}

/** Projects one already-read navigation corpus without more filesystem work. */
export function navigationIndexFromRecords({ areaIds, documents, notes = [] }) {
  areaMapCore.assignKinds(documents);
  const kinds = areaMapCore.orderKinds(new Set(documents.map((document) => document.docKind ?? "page")));
  const notesByArea = new Map(notes.map((note) => [note.area, note]));
  return {
    areas: areaIds.slice(0, MAX_AREA_FACET_ROWS).map((area) => ({ path: area, name: area.split("/").at(-1), status: notesByArea.get(area)?.status ?? "" })),
    areasComplete: areaIds.length <= MAX_AREA_FACET_ROWS,
    notes,
    documents,
    kinds,
  };
}

/** Returns one bounded result from a complete lightweight navigation corpus. */
export function queryNavigationIndex({ index, query, requestedLimit, brains = [], areas = [], goals = [], agents = [] }) {
  const limit = Math.min(MAX_RESULT_ROWS, Math.max(1, Number(requestedLimit) || MAX_RESULT_ROWS));
  const work = workNavigationRows({ index, areas, goals, agents });
  const rows = [
    ...work.areas,
    ...index.notes,
    ...index.documents.map((document) => ({
      kind: "document",
      id: document.file,
      area: document.area,
      name: document.title,
      file: document.file,
      docKind: document.docKind ?? "page",
      changedAt: document.changedAt ?? document.mtime ?? 0,
      links: document.links ?? [],
    })),
    ...work.goals,
    ...brains.map((brain) => ({
      kind: "brain",
      id: brain.areaId,
      area: brain.areaId,
      name: `${brain.areaId.split("/").at(-1)} brain`,
      live: Boolean(brain.agentId),
      session: brain.agentId,
      changedAt: Date.parse(brain.updatedAt) || 0,
    })),
    ...work.agents,
  ];
  const searchable = rows.map((row) => ({
    ...row,
    kindLabel: row.kind === "area" ? "Area"
      : row.kind === "brain" ? "Brain"
        : row.kind === "agent" ? "Agent"
          : row.kind === "note" ? "Area note"
            : areaMapCore.kindLabel(row.docKind ?? "page"),
  }));
  const matched = goToCore.matchRows(searchable, query, searchable.length);
  const normalizedQuery = goToCore.normalizedSearchText(query).replaceAll(" ", "");
  matched.sort((left, right) => {
    if (!normalizedQuery) return 0;
    const leftSlug = goToCore.fileSlug(left.file).replaceAll(" ", "");
    const rightSlug = goToCore.fileSlug(right.file).replaceAll(" ", "");
    return Number(rightSlug.startsWith(normalizedQuery)) - Number(leftSlug.startsWith(normalizedQuery));
  });
  return {
    schema: "agent-shell-navigation.v1",
    query: String(query ?? ""),
    limit,
    rows: matched.slice(0, limit).map(({ kindLabel: _kindLabel, ...row }) => row),
    areas: index.areas,
    areasComplete: index.areasComplete,
    kinds: [
      ...(work.areas.length ? ["area"] : []),
      ...(work.goals.length ? ["goal"] : []),
      ...index.kinds,
      ...(brains.length ? ["brain"] : []),
      ...(work.agents.length ? ["agent"] : []),
    ].filter((kind, position, all) => all.indexOf(kind) === position),
  };
}

/** Builds and searches one complete navigation corpus. */
export async function buildNavigationSearch(options) {
  const index = await buildNavigationIndex(options);
  return queryNavigationIndex({
    index,
    query: options.query,
    requestedLimit: options.requestedLimit,
    brains: options.brains,
    areas: options.areas,
    goals: options.goals,
    agents: options.agents,
  });
}
