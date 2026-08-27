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
  for (const record of vault.documents ?? []) {
    if (record.kind !== "document" && !(record.kind === "note" && !record.missing)) continue;
    rows.push({ key: record.file, kind: record.kind, kindLabel: record.kind === "note" ? "Area note" : areaMapCore.kindLabel(record.docKind ?? "page"), docKind: record.docKind ?? record.kind, name: record.title, area: record.area, areaLabel: areaLabel(record.area), detail: "", changedAt: Number(record.changedAt ?? record.mtime ?? 0), live: false, file: record.file, links: record.links ?? [] });
  }
  for (const brain of brains) {
    const label = brainStateLabel(brain).replace(/^Brain /, "");
    const stateWord = label.charAt(0).toLowerCase() + label.slice(1);
    rows.push({ key: `brain:${brain.area}`, kind: "brain", kindLabel: "Brain", name: areaLabel(brain.area), area: brain.area, areaLabel: areaLabel(brain.area), detail: stateWord, changedAt: Date.parse(brain.updatedAt) || 0, live: Boolean(brain.live), session: brain.session });
  }
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
