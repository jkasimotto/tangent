/**
 * Reconstructs the repo-contributed context a coding agent would see at a chosen cwd, exactly as Claude
 * Code assembles it: the CLAUDE.md chain (root to cwd) with @imports expanded inline, every discoverable
 * skill's frontmatter (bodies only when loaded), and subagent metadata. Pure: it reads through an injected
 * ContextSource so it is testable without git and reused by the server over a variant's frozen worktree.
 */

export type ContextSource = {
  listFiles(): Promise<string[]>;
  read(filePath: string): Promise<string | undefined>;
};

export type AssembledBlockKind = "claude-md" | "import" | "skills-index" | "skill-body" | "subagents-index";
export type AssembledBlock = { kind: AssembledBlockKind; source: string; text: string };
export type SkillEntry = { name: string; description: string; path: string; loaded: boolean };
export type SubagentEntry = { name: string; description: string; path: string };
export type AssembledContext = { blocks: AssembledBlock[]; skills: SkillEntry[]; subagents: SubagentEntry[]; lazyClaudeMd: string[] };
export type ContextManifest = { skills: SkillEntry[]; subagents: SubagentEntry[] };

const MAX_IMPORT_DEPTH = 4;
const CLAUDE_MD_NAMES = ["CLAUDE.md", "CLAUDE.local.md"];

/** Extracts name and description from a leading --- YAML block. Minimal key/value parsing, no YAML dep. */
export function parseFrontmatter(text: string): { name: string; description: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return { name: "", description: "" };
  const out: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { name: out.name || "", description: out.description || "" };
}

/** Repo-relative directory of a path ("" for a root-level file). */
function dirOf(filePath: string): string {
  const parts = filePath.split("/");
  parts.pop();
  return parts.join("/");
}

/** Normalizes a cwd to repo-relative slash form ("" for root). */
function normalizeCwd(cwd: string): string {
  return (cwd || "").split(/[\\/]+/).filter(Boolean).join("/");
}

/** True when dir is cwd or an ancestor directory of cwd (root dir "" is an ancestor of everything). */
function isAncestorOrEqual(dir: string, cwd: string): boolean {
  if (dir === "") return true;
  return dir === cwd || cwd.startsWith(`${dir}/`);
}

/** True when dir is strictly inside the cwd subtree. */
function isBelow(dir: string, cwd: string): boolean {
  if (dir === cwd) return false;
  return cwd === "" ? dir !== "" : dir.startsWith(`${cwd}/`);
}

/**
 * The eager CLAUDE.md chain for a cwd (root to cwd order, CLAUDE.md before CLAUDE.local.md per directory),
 * plus the below-cwd files that would load lazily. Other branches' CLAUDE.md are omitted (never loaded).
 */
export function claudeMdChain(allPaths: string[], cwd: string): { chain: string[]; lazy: string[] } {
  const normalizedCwd = normalizeCwd(cwd);
  const claudeMd = allPaths.filter((p) => CLAUDE_MD_NAMES.includes(p.split("/").pop() || ""));
  const inChain = claudeMd.filter((p) => isAncestorOrEqual(dirOf(p), normalizedCwd));
  const lazy = claudeMd.filter((p) => isBelow(dirOf(p), normalizedCwd)).sort();
  /** Sort key: depth * 2 + 1 for CLAUDE.local.md so local always follows its CLAUDE.md sibling. */
  const rank = (p: string) => dirOf(p).split("/").filter(Boolean).length * 2 + (p.endsWith("CLAUDE.local.md") ? 1 : 0);
  const chain = inChain.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return { chain, lazy };
}

/** Char offsets of @import tokens outside inline backticks and fenced code blocks. */
// Only ``` fenced blocks and inline backticks are masked; ~~~ fences and 4-space indented code are not, an accepted simplification.
export function findImportTokens(text: string): { raw: string; start: number; end: number }[] {
  const tokens: { raw: string; start: number; end: number }[] = [];
  let offset = 0;
  let fenced = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```")) { fenced = !fenced; offset += line.length + 1; continue; }
    if (!fenced) {
      // Mask inline code spans so @ inside backticks is ignored.
      const masked = line.replace(/`[^`]*`/g, (span) => " ".repeat(span.length));
      const re = /(^|\s)@([A-Za-z0-9._\-/@]+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(masked)) !== null) {
        const start = offset + m.index + m[1].length;
        // end includes the leading @ character: start lands on @, raw is the path without it.
        tokens.push({ raw: m[2], start, end: start + m[2].length + 1 });
      }
    }
    offset += line.length + 1;
  }
  return tokens;
}

/** Expands @imports in a file into ordered blocks: parent text segments interleaved with imported files. */
export async function expandImports(source: ContextSource, filePath: string, text: string, kind: AssembledBlockKind, depth: number, visited: Set<string>): Promise<AssembledBlock[]> {
  const tokens = findImportTokens(text);
  if (tokens.length === 0) return text.length ? [{ kind, source: filePath, text }] : [];
  const blocks: AssembledBlock[] = [];
  let cursor = 0;
  for (const token of tokens) {
    const segment = text.slice(cursor, token.start);
    if (segment.trim().length) blocks.push({ kind, source: filePath, text: segment });
    cursor = token.end;
    const target = joinPath(dirOf(filePath), token.raw);
    if (depth >= MAX_IMPORT_DEPTH) { blocks.push({ kind: "import", source: target, text: `(@${token.raw}: max import depth)` }); continue; }
    if (visited.has(target)) { blocks.push({ kind: "import", source: target, text: `(@${token.raw}: cycle)` }); continue; }
    const imported = await source.read(target);
    if (imported === undefined) { blocks.push({ kind: "import", source: target, text: `not found: ${token.raw}` }); continue; }
    blocks.push(...await expandImports(source, target, imported, "import", depth + 1, new Set([...visited, target])));
  }
  const tail = text.slice(cursor);
  if (tail.trim().length) blocks.push({ kind, source: filePath, text: tail });
  return blocks;
}

/** Resolves an import target relative to the importing file's directory, collapsing ./ and ../ segments. */
function joinPath(dir: string, rel: string): string {
  const segments = (dir ? dir.split("/") : []).concat(rel.split("/"));
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") { out.pop(); continue; }
    out.push(segment);
  }
  return out.join("/");
}

/** Skill SKILL.md paths under any .claude/skills/<name>/ directory. */
// Discovery is intentionally repo-wide (all **/.claude/skills), not cwd-scoped, an accepted simplification.
export function discoverSkills(allPaths: string[]): string[] {
  return allPaths.filter((p) => /(^|\/)\.claude\/skills\/[^/]+\/SKILL\.md$/.test(p)).sort();
}

/** Subagent .md paths directly under any .claude/agents/ directory. */
export function discoverSubagents(allPaths: string[]): string[] {
  return allPaths.filter((p) => /(^|\/)\.claude\/agents\/[^/]+\.md$/.test(p)).sort();
}

/** Trailing name segment for a skill or subagent path, used when frontmatter omits name. */
function nameFromPath(filePath: string, kind: "skill" | "subagent"): string {
  const parts = filePath.split("/");
  return kind === "skill" ? parts[parts.length - 2] : (parts[parts.length - 1] || "").replace(/\.md$/, "");
}

/** Reads skills and subagents metadata (frontmatter only). The loaded flag is always false here. */
export async function contextManifest(source: ContextSource): Promise<ContextManifest> {
  const all = await source.listFiles();
  const skills: SkillEntry[] = [];
  for (const path of discoverSkills(all)) {
    const fm = parseFrontmatter(await source.read(path) ?? "");
    skills.push({ name: fm.name || nameFromPath(path, "skill"), description: fm.description, path, loaded: false });
  }
  const subagents: SubagentEntry[] = [];
  for (const path of discoverSubagents(all)) {
    const fm = parseFrontmatter(await source.read(path) ?? "");
    subagents.push({ name: fm.name || nameFromPath(path, "subagent"), description: fm.description, path });
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  subagents.sort((a, b) => a.name.localeCompare(b.name));
  return { skills, subagents };
}

/** Renders the always-loaded frontmatter index as one block of "name: description" lines. */
function renderIndex(entries: { name: string; description: string }[]): string {
  return entries.map((entry) => `${entry.name}: ${entry.description}`).join("\n");
}

/** Assembles the full repo-contributed context for a cwd and loaded-skill set. */
export async function assembleContext(source: ContextSource, cwd: string, loadedSkills: string[]): Promise<AssembledContext> {
  const all = await source.listFiles();
  const { chain, lazy } = claudeMdChain(all, cwd);
  const blocks: AssembledBlock[] = [];
  for (const path of chain) {
    const text = await source.read(path);
    if (text === undefined) continue;
    blocks.push(...await expandImports(source, path, text, "claude-md", 1, new Set([path])));
  }
  const { skills, subagents } = await contextManifest(source);
  const withLoaded = skills.map((skill) => ({ ...skill, loaded: loadedSkills.includes(skill.name) }));
  if (withLoaded.length) blocks.push({ kind: "skills-index", source: "skills", text: renderIndex(withLoaded) });
  for (const skill of withLoaded.filter((skill) => skill.loaded)) {
    blocks.push({ kind: "skill-body", source: skill.path, text: await source.read(skill.path) ?? "" });
  }
  if (subagents.length) blocks.push({ kind: "subagents-index", source: "subagents", text: renderIndex(subagents) });
  return { blocks, skills: withLoaded, subagents, lazyClaudeMd: lazy };
}
