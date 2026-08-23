import { cleanText, clip } from "./text-format.js";

/** Returns the compact fact that restores one selected Goal. */
export function currentBriefFields(goal) {
  let wanted = goal.doneWhen || "No clear result is recorded yet.";
  for (const line of String(goal.currentBrief ?? "").split("\n")) {
    const item = line.match(/^\s*[-*]?\s*You wanted\s*:\s*(.+)$/i);
    if (item) wanted = cleanText(item[1]);
  }
  return { wanted };
}

/** Parses the short story section into ordered moments. */
export function storyEntries(text) {
  const source = String(text ?? "").trim();
  if (!source) return [];
  const matches = [...source.matchAll(/^###\s+(.+)\n+([\s\S]*?)(?=^###\s+|$)/gm)];
  if (!matches.length) return [{ title: "Latest", body: clip(source, 320) }];
  return matches.slice(-5).map((match) => ({ title: cleanText(match[1]), body: clip(match[2], 320) }));
}
