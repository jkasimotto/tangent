import areaMapCore from "./area-map-core.js";
import goToCore from "./go-to-core.js";

const GO_TO_LIMIT = 12;

/** The visible identity shared by finder rows that need a file-name fallback. */
function visibleIdentity(row) {
  return [row.kindLabel, row.name, row.area].map((value) => goToCore.normalizedSearchText(value)).join("\n");
}

/** The vault file name that distinguishes two otherwise identical rows. */
function fileName(file) {
  return String(file ?? "").split("/").at(-1) ?? "";
}

/** Builds finder rows without coupling matching and projection to the shell controller. */
export function buildGoToRows({ vault, brains = [], query = "", area = "", kind = "", view = "list", areaLabel, brainStateLabel }) {
  if (!vault) return null;
  const rows = [];
  // A done or archived Area, and everything under it, leaves Go To unless the
  // search is scoped to it (area-archive Decision 4).
  const hiddenAreas = new Set((vault.areas ?? []).filter((record) => ["done", "archived"].includes(record.status)).map((record) => record.path));
  /** True when the Area or one of its ancestors is done or archived, and the search does not start inside it. */
  const folded = (path) => !(area && (path === area || path.startsWith(`${area}/`))) &&
    String(path ?? "").split("/").some((_part, index, parts) => hiddenAreas.has(parts.slice(0, index + 1).join("/")));
  for (const record of vault.documents ?? []) {
    if (record.kind !== "document" && !(record.kind === "note" && !record.missing)) continue;
    if (folded(record.area)) continue;
    rows.push({ key: record.file, kind: record.kind, kindLabel: record.kind === "note" ? "Area note" : areaMapCore.kindLabel(record.docKind ?? "page"), docKind: record.docKind ?? record.kind, name: record.title, area: record.area, areaLabel: areaLabel(record.area), detail: "", changedAt: Number(record.changedAt ?? record.mtime ?? 0), live: false, file: record.file, links: record.links ?? [] });
  }
  // A brain is a destination for every Area, even before its first attempt.
  // Merge runtime records into the Area list so stopped records and duplicate
  // projections cannot hide or multiply that destination.
  const brainsByArea = new Map();
  for (const brain of brains) {
    if (!brain?.area) continue;
    const current = brainsByArea.get(brain.area);
    const currentTime = Date.parse(current?.updatedAt) || 0;
    const candidateTime = Date.parse(brain.updatedAt) || 0;
    if (!current || (!current.live && brain.live) || (Boolean(current.live) === Boolean(brain.live) && candidateTime > currentTime)) {
      brainsByArea.set(brain.area, brain);
    }
  }
  const brainAreas = new Set();
  /** Appends one virtual or recorded Area brain row to the finder. */
  const appendBrain = (brainArea, brain = null) => {
    if (!brainArea || brainAreas.has(brainArea)) return;
    brainAreas.add(brainArea);
    const label = brain ? brainStateLabel(brain).replace(/^Brain /, "") : "Start brain";
    const stateWord = label.charAt(0).toLowerCase() + label.slice(1);
    rows.push({
      key: `brain:${brainArea}`,
      kind: "brain",
      kindLabel: "Brain",
      docKind: "brain",
      name: areaLabel(brainArea),
      area: brainArea,
      areaLabel: areaLabel(brainArea),
      detail: stateWord,
      changedAt: brain ? Date.parse(brain.updatedAt) || 0 : 0,
      live: Boolean(brain?.live),
      session: brain?.session,
    });
  };
  for (const record of vault.areas ?? []) if (!folded(record.path)) appendBrain(record.path, brainsByArea.get(record.path));
  // Keep an indexed brain reachable while its Area projection catches up.
  for (const brain of brainsByArea.values()) if (brain.live || !folded(brain.area)) appendBrain(brain.area, brain);
  const scoped = rows.filter((row) => (!area || row.area === area || row.area.startsWith(`${area}/`)) && (!kind || row.docKind === kind));
  const visible = goToCore.matchRows(scoped, query, view === "graph" ? 60 : GO_TO_LIMIT);
  const identityCounts = new Map();
  for (const row of visible) {
    const identity = visibleIdentity(row);
    identityCounts.set(identity, (identityCounts.get(identity) ?? 0) + 1);
  }
  return visible.map((row) => identityCounts.get(visibleIdentity(row)) > 1 && row.file
    ? { ...row, detail: `${row.areaLabel} · ${fileName(row.file)}`, disambiguator: fileName(row.file) }
    : row);
}
