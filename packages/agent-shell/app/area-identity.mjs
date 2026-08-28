import path from "node:path";

/** Stable API identity for the virtual Area that maps to the vault root. */
export const ROOT_AREA = "@root";

/** True only for the virtual Root Area identity. */
export function isRootArea(area) {
  return String(area ?? "") === ROOT_AREA;
}

/** Maps an Area API identity to its concrete vault directory. */
export function areaDirectory(treesRoot, area) {
  return isRootArea(area) ? treesRoot : path.join(treesRoot, String(area ?? ""));
}

/** Maps an Area identity to the vault-relative prefix used by Markdown files. */
export function areaFilePrefix(area) {
  return isRootArea(area) ? "" : `${String(area ?? "")}/`;
}

/** The Root row shown before physical top-level Areas. */
export function rootAreaRow(children = []) {
  return {
    path: ROOT_AREA,
    name: "Root",
    parent: null,
    children: [],
    virtual: true,
    status: "",
    type: "area",
    purpose: "The complete Tangent vault.",
    current: "",
    people: "",
    body: "root complete tangent vault",
    note: null,
    noteSignal: null,
    documents: [],
    goals: [],
    topLevelAreas: children,
  };
}
