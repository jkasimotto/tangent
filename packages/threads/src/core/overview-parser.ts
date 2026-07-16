import type { OverviewItem } from "./types.js";

const onMeSection = /^## On me\s*$/im;
const headingBoundary = /^## /m;
const uncheckedItem = /^- \[ \] (.+)$/gm;
const wikiLink = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const emojiDate = /📅\s*(\d{4}-\d{2}-\d{2})/;

/**
 * Extracts unchecked "## On me" commitments from one overview.md, classifying each as owned (linked
 * to, or naming, an existing thread in the same node) or unowned backlog. `threadSlugsByNode` maps
 * each vault node to its known thread slugs so a bare-slug mention (no wiki-link) still counts as
 * owned, per the vault's Obsidian Tasks checkbox convention (`- [ ] thing 📅 2026-07-10`).
 */
export function parseOverviewOnMe(node: string, content: string, threadSlugsByNode: Map<string, Set<string>>): OverviewItem[] {
  const sectionMatch = content.match(onMeSection);
  if (!sectionMatch) return [];
  const rest = content.slice(sectionMatch.index! + sectionMatch[0].length);
  const sectionEnd = rest.search(headingBoundary);
  const section = sectionEnd === -1 ? rest : rest.slice(0, sectionEnd);

  const nodeSlugs = threadSlugsByNode.get(node) || new Set<string>();
  const items: OverviewItem[] = [];
  for (const match of section.matchAll(uncheckedItem)) {
    const text = match[1]!.trim();
    const links = [...text.matchAll(wikiLink)].map((linkMatch) => linkMatch[1]!.trim());
    const ownedSlug = resolveOwnedSlug(text, links, nodeSlugs);
    items.push({
      node,
      text,
      deadline: text.match(emojiDate)?.[1],
      owned: Boolean(ownedSlug),
      ownedSlug
    });
  }
  return items;
}

/** Resolves the thread slug an overview item is owned by: a wiki-link path ending in `thread-<slug>`, or a literal mention of an existing thread's slug in the same node. */
function resolveOwnedSlug(text: string, links: string[], nodeSlugs: Set<string>): string | undefined {
  for (const link of links) {
    const match = link.match(/(?:^|\/)thread-([^/]+)$/);
    if (match && nodeSlugs.has(match[1]!)) return match[1];
  }
  for (const slug of nodeSlugs) {
    if (new RegExp(`\\b${escapeRegExp(slug)}\\b`).test(text)) return slug;
  }
  return undefined;
}

/** Escapes regex metacharacters so a slug can be used literally inside a `\b...\b` pattern. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
