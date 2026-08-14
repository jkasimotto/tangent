import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveGitRoot } from "@tangent/repo/git";

import { bindingFromAgentPreset } from "./program.js";
import type { ReviewedAgentBinding, ReviewedGoalSummary, ReviewedSourceDocument } from "./types.js";

export type ReviewedGoalContext = {
  goal: ReviewedGoalSummary;
  goalText: string;
  contextText: string;
  repository: string;
  sources: ReviewedSourceDocument[];
  presets: ReviewedAgentBinding[];
};

/** Lists Goal files from the private Tangent tree. */
export async function listReviewedGoals(treesRoot: string): Promise<ReviewedGoalSummary[]> {
  const goals: ReviewedGoalSummary[] = [];
  for (const file of await markdownFiles(treesRoot)) {
    const relative = slash(path.relative(treesRoot, file));
    if (relative === "README.md") continue;
    let text = "";
    try { text = await readFile(file, "utf8"); } catch { continue; }
    const frontmatter = parseFrontmatter(text);
    if (frontmatter.type !== "goal") continue;
    const areaPath = slash(path.dirname(relative)) === "." ? "" : slash(path.dirname(relative));
    const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(file, ".md");
    const repository = await resolveAreaRepository(treesRoot, areaPath).catch(() => undefined);
    goals.push({
      path: relative,
      areaPath,
      title,
      status: frontmatter.status || "open",
      doneWhen: frontmatter.done_when,
      repository
    });
  }
  return goals.sort((left, right) => left.areaPath.localeCompare(right.areaPath) || left.title.localeCompare(right.title));
}

/** Loads one Goal, its Area notes, linked Documents, repository, and agent presets. */
export async function loadReviewedGoalContext(args: {
  treesRoot: string;
  goalPath: string;
  fallbackRepository?: string;
}): Promise<ReviewedGoalContext> {
  const relative = cleanVaultPath(args.goalPath);
  const absolute = path.resolve(args.treesRoot, relative);
  if (!inside(args.treesRoot, absolute)) throw new Error("Goal path escapes the Tangent tree.");
  const goalText = await readFile(absolute, "utf8");
  const frontmatter = parseFrontmatter(goalText);
  if (frontmatter.type !== "goal") throw new Error(`${relative} is not a Goal.`);
  const areaPath = slash(path.dirname(relative)) === "." ? "" : slash(path.dirname(relative));
  const areaNotes = await loadAreaNotes(args.treesRoot, areaPath);
  const linkedDocuments = await loadLinkedDocuments(args.treesRoot, areaPath, [goalText, ...areaNotes.map((item) => item.text)]);
  const sources = [
    { path: relative, text: goalText },
    ...areaNotes,
    ...linkedDocuments
  ];
  const contextText = sources
    .map((source) => `\n--- SOURCE: ${source.path} ---\n${source.text.trim()}\n`)
    .join("");
  const resourceRepository = await resolveAreaRepository(args.treesRoot, areaPath).catch(() => undefined);
  const candidate = resourceRepository || args.fallbackRepository;
  if (!candidate) throw new Error(`No repository is declared for ${areaPath || "this Goal"}.`);
  const repository = await resolveGitRoot(candidate);
  const presets = agentPresets([...areaNotes].reverse().map((item) => item.text));
  return {
    goal: {
      path: relative,
      areaPath,
      title: goalText.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(relative, ".md"),
      status: frontmatter.status || "open",
      doneWhen: frontmatter.done_when,
      repository
    },
    goalText,
    contextText,
    repository,
    sources: sources.map((source) => ({ path: source.path, hash: hashText(source.text) })),
    presets
  };
}

/** Loads inherited agent presets for one Area from farthest to nearest. */
export async function loadReviewedAreaPresets(treesRoot: string, areaPath: string): Promise<ReviewedAgentBinding[]> {
  const notes = await loadAreaNotes(treesRoot, areaPath);
  return agentPresets([...notes].reverse().map((item) => item.text));
}

/** Finds the nearest Repository or Worktree resource for one Area. */
export async function resolveAreaRepository(treesRoot: string, areaPath: string): Promise<string | undefined> {
  for (const area of areaChain(areaPath)) {
    const note = await areaNote(treesRoot, area);
    if (!note) continue;
    const match = note.text.match(/^\s*-\s*(?:Repository|Worktree):\s*(.+?)\s*$/mi);
    if (!match) continue;
    const expanded = match[1].replace(/^~(?=\/|$)/, os.homedir());
    const resolved = await realpath(expanded).catch(() => path.resolve(expanded));
    if ((await stat(resolved).catch(() => undefined))?.isDirectory()) return resolved;
  }
  return undefined;
}

/** Loads Area notes from nearest to farthest. */
async function loadAreaNotes(treesRoot: string, areaPath: string): Promise<Array<{ path: string; text: string }>> {
  const notes: Array<{ path: string; text: string }> = [];
  for (const area of areaChain(areaPath)) {
    const note = await areaNote(treesRoot, area);
    if (note) notes.push(note);
  }
  return notes;
}

/** Loads one conventional Area note. */
async function areaNote(treesRoot: string, area: string): Promise<{ path: string; text: string } | undefined> {
  if (!area) return undefined;
  const relative = `${area}/${path.posix.basename(area)}.md`;
  try { return { path: relative, text: await readFile(path.join(treesRoot, relative), "utf8") }; } catch { return undefined; }
}

/** Resolves direct wiki links to Documents without recursively expanding them. */
async function loadLinkedDocuments(treesRoot: string, areaPath: string, sourceTexts: string[]): Promise<Array<{ path: string; text: string }>> {
  const names = new Set<string>();
  for (const text of sourceTexts) {
    for (const match of text.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
      const name = match[1].trim();
      if (/^(?:design-|doc-)/.test(path.posix.basename(name))) names.add(name);
    }
  }
  const documents: Array<{ path: string; text: string }> = [];
  for (const name of names) {
    const relative = await resolveWikiFile(treesRoot, areaPath, name);
    if (!relative) continue;
    try { documents.push({ path: relative, text: await readFile(path.join(treesRoot, relative), "utf8") }); } catch { /* Link disappeared. */ }
  }
  return documents;
}

/** Finds a wiki-linked Markdown file in the nearest Area first. */
async function resolveWikiFile(treesRoot: string, areaPath: string, name: string): Promise<string | undefined> {
  const withExtension = name.endsWith(".md") ? name : `${name}.md`;
  if (name.includes("/")) {
    const direct = cleanVaultPath(withExtension);
    if ((await stat(path.join(treesRoot, direct)).catch(() => undefined))?.isFile()) return direct;
  }
  for (const area of areaChain(areaPath)) {
    const candidate = area ? `${area}/${path.posix.basename(withExtension)}` : path.posix.basename(withExtension);
    if ((await stat(path.join(treesRoot, candidate)).catch(() => undefined))?.isFile()) return candidate;
  }
  return undefined;
}

/** Parses and merges tangent.environment.v1 agent presets from farthest to nearest. */
function agentPresets(areaTextsFarthestFirst: string[]): ReviewedAgentBinding[] {
  const byId = new Map<string, ReviewedAgentBinding>();
  for (const text of areaTextsFarthestFirst) {
    for (const match of text.matchAll(/```tangent\.environment\.v1\s*\n([\s\S]*?)\n```/g)) {
      let value: unknown;
      try { value = JSON.parse(match[1]); } catch { continue; }
      const agents = value && typeof value === "object" && Array.isArray((value as { agents?: unknown }).agents)
        ? (value as { agents: unknown[] }).agents
        : [];
      for (const raw of agents) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        const binding = bindingFromAgentPreset(raw as Record<string, unknown>);
        if (binding) byId.set(binding.id, binding);
      }
    }
  }
  return [...byId.values()];
}

/** Returns an Area path chain from nearest to farthest. */
function areaChain(areaPath: string): string[] {
  const parts = slash(areaPath).split("/").filter(Boolean);
  const areas: string[] = [];
  for (let size = parts.length; size > 0; size -= 1) areas.push(parts.slice(0, size).join("/"));
  return areas;
}

/** Recursively lists Markdown files without entering hidden folders. */
async function markdownFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "shared") continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
  }
  return files;
}

/** Parses the simple scalar fields used by Goal frontmatter. */
function parseFrontmatter(text: string): Record<string, string> {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([a-z_]+):\s*(.*?)\s*$/);
    if (field) fields[field[1]] = field[2];
  }
  return fields;
}

/** Rejects absolute paths and parent traversal in one vault-relative path. */
function cleanVaultPath(value: string): string {
  const clean = slash(value).replace(/^\.\//, "");
  if (!clean || path.posix.isAbsolute(clean) || clean.split("/").includes("..")) throw new Error(`Invalid Goal path: ${value}`);
  return clean;
}

/** Creates a source content identity. */
function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Converts platform separators to vault separators. */
function slash(value: string): string {
  return value.replaceAll(path.sep, "/");
}

/** Tests whether one resolved path stays below a root. */
function inside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
