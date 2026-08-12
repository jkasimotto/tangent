/** Returns node paths from most specific to the vault root node. */
export function nodeAncestors(node) {
  const parts = String(node ?? "").split("/").filter(Boolean);
  return parts.map((_, index) => parts.slice(0, parts.length - index).join("/"));
}

/** Reads one labelled line from a node note's Resources section. */
export function noteResource(note, label) {
  const resources = String(note ?? "").split(/^## /m).find((section) => section.startsWith("Resources"));
  const match = resources?.match(new RegExp(`(?:${label})[^:\\n]*:\\s*\`?([^\`\\n]+?)\`?\\s*$`, "im"));
  return match?.[1].trim() || null;
}

/**
 * Resolves the launch command declared by the nearest node. Descendants
 * inherit their ancestors' command; a more specific declaration wins.
 */
export async function inheritedAgentCommand(node, readNodeNote) {
  for (const candidate of nodeAncestors(node)) {
    const command = noteResource(await readNodeNote(candidate), "Agent");
    if (command) return command;
  }
  return String(node ?? "").split("/")[0] === "otto" ? "claude-otto" : "claude";
}
