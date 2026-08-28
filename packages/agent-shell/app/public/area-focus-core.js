export const AREA_FOCUS_SCHEMA = "agent-shell.area-focus.v1";
export const AREA_FOCUS_KEY = AREA_FOCUS_SCHEMA;

/** True when one Area path is equal to or below one selected root. */
export function isInsideArea(path, root) {
  return path === root || String(path ?? "").startsWith(`${root}/`);
}

/** Keeps a deterministic set of the smallest non-overlapping Area roots. */
export function normalizeAreaFocus(paths) {
  const roots = [...new Set((paths ?? []).filter((path) => typeof path === "string").map((path) => path.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  return roots.filter((path, index) => !roots.some((root, other) => other !== index && isInsideArea(path, root)));
}

/** True when an Area belongs to the selected scope, or when Work shows all Areas. */
export function isInAreaFocus(path, roots) {
  return !roots?.length || roots.some((root) => isInsideArea(path, root));
}

/** Removes stored roots that no longer exist in the current Area index. */
export function reconcileAreaFocus(paths, validPaths) {
  const valid = new Set(validPaths ?? []);
  return normalizeAreaFocus(paths).filter((path) => valid.has(path));
}

/** Rewrites selected roots when an Area or one of its ancestors moves. */
export function rewriteAreaFocus(paths, source, destination) {
  return normalizeAreaFocus((paths ?? []).map((path) => isInsideArea(path, source)
    ? `${destination}${path.slice(source.length)}`
    : path));
}

/**
 * Stars or unstars one Area root from its row (design area-star-focus,
 * Decision 1). An Area under a starred ancestor is already inside Focus and
 * `normalizeAreaFocus` would drop its star at once, so the toggle refuses it
 * and names the ancestor instead of silently changing the set.
 */
export function toggleAreaFocusRoot(paths, path) {
  const roots = normalizeAreaFocus(paths);
  const target = String(path ?? "").trim();
  if (!target) return { roots, change: "none", ancestor: "" };
  if (roots.includes(target)) return { roots: roots.filter((root) => root !== target), change: "removed", ancestor: "" };
  const ancestor = roots.find((root) => isInsideArea(target, root));
  if (ancestor) return { roots, change: "insideAncestor", ancestor };
  return { roots: normalizeAreaFocus([...roots, target]), change: "added", ancestor: "" };
}

/**
 * Reads one valid Area Focus preference. Unknown or damaged records show all
 * Areas. `only` means Work shows the starred Areas alone; it is meaningless
 * without roots, so an empty scope always reads as `only: false`.
 */
export function readAreaFocus(storage) {
  try {
    const record = JSON.parse(storage?.getItem(AREA_FOCUS_KEY) || "null");
    if (record?.schema !== AREA_FOCUS_SCHEMA || !Array.isArray(record.areas)) return { areas: [], only: false, error: false };
    const areas = normalizeAreaFocus(record.areas);
    return { areas, only: areas.length > 0 && record.only === true, error: false };
  } catch {
    return { areas: [], only: false, error: true };
  }
}

/** Writes one Area Focus preference. An empty scope removes the preference. */
export function writeAreaFocus(storage, paths, only = false) {
  const areas = normalizeAreaFocus(paths);
  try {
    if (areas.length) storage?.setItem(AREA_FOCUS_KEY, JSON.stringify({ schema: AREA_FOCUS_SCHEMA, areas, ...(only ? { only: true } : {}) }));
    else storage?.removeItem(AREA_FOCUS_KEY);
    return true;
  } catch {
    return false;
  }
}
