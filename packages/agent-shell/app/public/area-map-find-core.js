import { normalizeSearchText } from "./work-search-core.js";

/** Returns one normalized Area or block name and its separator-free form. */
function searchable(value) {
  const words = normalizeSearchText(value).split(" ").filter(Boolean);
  return { words, joined: words.join("") };
}

/** Reports whether a query starts words, including names typed without separators. */
export function mapFindTextMatches(value, query) {
  const target = searchable(value);
  const needle = searchable(query);
  if (!needle.words.length) return false;
  if (needle.words.every((word) => target.words.some((candidate) => candidate.startsWith(word)))) return true;
  return Boolean(needle.joined) && target.words.some((_word, index) => target.words.slice(index).join("").startsWith(needle.joined));
}

/** Returns every matching Area before matching loaded Tangent blocks. */
export function mapFindMatches({ areas = [], blocks = [] } = {}, query = "") {
  if (!searchable(query).words.length) return [];
  const areaRows = areas
    .filter((area) => mapFindTextMatches(`${area.name ?? ""} ${area.path ?? ""}`, query))
    .map((area) => ({ kind: "area", key: `area:${area.path}`, name: area.name, area: area.path, depth: Number(area.depth ?? String(area.path).split("/").length - 1), hidden: false }))
    .sort((left, right) => left.depth - right.depth || String(left.name).localeCompare(String(right.name)) || left.area.localeCompare(right.area));
  const blockRows = blocks
    .filter((block) => mapFindTextMatches(block.name, query))
    .map((block) => ({ ...block, key: block.key ?? `${block.kind}:${block.elementId}`, depth: Number.MAX_SAFE_INTEGER }))
    .sort((left, right) => String(left.name).localeCompare(String(right.name)) || String(left.area).localeCompare(String(right.area)));
  return [...areaRows, ...blockRows];
}

/** Reports whether an Area is the restriction target, its ancestor, or its descendant. */
export function areaInRestriction(area, target) {
  return Boolean(area && target && (area === target || area.startsWith(`${target}/`) || target.startsWith(`${area}/`)));
}

/**
 * Returns the smallest roots that fold every branch outside one Area's
 * ancestor-and-descendant line. Folding these roots preserves every outline.
 */
export function restrictionFoldRoots(areas = [], target = "") {
  const known = new Set(areas.map((area) => area.path));
  if (!known.has(target)) return [];
  return areas
    .filter((area) => !areaInRestriction(area.path, target))
    .filter((area) => area.parent === "@root" || areaInRestriction(area.parent, target))
    .map((area) => area.path)
    .sort();
}

export default { areaInRestriction, mapFindMatches, mapFindTextMatches, restrictionFoldRoots };
