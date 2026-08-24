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

/** Reads one valid Area Focus preference. Unknown or damaged records show all Areas. */
export function readAreaFocus(storage) {
  try {
    const record = JSON.parse(storage?.getItem(AREA_FOCUS_KEY) || "null");
    if (record?.schema !== AREA_FOCUS_SCHEMA || !Array.isArray(record.areas)) return { areas: [], error: false };
    return { areas: normalizeAreaFocus(record.areas), error: false };
  } catch {
    return { areas: [], error: true };
  }
}

/** Writes one Area Focus preference. An empty scope removes the preference. */
export function writeAreaFocus(storage, paths) {
  const areas = normalizeAreaFocus(paths);
  try {
    if (areas.length) storage?.setItem(AREA_FOCUS_KEY, JSON.stringify({ schema: AREA_FOCUS_SCHEMA, areas }));
    else storage?.removeItem(AREA_FOCUS_KEY);
    return true;
  } catch {
    return false;
  }
}
