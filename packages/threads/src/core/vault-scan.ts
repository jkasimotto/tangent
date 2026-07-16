import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseOverviewOnMe } from "./overview-parser.js";
import { parseThreadFile } from "./thread-parser.js";
import type { OverviewItem, ParsedThread, VaultScan } from "./types.js";
import { walkFiles } from "./walk.js";

const threadFilePattern = /(^|\/)thread-[^/]+\.md$/;
const overviewFilePattern = /(^|\/)overview\.md$/;
const notePattern = /^(\d{4}-\d{2}-\d{2})-.*\.md$/;

/** Matches any markdown file, for the vault-wide walk (thread files, overview files, and dated notes are all filtered from this one list afterward). */
const isMarkdownFile = (fileName: string): boolean => fileName.endsWith(".md");

/**
 * Walks the vault once, collecting thread files, overview "## On me" backlog items, and per-node
 * note recency, skipping any `shared/` subtree (team-facing git repos, not private thread state; the
 * same exemption the vault's own lint applies). Throws if the vault root cannot be read, which the
 * sweep treats as a scan failure: nothing downstream is written.
 */
export async function scanVault(root: string): Promise<VaultScan> {
  const files = await walkFiles(root, isMarkdownFile);
  const threadFiles = files.filter((file) => threadFilePattern.test(file));
  const overviewFiles = files.filter((file) => overviewFilePattern.test(file));

  const threads: ParsedThread[] = [];
  for (const file of threadFiles) {
    const content = await readFile(path.join(root, file), "utf8");
    threads.push(parseThreadFile(file, content));
  }

  const threadSlugsByNode = new Map<string, Set<string>>();
  for (const thread of threads) {
    const set = threadSlugsByNode.get(thread.node) || new Set<string>();
    set.add(thread.slug);
    threadSlugsByNode.set(thread.node, set);
  }

  const overviewItems: OverviewItem[] = [];
  for (const file of overviewFiles) {
    const dir = path.dirname(file);
    const node = dir === "." ? "" : dir;
    const content = await readFile(path.join(root, file), "utf8");
    overviewItems.push(...parseOverviewOnMe(node, content, threadSlugsByNode));
  }

  const noteRecencyByNode = new Map<string, string>();
  for (const file of files) {
    const match = path.basename(file).match(notePattern);
    if (!match) continue;
    const dir = path.dirname(file);
    const node = dir === "." ? "" : dir;
    const date = match[1]!;
    const current = noteRecencyByNode.get(node);
    if (!current || date > current) noteRecencyByNode.set(node, date);
  }

  return { threads, overviewItems, noteRecencyByNode };
}
