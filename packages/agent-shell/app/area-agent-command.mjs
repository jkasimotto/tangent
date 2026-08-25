/** Returns area paths from most specific to the vault root area. */
export function areaAncestors(area) {
  const parts = String(area ?? "").split("/").filter(Boolean);
  return parts.map((_, index) => parts.slice(0, parts.length - index).join("/"));
}

/** Reads one labelled line from an Area note's Resources section. */
export function noteResource(note, label) {
  const resources = String(note ?? "").split(/^## /m).find((section) => section.startsWith("Resources"));
  const match = resources?.match(new RegExp(`(?:${label})[^:\\n]*:\\s*\`?([^\`\\n]+?)\`?\\s*$`, "im"));
  return match?.[1].trim() || null;
}
