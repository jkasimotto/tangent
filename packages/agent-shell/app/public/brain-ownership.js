/** The exact Area brain whose session is active in this browser snapshot. */
export function activeBrainForArea(brains, area) {
  return (brains ?? []).find((item) => item.area === String(area ?? "") && item.status === "active" && item.live) ?? null;
}

/**
 * The nearest active brain up the Area chain of one path: the Area's own
 * brain first, then each parent's. A Goal row's `b` opens this brain so a
 * sub-Area without its own brain still reaches the one that organises it.
 * Returns null when no ancestor has an active brain.
 */
export function nearestActiveBrain(brains, area) {
  const segments = String(area ?? "").split("/").filter(Boolean);
  for (let depth = segments.length; depth > 0; depth -= 1) {
    const brain = activeBrainForArea(brains, segments.slice(0, depth).join("/"));
    if (brain) return brain;
  }
  return null;
}
