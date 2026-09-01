import { mapWithConcurrency } from "./bounded-work.mjs";
import areaMapCore from "./public/area-map-core.js";
import goToCore from "./public/go-to-core.js";

const MAX_RESULT_ROWS = 100;
const MAX_AREA_FACET_ROWS = 2_000;
const AREA_READ_CONCURRENCY = 24;

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
export function queryNavigationIndex({ index, query, requestedLimit, brains = [] }) {
  const limit = Math.min(MAX_RESULT_ROWS, Math.max(1, Number(requestedLimit) || MAX_RESULT_ROWS));
  const rows = [
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
    ...brains.map((brain) => ({
      kind: "brain",
      id: brain.areaId,
      area: brain.areaId,
      name: `${brain.areaId.split("/").at(-1)} brain`,
      live: Boolean(brain.agentId),
      session: brain.agentId,
      changedAt: Date.parse(brain.updatedAt) || 0,
    })),
  ];
  const searchable = rows.map((row) => ({
    ...row,
    kindLabel: row.kind === "brain" ? "Brain" : row.kind === "note" ? "Area note" : areaMapCore.kindLabel(row.docKind ?? "page"),
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
    kinds: index.kinds,
  };
}

/** Builds and searches one complete navigation corpus. */
export async function buildNavigationSearch(options) {
  const index = await buildNavigationIndex(options);
  return queryNavigationIndex({ index, query: options.query, requestedLimit: options.requestedLimit, brains: options.brains });
}
