/** Returns area paths from most specific to the vault root area. */
export function areaAncestors(area) {
  const parts = String(area ?? "").split("/").filter(Boolean);
  return parts.map((_, index) => parts.slice(0, parts.length - index).join("/"));
}

// The Resources parser that used to live here is `parseAreaResources` in
// area-resources.mjs, the one reader for every Area folder lookup.
