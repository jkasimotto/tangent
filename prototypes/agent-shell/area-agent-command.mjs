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

/**
 * Resolves the launch command declared by the nearest area. Descendants
 * inherit their ancestors' command; a more specific declaration wins.
 */
export async function inheritedAgentCommand(area, readAreaNote) {
  for (const candidate of areaAncestors(area)) {
    const command = noteResource(await readAreaNote(candidate), "Agent");
    if (command) return command;
  }
  return String(area ?? "").split("/")[0] === "otto" ? "claude-otto" : "claude";
}
