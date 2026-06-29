# Eval Context Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Assembled" view to the Eval compare screen's Context section that reconstructs the exact repo-contributed context an agent would see at a chosen cwd with a chosen skill set, shown verbatim and side by side for both variants, and make the Context section scrollable.

**Architecture:** A pure assembly engine in `@tangent/eval` core reads a variant's frozen worktree at its context ref through an injected `ContextSource`, resolving the CLAUDE.md chain (root→cwd), expanding `@imports`, and listing skills (frontmatter always, body when loaded) and subagents (metadata only). Two read-only GET endpoints expose it. `@tangent/eval-ui` adds a `Files | Assembled` toggle and a two-column renderer that fetches both variants and diffs them, talking only to `/api/eval/*`.

**Tech Stack:** TypeScript, Node test runner (`node --test`) for `@tangent/eval`, Svelte 5 + Vite + Vitest + @testing-library/svelte for `@tangent/eval-ui`, `@tangent/repo/git` helpers (`showFile`, `fileOidsAtRef`).

## Global Constraints

- `@tangent/eval-ui` must not import `@tangent/eval`; it talks to `/api/eval/*` only. API types are serializable and mirrored locally in `client.ts`.
- Do not duplicate git/worktree/repo helpers; use `@tangent/repo/git` (`showFile`, `fileOidsAtRef`).
- All endpoints are read-only GET; do not add writes. They must work under `TANGENT_VERIFY_READONLY`.
- Reproduce only repo-contributed context. No base system prompt, no `~/.claude` user-global, no plugin skills, no managed policy. Label the view "repo-contributed context."
- CLAUDE.md chain order: root → cwd (root first, cwd last); within a directory, `CLAUDE.md` then `CLAUDE.local.md`. CLAUDE.md below cwd is listed as "loads lazily," never concatenated.
- `@import` expansion: max depth 4, resolve relative to the importing file's directory, skip tokens inside inline backticks and fenced code blocks, guard cycles.
- Skills: every discoverable skill contributes frontmatter always; full body only when that skill name is in the loaded set. Subagents: metadata only, never their body.
- No em dashes in any code comment, commit message, or doc prose.
- Verify any user-visible change in the combined `tangent ui`, not only the per-app package.

## File Structure

- **Create** `packages/eval/src/core/context-assembly.ts`, the pure assembly engine and its types (`ContextSource`, `AssembledBlock`, `SkillEntry`, `SubagentEntry`, `AssembledContext`, `ContextManifest`) and functions (`parseFrontmatter`, `claudeMdChain`, `findImportTokens`, `expandImports`, `discoverSkills`, `discoverSubagents`, `contextManifest`, `assembleContext`).
- **Create** `packages/eval/test/context-assembly.test.mjs`, node --test unit tests over an in-memory `ContextSource`.
- **Modify** `packages/eval/src/server/index.ts`, adding `variantContextSource`, `singleVariant`, `contextManifestView`, `assembleContextView`, two route lines.
- **Modify** `packages/eval/test/eval.test.mjs`, one server test for the assemble endpoint.
- **Modify** `packages/eval-ui/src/client.ts`, mirrored types + two client methods.
- **Create** `packages/eval-ui/src/assembled-model.ts`, pure UI helpers (`concatBlocks`, `alignBySource`, `lineDiff`) and their types.
- **Create** `packages/eval-ui/src/assembled-model.test.ts`, vitest unit tests for the helpers.
- **Create** `packages/eval-ui/src/AssembledContext.svelte`, the two-column renderer.
- **Modify** `packages/eval-ui/src/App.svelte`, toggle state, controls, fetch orchestration, mount the component.
- **Modify** `packages/eval-ui/src/app.css`, toggle/controls/assembled styles + scroll fix.
- **Modify** `packages/eval-ui/src/App.test.ts`, extend the fake client and add view tests.
- **Modify** docs: `packages/eval/docs/index.md`, `packages/eval/docs/architecture.md`, `packages/eval/docs/public-api.md`, `packages/eval-ui/docs/index.md`, `packages/eval-ui/docs/architecture.md`.

---

### Task 1: Context assembly engine (eval core)

**Files:**
- Create: `packages/eval/src/core/context-assembly.ts`
- Test: `packages/eval/test/context-assembly.test.mjs`

**Interfaces:**
- Consumes: nothing (pure; a `ContextSource` is injected).
- Produces (later tasks rely on these exact names/types):

```ts
export type ContextSource = {
  listFiles(): Promise<string[]>;                  // all repo-relative paths at the ref
  read(filePath: string): Promise<string | undefined>;
};
export type AssembledBlockKind = "claude-md" | "import" | "skills-index" | "skill-body" | "subagents-index";
export type AssembledBlock = { kind: AssembledBlockKind; source: string; text: string };
export type SkillEntry = { name: string; description: string; path: string; loaded: boolean };
export type SubagentEntry = { name: string; description: string; path: string };
export type AssembledContext = { blocks: AssembledBlock[]; skills: SkillEntry[]; subagents: SubagentEntry[]; lazyClaudeMd: string[] };
export type ContextManifest = { skills: SkillEntry[]; subagents: SubagentEntry[] };
export function parseFrontmatter(text: string): { name: string; description: string };
export function claudeMdChain(allPaths: string[], cwd: string): { chain: string[]; lazy: string[] };
export function findImportTokens(text: string): { raw: string; start: number; end: number }[];
export function expandImports(source: ContextSource, filePath: string, text: string, kind: AssembledBlockKind, depth: number, visited: Set<string>): Promise<AssembledBlock[]>;
export function discoverSkills(allPaths: string[]): string[];
export function discoverSubagents(allPaths: string[]): string[];
export function contextManifest(source: ContextSource): Promise<ContextManifest>;
export function assembleContext(source: ContextSource, cwd: string, loadedSkills: string[]): Promise<AssembledContext>;
```

- [ ] **Step 1: Write the failing tests**

Create `packages/eval/test/context-assembly.test.mjs`:

```javascript
import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleContext,
  claudeMdChain,
  contextManifest,
  discoverSkills,
  discoverSubagents,
  findImportTokens,
  parseFrontmatter
} from "../dist/core/context-assembly.js";

/** An in-memory ContextSource over a { path: content } map. */
function source(files) {
  return {
    listFiles: async () => Object.keys(files),
    read: async (filePath) => files[filePath]
  };
}

test("parseFrontmatter reads name and description, unwraps quotes, tolerates no block", () => {
  assert.deepEqual(parseFrontmatter("---\nname: testing\ndescription: \"Use when testing\"\n---\nbody"), { name: "testing", description: "Use when testing" });
  assert.deepEqual(parseFrontmatter("no frontmatter here"), { name: "", description: "" });
});

test("claudeMdChain orders root to cwd, pairs CLAUDE.local.md, partitions below-cwd as lazy", () => {
  const paths = ["CLAUDE.md", "CLAUDE.local.md", "client/CLAUDE.md", "client/lib/CLAUDE.md", "mobile/CLAUDE.md"];
  const { chain, lazy } = claudeMdChain(paths, "client/lib");
  assert.deepEqual(chain, ["CLAUDE.md", "CLAUDE.local.md", "client/CLAUDE.md", "client/lib/CLAUDE.md"]);
  // mobile/ is neither in the chain nor under cwd, so it is not lazy either.
  assert.deepEqual(lazy, []);
});

test("claudeMdChain at root loads only root and lists deeper ones as lazy", () => {
  const paths = ["CLAUDE.md", "client/CLAUDE.md", "client/lib/CLAUDE.md"];
  const { chain, lazy } = claudeMdChain(paths, "");
  assert.deepEqual(chain, ["CLAUDE.md"]);
  assert.deepEqual(lazy, ["client/CLAUDE.md", "client/lib/CLAUDE.md"]);
});

test("findImportTokens finds @paths and skips backticks and fenced blocks", () => {
  const text = "See @AGENTS.md now\nInline `@README` skip\n```\n@code/skip.md\n```\n@docs/use.md";
  const raws = findImportTokens(text).map((token) => token.raw);
  assert.deepEqual(raws, ["AGENTS.md", "docs/use.md"]);
});

test("expandImports via assembleContext expands inline, resolves relative, marks missing", async () => {
  const files = {
    "CLAUDE.md": "head\n@AGENTS.md\ntail\n@missing.md",
    "AGENTS.md": "agents body"
  };
  const result = await assembleContext(source(files), "", []);
  const claudeBlocks = result.blocks.filter((block) => block.kind === "claude-md" || block.kind === "import");
  const joined = claudeBlocks.map((block) => `[${block.kind}:${block.source}] ${block.text}`).join(" | ");
  assert.match(joined, /\[claude-md:CLAUDE\.md\] head/);
  assert.match(joined, /\[import:AGENTS\.md\] agents body/);
  assert.match(joined, /\[claude-md:CLAUDE\.md\] tail/);
  assert.match(joined, /not found: missing\.md/);
});

test("expandImports caps depth at 4 and guards cycles", async () => {
  const files = { "a.md": "@b.md", "b.md": "@a.md" }; // cycle
  const blocks = await assembleContext(source({ "CLAUDE.md": "@a.md", ...files }), "", []);
  const text = blocks.blocks.map((block) => block.text).join("\n");
  assert.match(text, /cycle|max import depth/);
});

test("discoverSkills and discoverSubagents match the right paths", () => {
  const paths = [".claude/skills/testing/SKILL.md", "client/.claude/skills/ui/SKILL.md", ".claude/agents/reviewer.md", "CLAUDE.md", ".claude/skills/testing/extra.md"];
  assert.deepEqual(discoverSkills(paths).sort(), [".claude/skills/testing/SKILL.md", "client/.claude/skills/ui/SKILL.md"]);
  assert.deepEqual(discoverSubagents(paths), [".claude/agents/reviewer.md"]);
});

test("assembleContext: frontmatter always, body only when loaded, subagents metadata only", async () => {
  const files = {
    "CLAUDE.md": "root rules",
    ".claude/skills/testing/SKILL.md": "---\nname: testing\ndescription: Use when testing\n---\nFULL TESTING BODY",
    ".claude/agents/reviewer.md": "---\nname: reviewer\ndescription: Reviews code\n---\nAGENT SYSTEM PROMPT"
  };
  const notLoaded = await assembleContext(source(files), "", []);
  assert.ok(notLoaded.blocks.some((block) => block.kind === "skills-index" && /testing/.test(block.text)));
  assert.ok(!notLoaded.blocks.some((block) => block.kind === "skill-body"));
  assert.ok(!notLoaded.blocks.some((block) => block.text.includes("AGENT SYSTEM PROMPT")));
  assert.ok(notLoaded.blocks.some((block) => block.kind === "subagents-index" && /reviewer/.test(block.text)));
  assert.equal(notLoaded.skills[0].loaded, false);

  const loaded = await assembleContext(source(files), "", ["testing"]);
  assert.ok(loaded.blocks.some((block) => block.kind === "skill-body" && block.text.includes("FULL TESTING BODY")));
  assert.equal(loaded.skills[0].loaded, true);
});

test("contextManifest returns skills and subagents without assembling the chain", async () => {
  const files = { "CLAUDE.md": "x", ".claude/skills/t/SKILL.md": "---\nname: t\ndescription: d\n---\nbody" };
  const manifest = await contextManifest(source(files));
  assert.deepEqual(manifest.skills.map((skill) => skill.name), ["t"]);
  assert.deepEqual(manifest.subagents, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/eval && npm run build && node --test test/context-assembly.test.mjs`
Expected: build fails or tests fail with "Cannot find module ../dist/core/context-assembly.js".

- [ ] **Step 3: Implement the engine**

Create `packages/eval/src/core/context-assembly.ts`:

```ts
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
  const rank = (p: string) => dirOf(p).split("/").filter(Boolean).length * 2 + (p.endsWith("CLAUDE.local.md") ? 1 : 0);
  const chain = inChain.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return { chain, lazy };
}

/** Char offsets of @import tokens outside inline backticks and fenced code blocks. */
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
    if (imported === undefined) { blocks.push({ kind: "import", source: target, text: `(@${token.raw}: not found)` }); continue; }
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/eval && npm run build && node --test test/context-assembly.test.mjs`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/eval/src/core/context-assembly.ts packages/eval/test/context-assembly.test.mjs
git commit -m "feat(eval): context assembly engine for repo-contributed agent context"
```

---

### Task 2: Context endpoints (eval server)

**Files:**
- Modify: `packages/eval/src/server/index.ts`
- Test: `packages/eval/test/eval.test.mjs`

**Interfaces:**
- Consumes: `assembleContext`, `contextManifest`, `ContextSource`, `AssembledContext`, `ContextManifest` from `../core/context-assembly.js`; `fileOidsAtRef`, `showFile` from `@tangent/repo/git` (already imported); `EvalRunVariantState`, `requiredParam`, `json`, `EvalRunManifest`.
- Produces: GET `/api/eval/runs/:runId/context/manifest?caseId=&variant=` → `ContextManifest`; GET `/api/eval/runs/:runId/context/assemble?caseId=&variant=&cwd=&skills=a,b` → `AssembledContext`.

- [ ] **Step 1: Write the failing test**

Add to `packages/eval/test/eval.test.mjs` (after the existing tests, before the final closing). It reuses the `prepareEval` fixture pattern already in the file (a repo with `CLAUDE.md`, an `empty` and a `repo` variant):

```javascript
test("context assemble endpoint reconstructs the repo variant and empties the empty variant", async () => {
  const repo = await createRepo();
  const evalHome = await mkdtemp(path.join(tmpdir(), "tangent-eval-home-"));
  process.env.TANGENT_EVAL_HOME = evalHome;

  await writeFile(path.join(repo, "CLAUDE.md"), "root rules\n", "utf8");
  await mkdir(path.join(repo, ".claude", "skills", "testing"), { recursive: true });
  await writeFile(path.join(repo, ".claude", "skills", "testing", "SKILL.md"), "---\nname: testing\ndescription: Use when testing\n---\nFULL BODY\n", "utf8");
  await writeFile(path.join(repo, "index.ts"), "export const value = 1;\n", "utf8");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "base");

  const evalDir = path.join(repo, "evals", "task");
  await mkdir(path.join(evalDir, "prompts"), { recursive: true });
  await writeFile(path.join(evalDir, "prompts", "task.md"), "Change the value.\n", "utf8");
  const specPath = path.join(evalDir, "eval.json");
  await writeFile(specPath, JSON.stringify({
    schema: "eval.spec.v1",
    name: "task",
    defaults: { repo: { path: repo, ref: "HEAD" }, cwd: ".", agent: { kind: "manual" }, phases: ["plan", "implement"] },
    cases: [{ id: "task", prompt: "prompts/task.md", variants: [{ id: "empty", context: { mode: "empty" } }, { id: "repo", context: { mode: "repo" } }] }]
  }, null, 2), "utf8");

  const prepared = await prepareEval(specPath);
  const server = await startEvalUiServer({ runId: prepared.manifest.runId, port: 0 });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const repoCtx = await (await fetch(`${base}/api/eval/runs/${prepared.manifest.runId}/context/assemble?caseId=task&variant=repo&cwd=&skills=`)).json();
    assert.ok(repoCtx.blocks.some((block) => block.kind === "claude-md" && block.text.includes("root rules")));
    assert.ok(repoCtx.blocks.some((block) => block.kind === "skills-index" && block.text.includes("testing")));
    assert.ok(!repoCtx.blocks.some((block) => block.kind === "skill-body"));
    const loaded = await (await fetch(`${base}/api/eval/runs/${prepared.manifest.runId}/context/assemble?caseId=task&variant=repo&cwd=&skills=testing`)).json();
    assert.ok(loaded.blocks.some((block) => block.kind === "skill-body" && block.text.includes("FULL BODY")));

    const emptyCtx = await (await fetch(`${base}/api/eval/runs/${prepared.manifest.runId}/context/assemble?caseId=task&variant=empty&cwd=&skills=`)).json();
    assert.equal(emptyCtx.blocks.length, 0);

    const manifest = await (await fetch(`${base}/api/eval/runs/${prepared.manifest.runId}/context/manifest?caseId=task&variant=repo`)).json();
    assert.deepEqual(manifest.skills.map((skill) => skill.name), ["testing"]);
  } finally {
    await server.close();
  }
});
```

Note: confirm the exact `startEvalUiServer` option/return shape against the existing server tests in the file; if its signature differs (e.g. it takes `{ preferredRunId }` or returns `{ url }`), match that existing usage rather than the names above.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/eval && npm run build && node --test test/eval.test.mjs`
Expected: FAIL with 404 (route not found) on the assemble fetch.

- [ ] **Step 3: Implement endpoints**

In `packages/eval/src/server/index.ts`, add the import near the other core imports:

```ts
import { assembleContext, contextManifest, type AssembledContext, type ContextManifest, type ContextSource } from "../core/context-assembly.js";
```

Add these functions near `showContextFile` / `selectedPair`:

```ts
/** A ContextSource over a variant's frozen worktree at its context ref, the same ref showContextFile reads. */
function variantContextSource(variant: EvalRunVariantState): ContextSource {
  const ref = variant.contextCommit || variant.baseCommit;
  return {
    listFiles: async () => [...(await fileOidsAtRef(variant.worktree, ref)).keys()],
    read: (filePath) => showFile(variant.worktree, ref, filePath).catch(() => undefined)
  };
}

/** Resolves and validates a single requested variant (manifest + caseId + variant query params). */
function singleVariant(manifest: EvalRunManifest, url: URL): { caseId: string; variant: EvalRunVariantState } {
  const caseId = requiredParam(url, "caseId");
  const variantId = requiredParam(url, "variant");
  const variant = manifest.variants.find((entry) => entry.caseId === caseId && entry.variantId === variantId);
  if (!variant) {
    const error = new Error(`Variant ${variantId} not found for case ${caseId}.`) as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  return { caseId, variant };
}

/** Lists a variant's discoverable skills and subagents (frontmatter only), for the skill picker. */
async function contextManifestView(manifest: EvalRunManifest, url: URL): Promise<ContextManifest> {
  const { variant } = singleVariant(manifest, url);
  return contextManifest(variantContextSource(variant));
}

/** Assembles a variant's repo-contributed context at the requested cwd and loaded-skill set. */
async function assembleContextView(manifest: EvalRunManifest, url: URL): Promise<AssembledContext> {
  const { variant } = singleVariant(manifest, url);
  const cwd = url.searchParams.get("cwd") || "";
  const skillsParam = url.searchParams.get("skills") || "";
  const loadedSkills = skillsParam.split(",").map((name) => name.trim()).filter(Boolean);
  return assembleContext(variantContextSource(variant), cwd, loadedSkills);
}
```

In `handleApiRequest`, inside the `if (parts[2] === "runs")` block, add these two lines next to the existing `compare`/`diff` route lines:

```ts
      if (parts.length === 6 && parts[4] === "context" && parts[5] === "manifest") return json(200, await contextManifestView(manifest, url));
      if (parts.length === 6 && parts[4] === "context" && parts[5] === "assemble") return json(200, await assembleContextView(manifest, url));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/eval && npm run build && node --test test/eval.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/eval/src/server/index.ts packages/eval/test/eval.test.mjs
git commit -m "feat(eval): context manifest and assemble endpoints"
```

---

### Task 3: Client types and methods (eval-ui)

**Files:**
- Modify: `packages/eval-ui/src/client.ts`
- Test: `packages/eval-ui/src/client.test.ts` (create)

**Interfaces:**
- Consumes: nothing new (mirrors Task 2's JSON shapes).
- Produces: `EvalAssembledBlock`, `EvalAssembledContext`, `EvalContextSkill`, `EvalContextSubagent`, `EvalContextManifest` types; `client.getContextManifest(...)` and `client.assembleContext(...)`.

- [ ] **Step 1: Write the failing test**

Create `packages/eval-ui/src/client.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEvalApiClient } from "./client.js";

afterEach(() => vi.restoreAllMocks());

describe("eval api client context methods", () => {
  it("builds the assemble URL with cwd and comma-joined skills", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ blocks: [], skills: [], subagents: [], lazyClaudeMd: [] }), { status: 200 })
    );
    const client = createEvalApiClient("");
    await client.assembleContext({ runId: "r1", caseId: "task", variant: "repo", cwd: "client/lib", skills: ["testing", "ui"] });
    const url = (fetchMock.mock.calls[0][0] as string);
    expect(url).toContain("/api/eval/runs/r1/context/assemble?");
    expect(url).toContain("caseId=task");
    expect(url).toContain("variant=repo");
    expect(url).toContain("cwd=client%2Flib");
    expect(url).toContain("skills=testing%2Cui");
  });

  it("builds the manifest URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ skills: [], subagents: [] }), { status: 200 })
    );
    const client = createEvalApiClient("");
    await client.getContextManifest({ runId: "r1", caseId: "task", variant: "repo" });
    expect(fetchMock.mock.calls[0][0] as string).toContain("/api/eval/runs/r1/context/manifest?");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/eval-ui && npx vitest run src/client.test.ts`
Expected: FAIL with "assembleContext is not a function" / type error.

- [ ] **Step 3: Implement types and methods**

In `packages/eval-ui/src/client.ts`, add after the `EvalDiffView` type:

```ts
export type EvalAssembledBlockKind = "claude-md" | "import" | "skills-index" | "skill-body" | "subagents-index";
export type EvalAssembledBlock = { kind: EvalAssembledBlockKind; source: string; text: string };
export type EvalContextSkill = { name: string; description: string; path: string; loaded: boolean };
export type EvalContextSubagent = { name: string; description: string; path: string };
export type EvalAssembledContext = { blocks: EvalAssembledBlock[]; skills: EvalContextSkill[]; subagents: EvalContextSubagent[]; lazyClaudeMd: string[] };
export type EvalContextManifest = { skills: EvalContextSkill[]; subagents: EvalContextSubagent[] };
```

Add to the `EvalUiClient` type, after `getDiff`:

```ts
  getContextManifest(args: { runId: string; caseId: string; variant: string }): Promise<EvalContextManifest>;
  assembleContext(args: { runId: string; caseId: string; variant: string; cwd: string; skills: string[] }): Promise<EvalAssembledContext>;
```

Add to `createEvalApiClient`'s returned object, after `getDiff`:

```ts
    /** Lists a variant's discoverable skills and subagents for the context skill picker. */
    getContextManifest: (args) => getJson(`${baseUrl}/api/eval/runs/${encodeURIComponent(args.runId)}/context/manifest?${query({ caseId: args.caseId, variant: args.variant })}`),
    /** Assembles a variant's repo-contributed context at a cwd with a loaded-skill set. */
    assembleContext: (args) => getJson(`${baseUrl}/api/eval/runs/${encodeURIComponent(args.runId)}/context/assemble?${query({ caseId: args.caseId, variant: args.variant, cwd: args.cwd, skills: args.skills.join(",") })}`),
```

- [ ] **Step 4: Keep the App test fake satisfying the widened interface**

Widening `EvalUiClient` makes `App.test.ts`'s `fakeEvalClient` fail to typecheck until it implements the two new methods. Add them now (Task 4 relies on this exact behavior: the repo variant has blocks, the empty variant has none, and loading `testing` adds its body). In `packages/eval-ui/src/App.test.ts`, add to the object returned by `fakeEvalClient`:

```typescript
    /** Returns a deterministic context manifest. */
    getContextManifest: vi.fn(async () => ({ skills: [{ name: "testing", description: "Use when testing", path: ".claude/skills/testing/SKILL.md", loaded: false }], subagents: [] })),
    /** Returns a deterministic assembled context: the repo side has blocks, the empty side has none. */
    assembleContext: vi.fn(async (args: { variant: string; skills: string[] }) => args.variant === "repo"
      ? { blocks: [
          { kind: "claude-md" as const, source: "CLAUDE.md", text: "root rules" },
          { kind: "skills-index" as const, source: "skills", text: "testing: Use when testing" },
          ...(args.skills.includes("testing") ? [{ kind: "skill-body" as const, source: ".claude/skills/testing/SKILL.md", text: "FULL TESTING BODY" }] : [])
        ], skills: [{ name: "testing", description: "Use when testing", path: ".claude/skills/testing/SKILL.md", loaded: args.skills.includes("testing") }], subagents: [], lazyClaudeMd: [] }
      : { blocks: [], skills: [], subagents: [], lazyClaudeMd: [] })
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/eval-ui && npx vitest run src/client.test.ts && npx tsc -p tsconfig.json --noEmit`
Expected: client test PASS; typecheck clean (the fake now satisfies `EvalUiClient`).

- [ ] **Step 6: Commit**

```bash
git add packages/eval-ui/src/client.ts packages/eval-ui/src/client.test.ts packages/eval-ui/src/App.test.ts
git commit -m "feat(eval-ui): client types and methods for context assembly"
```

---

### Task 4: Assembled view scaffold (toggle, two-column verbatim render, copy)

**Files:**
- Create: `packages/eval-ui/src/assembled-model.ts`
- Create: `packages/eval-ui/src/assembled-model.test.ts`
- Create: `packages/eval-ui/src/AssembledContext.svelte`
- Modify: `packages/eval-ui/src/App.svelte`
- Modify: `packages/eval-ui/src/app.css`
- Test: `packages/eval-ui/src/App.test.ts`

**Interfaces:**
- Consumes: `EvalAssembledContext`, `EvalAssembledBlock` from `client.js`.
- Produces: `concatBlocks(blocks)`, `alignBySource(left, right)` and types in `assembled-model.ts`; `AssembledContext.svelte` rendering both sides; App state `contextView: "files" | "assembled"`.

- [ ] **Step 1: Write the failing helper tests**

Create `packages/eval-ui/src/assembled-model.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { alignBySource, concatBlocks } from "./assembled-model.js";
import type { EvalAssembledBlock } from "./client.js";

const block = (source: string, text: string, kind: EvalAssembledBlock["kind"] = "claude-md"): EvalAssembledBlock => ({ kind, source, text });

describe("assembled-model", () => {
  it("concatBlocks joins verbatim text without provenance chrome", () => {
    expect(concatBlocks([block("a", "one"), block("b", "two")])).toBe("one\n\ntwo");
  });

  it("alignBySource marks right-only, left-only, changed, and same by source", () => {
    const left = [block("/CLAUDE.md", "root")];
    const right = [block("/CLAUDE.md", "root changed"), block("/client/CLAUDE.md", "client")];
    const rows = alignBySource(left, right);
    const bySource = Object.fromEntries(rows.map((row) => [row.source, row.status]));
    expect(bySource["/CLAUDE.md"]).toBe("changed");
    expect(bySource["/client/CLAUDE.md"]).toBe("right-only");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/eval-ui && npx vitest run src/assembled-model.test.ts`
Expected: FAIL ("Cannot find module ./assembled-model.js").

- [ ] **Step 3: Implement the model helpers**

Create `packages/eval-ui/src/assembled-model.ts`:

```ts
import type { EvalAssembledBlock } from "./client.js";

/** The verbatim concatenation of block texts (no provenance dividers), for copy. */
export function concatBlocks(blocks: EvalAssembledBlock[]): string {
  return blocks.map((block) => block.text).join("\n\n");
}

export type AssembledDiffStatus = "same" | "changed" | "left-only" | "right-only";
export type AssembledDiffRow = { source: string; kind: EvalAssembledBlock["kind"]; leftText?: string; rightText?: string; status: AssembledDiffStatus };

/** Concatenates a side's blocks by source (segments of one file rejoin), preserving first-seen order. */
function bySource(blocks: EvalAssembledBlock[]): { order: string[]; text: Map<string, string>; kind: Map<string, EvalAssembledBlock["kind"]> } {
  const order: string[] = [];
  const text = new Map<string, string>();
  const kind = new Map<string, EvalAssembledBlock["kind"]>();
  for (const block of blocks) {
    if (!text.has(block.source)) { order.push(block.source); text.set(block.source, block.text); kind.set(block.source, block.kind); }
    else text.set(block.source, `${text.get(block.source)}${block.text}`);
  }
  return { order, text, kind };
}

/** Aligns two sides' blocks by source so present-only and content differences are explicit. */
export function alignBySource(left: EvalAssembledBlock[], right: EvalAssembledBlock[]): AssembledDiffRow[] {
  const a = bySource(left);
  const b = bySource(right);
  const seen = new Set<string>();
  const rows: AssembledDiffRow[] = [];
  for (const source of [...a.order, ...b.order]) {
    if (seen.has(source)) continue;
    seen.add(source);
    const leftText = a.text.get(source);
    const rightText = b.text.get(source);
    const kind = (a.kind.get(source) || b.kind.get(source)) as EvalAssembledBlock["kind"];
    const status: AssembledDiffStatus = leftText === undefined ? "right-only" : rightText === undefined ? "left-only" : leftText === rightText ? "same" : "changed";
    rows.push({ source, kind, leftText, rightText, status });
  }
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/eval-ui && npx vitest run src/assembled-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the AssembledContext component**

Create `packages/eval-ui/src/AssembledContext.svelte`. It is a pure renderer; App.svelte fetches and passes results in. Difference highlighting beyond present-only is added in Task 6, so this version renders each side's blocks verbatim with provenance dividers, an empty state, and a copy button:

```svelte
<script lang="ts">
  import type { EvalAssembledContext } from "./client.js";
  import { concatBlocks } from "./assembled-model.js";

  export let left: EvalAssembledContext | undefined;
  export let right: EvalAssembledContext | undefined;
  export let leftLabel = "";
  export let rightLabel = "";
  export let loading = false;
  export let errorText = "";

  const sides = () => [
    { key: "a", label: leftLabel, ctx: left },
    { key: "b", label: rightLabel, ctx: right }
  ];

  /** Copies a side's verbatim concatenation (no provenance dividers). */
  async function copySide(ctx: EvalAssembledContext | undefined): Promise<void> {
    if (!ctx) return;
    await navigator.clipboard?.writeText(concatBlocks(ctx.blocks));
  }

  /** A short divider label for a block, by kind. */
  function dividerLabel(kind: string, source: string): string {
    if (kind === "skills-index") return "Skills index (frontmatter, always loaded)";
    if (kind === "skill-body") return `SKILL: ${source} (body, loaded)`;
    if (kind === "subagents-index") return "Subagents (metadata only, not in context)";
    if (kind === "import") return `${source} (imported)`;
    return source;
  }
</script>

<div class="assembled" aria-label="Assembled context">
  {#if errorText}
    <p class="assembled-error">{errorText}</p>
  {:else}
    <div class="assembled-cols">
      {#each sides() as side (side.key)}
        <div class="assembled-col assembled-{side.key}">
          <div class="assembled-col-head">
            <span class="assembled-label">{side.label}</span>
            <button type="button" class="assembled-copy" aria-label={`Copy ${side.label} context`} on:click={() => copySide(side.ctx)}>copy</button>
          </div>
          {#if loading}
            <div class="state">Assembling…</div>
          {:else if !side.ctx || side.ctx.blocks.length === 0}
            <p class="assembled-empty">No repo context loads at this path.</p>
          {:else}
            {#each side.ctx.blocks as block, i (`${block.source}:${i}`)}
              <div class="assembled-block assembled-{block.kind}">
                <div class="assembled-divider">{dividerLabel(block.kind, block.source)}</div>
                <pre class="assembled-text">{block.text}</pre>
              </div>
            {/each}
            {#if side.ctx.lazyClaudeMd.length}
              <details class="assembled-lazy">
                <summary>Below cwd, loads lazily (not at start): {side.ctx.lazyClaudeMd.length}</summary>
                <ul>{#each side.ctx.lazyClaudeMd as path}<li>{path}</li>{/each}</ul>
              </details>
            {/if}
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
```

- [ ] **Step 6: Wire the toggle and fetch into App.svelte**

Add the import near the other imports in `App.svelte`:

```ts
  import AssembledContext from "./AssembledContext.svelte";
  import type { EvalAssembledContext } from "./client.js";
```

Add state near the other compare state (`let diffCache = ...`):

```ts
  // Context section view: the raw file diff list vs the assembled "what the agent sees" reconstruction.
  let contextView: "files" | "assembled" = "files";
  let assembleCwd = "";
  let loadedSkills = new Set<string>();
  let assembledLeft: EvalAssembledContext | undefined;
  let assembledRight: EvalAssembledContext | undefined;
  let assembledLoading = false;
  let assembledError = "";
  let assembledKey = "";
```

Add a fetch function near `expandRow`/`toggleRow`:

```ts
  /** Fetches both variants' assembled context for the current cwd and loaded skills, memoized by key. */
  async function loadAssembled(): Promise<void> {
    if (contextView !== "assembled" || !selectedRunId || !selectedCaseId || !leftVariantId || !rightVariantId) return;
    const skills = [...loadedSkills].sort();
    const key = `${selectedRunId}::${selectedCaseId}::${leftVariantId}::${rightVariantId}::${assembleCwd}::${skills.join(",")}`;
    if (key === assembledKey) return;
    assembledKey = key;
    assembledLoading = true;
    assembledError = "";
    try {
      const [a, b] = await Promise.all([
        client.assembleContext({ runId: selectedRunId, caseId: selectedCaseId, variant: leftVariantId, cwd: assembleCwd, skills }),
        client.assembleContext({ runId: selectedRunId, caseId: selectedCaseId, variant: rightVariantId, cwd: assembleCwd, skills })
      ]);
      assembledLeft = a; assembledRight = b;
    } catch (loadError) {
      assembledError = (loadError as Error).message;
    } finally {
      assembledLoading = false;
    }
  }

  // Re-assemble when the view opens or any input changes. Svelte only re-runs a reactive block when a
  // variable it directly reads changes; it does not track reads inside loadAssembled. Referencing the dep
  // string here is what makes cwd and skill changes refetch.
  $: assembleDeps = `${contextView}|${selectedRunId}|${selectedCaseId}|${leftVariantId}|${rightVariantId}|${assembleCwd}|${[...loadedSkills].sort().join(",")}`;
  $: if (contextView === "assembled") { void assembleDeps; void loadAssembled(); }
```

In the template, find the Context section. The aligned sections are rendered by `{#each alignedSections as section}`. Wrap the Context section's body so that when `section.kind === "context"` the header carries a `Files | Assembled` toggle and the body switches. Concretely, replace the section header line for context and add the assembled branch. Inside the `{#each alignedSections as section}` block, change the `<div class="aligned-rows">` opening for the context kind to:

```svelte
    {#if section.kind === "context"}
      <div class="context-toggle">
        <button type="button" class="seg" class:active={contextView === "files"} on:click={() => (contextView = "files")}>Files</button>
        <button type="button" class="seg" class:active={contextView === "assembled"} on:click={() => (contextView = "assembled")}>Assembled</button>
      </div>
    {/if}
    {#if section.kind === "context" && contextView === "assembled"}
      <AssembledContext
        left={assembledLeft}
        right={assembledRight}
        leftLabel={leftVariantId}
        rightLabel={rightVariantId}
        loading={assembledLoading}
        errorText={assembledError} />
    {:else}
      <div class="aligned-rows">
        <!-- existing rows {#each rows as row} ... unchanged ... -->
      </div>
    {/if}
```

Keep the existing `{#each rows as row}` content exactly as-is inside the `:else` `<div class="aligned-rows">`.

- [ ] **Step 7: Add CSS**

Append to `packages/eval-ui/src/app.css`:

```css
.context-toggle {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid var(--line);
}
.context-toggle .seg {
  border: 1px solid var(--line);
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  padding: 3px 10px;
  cursor: pointer;
}
.context-toggle .seg.active {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}
.assembled-cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}
.assembled-col {
  min-width: 0;
  padding: 8px 12px;
}
.assembled-b {
  border-left: 1px solid var(--line);
}
.assembled-col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.assembled-label {
  font-size: 13px;
  font-weight: 600;
}
.assembled-copy {
  border: 1px solid var(--line);
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
}
.assembled-divider {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  border-top: 1px solid var(--line);
  padding: 6px 0 2px;
  margin-top: 6px;
}
.assembled-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.45;
}
.assembled-empty,
.assembled-error {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}
.assembled-lazy {
  margin-top: 8px;
  font-size: 12px;
  color: var(--muted);
}
```

- [ ] **Step 8: Write the failing UI tests**

The `fakeEvalClient` already returns `getContextManifest` and `assembleContext` (added in Task 3, Step 4) with the behavior these tests rely on: the repo variant has blocks, the empty variant has none, and loading `testing` adds its body. Add these tests to `packages/eval-ui/src/App.test.ts` inside the `describe` block:

```typescript
  it("switches the Context section to the Assembled view and renders verbatim blocks per side", async () => {
    const client = fakeEvalClient();
    const { container } = render(App, { props: { client } });
    await screen.findByText(/ui-compare/);
    await fireEvent.click(screen.getByRole("button", { name: "Assembled" }));
    // Repo side shows the CLAUDE.md content; empty side shows the empty state.
    expect(await screen.findByText("root rules")).toBeInTheDocument();
    expect(screen.getByText("No repo context loads at this path.")).toBeInTheDocument();
  });

  it("copies a side's verbatim concatenation without provenance dividers", async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    const client = fakeEvalClient();
    render(App, { props: { client } });
    await screen.findByText(/ui-compare/);
    await fireEvent.click(screen.getByRole("button", { name: "Assembled" }));
    await screen.findByText("root rules");
    await fireEvent.click(screen.getByRole("button", { name: "Copy repo context" }));
    expect(writeText).toHaveBeenCalledWith("root rules\n\ntesting: Use when testing");
  });
```

- [ ] **Step 9: Run UI tests to verify they pass**

Run: `cd packages/eval-ui && npx vitest run`
Expected: all pass (existing + new).

- [ ] **Step 10: Commit**

```bash
git add packages/eval-ui/src/assembled-model.ts packages/eval-ui/src/assembled-model.test.ts packages/eval-ui/src/AssembledContext.svelte packages/eval-ui/src/App.svelte packages/eval-ui/src/app.css packages/eval-ui/src/App.test.ts
git commit -m "feat(eval-ui): assembled context view with files/assembled toggle and copy"
```

---

### Task 5: cwd and skill controls

**Files:**
- Modify: `packages/eval-ui/src/App.svelte`
- Modify: `packages/eval-ui/src/app.css`
- Test: `packages/eval-ui/src/App.test.ts`

**Interfaces:**
- Consumes: `client.getContextManifest`, the `assembleCwd`/`loadedSkills` state from Task 4, `EvalContextSkill`.
- Produces: a cwd text input and a skill picker bound to `assembleCwd` and `loadedSkills`, both re-triggering `loadAssembled`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/eval-ui/src/App.test.ts`:

```typescript
  it("re-assembles both sides when the cwd changes", async () => {
    const client = fakeEvalClient();
    render(App, { props: { client } });
    await screen.findByText(/ui-compare/);
    await fireEvent.click(screen.getByRole("button", { name: "Assembled" }));
    await screen.findByText("root rules");
    const calls = (client.assembleContext as ReturnType<typeof vi.fn>).mock.calls.length;
    await fireEvent.input(screen.getByLabelText("cwd path"), { target: { value: "client/lib" } });
    // Two more calls (both sides) for the new cwd.
    await screen.findByText("root rules");
    expect((client.assembleContext as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls);
    const lastArgs = (client.assembleContext as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(lastArgs.cwd).toBe("client/lib");
  });

  it("loads a skill body when its picker checkbox is toggled", async () => {
    const client = fakeEvalClient();
    render(App, { props: { client } });
    await screen.findByText(/ui-compare/);
    await fireEvent.click(screen.getByRole("button", { name: "Assembled" }));
    await screen.findByText("root rules");
    await fireEvent.click(await screen.findByRole("checkbox", { name: "testing" }));
    expect(await screen.findByText("FULL TESTING BODY")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/eval-ui && npx vitest run src/App.test.ts`
Expected: FAIL ("Unable to find label cwd path").

- [ ] **Step 3: Implement controls and manifest fetch**

In `App.svelte`, add manifest state near the assembled state:

```ts
  let contextSkills: import("./client.js").EvalContextSkill[] = [];
  let contextManifestKey = "";

  /** Loads the union of discoverable skills across both variants for the picker. */
  async function loadContextManifest(): Promise<void> {
    if (contextView !== "assembled" || !selectedRunId || !selectedCaseId || !leftVariantId || !rightVariantId) return;
    const key = `${selectedRunId}::${selectedCaseId}::${leftVariantId}::${rightVariantId}`;
    if (key === contextManifestKey) return;
    contextManifestKey = key;
    const [a, b] = await Promise.all([
      client.getContextManifest({ runId: selectedRunId, caseId: selectedCaseId, variant: leftVariantId }),
      client.getContextManifest({ runId: selectedRunId, caseId: selectedCaseId, variant: rightVariantId })
    ]);
    const byName = new Map<string, import("./client.js").EvalContextSkill>();
    for (const skill of [...a.skills, ...b.skills]) if (!byName.has(skill.name)) byName.set(skill.name, skill);
    contextSkills = [...byName.values()].sort((x, y) => x.name.localeCompare(y.name));
  }

  $: manifestDeps = `${contextView}|${selectedRunId}|${selectedCaseId}|${leftVariantId}|${rightVariantId}`;
  $: if (contextView === "assembled") { void manifestDeps; void loadContextManifest(); }

  /** Toggles whether a skill's body is included, then re-assembles. */
  function toggleSkill(name: string): void {
    if (loadedSkills.has(name)) loadedSkills.delete(name);
    else loadedSkills.add(name);
    loadedSkills = loadedSkills;
  }
```

In the template, add the controls just above the `<AssembledContext ... />` mount:

```svelte
      <div class="assembled-controls">
        <label class="cwd-field">cwd
          <input type="text" aria-label="cwd path" placeholder="repo root" bind:value={assembleCwd} />
        </label>
        {#if contextSkills.length}
          <div class="skill-picker" role="group" aria-label="Skills to load">
            {#each contextSkills as skill}
              <label class="skill-option">
                <input type="checkbox" aria-label={skill.name} checked={loadedSkills.has(skill.name)} on:change={() => toggleSkill(skill.name)} />
                {skill.name}
              </label>
            {/each}
          </div>
        {/if}
      </div>
```

- [ ] **Step 4: Add CSS**

Append to `packages/eval-ui/src/app.css`:

```css
.assembled-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-top: 1px solid var(--line);
}
.cwd-field {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}
.cwd-field input {
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 3px 8px;
  font: inherit;
  min-width: 240px;
}
.skill-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.skill-option {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/eval-ui && npx vitest run`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/eval-ui/src/App.svelte packages/eval-ui/src/app.css packages/eval-ui/src/App.test.ts
git commit -m "feat(eval-ui): cwd and skill controls for the assembled context view"
```

---

### Task 6: Difference highlighting between the two sides

**Files:**
- Modify: `packages/eval-ui/src/assembled-model.ts`
- Modify: `packages/eval-ui/src/assembled-model.test.ts`
- Modify: `packages/eval-ui/src/AssembledContext.svelte`
- Modify: `packages/eval-ui/src/app.css`
- Test: `packages/eval-ui/src/App.test.ts`

**Interfaces:**
- Consumes: `alignBySource` from Task 4.
- Produces: `lineDiff(a, b)` in `assembled-model.ts`; the component marks each block's divider with its per-source status and, for changed sources, shades added/removed lines.

- [ ] **Step 1: Write the failing helper test**

Add to `packages/eval-ui/src/assembled-model.test.ts`:

```typescript
import { lineDiff } from "./assembled-model.js";

describe("lineDiff", () => {
  it("marks equal, added, and removed lines", () => {
    const rows = lineDiff("a\nb\nc", "a\nB\nc");
    const markers = rows.map((row) => row.marker);
    expect(markers).toContain("equal");
    expect(markers).toContain("add");
    expect(markers).toContain("del");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/eval-ui && npx vitest run src/assembled-model.test.ts`
Expected: FAIL ("lineDiff is not exported").

- [ ] **Step 3: Implement lineDiff**

Add to `packages/eval-ui/src/assembled-model.ts`:

```ts
export type LineMark = { marker: "equal" | "add" | "del"; text: string };

/** A minimal LCS line diff between two texts, used to shade a changed block's added and removed lines. */
export function lineDiff(left: string, right: string): LineMark[] {
  const a = left.split("\n");
  const b = right.split("\n");
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const rows: LineMark[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { rows.push({ marker: "equal", text: a[i] }); i += 1; j += 1; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { rows.push({ marker: "del", text: a[i] }); i += 1; }
    else { rows.push({ marker: "add", text: b[j] }); j += 1; }
  }
  while (i < a.length) { rows.push({ marker: "del", text: a[i] }); i += 1; }
  while (j < b.length) { rows.push({ marker: "add", text: b[j] }); j += 1; }
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/eval-ui && npx vitest run src/assembled-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Render status and shading in the component**

In `AssembledContext.svelte`, import `alignBySource` and `lineDiff`, compute a per-source status map per side, and tag dividers. Replace the script's import and add a reactive status map:

```ts
  import { concatBlocks, alignBySource, lineDiff } from "./assembled-model.js";
  // Maps each source to its A/B difference status, so a divider can show "only here" / "differs".
  $: statusBySource = (() => {
    const map = new Map<string, string>();
    if (left && right) for (const row of alignBySource(left.blocks, right.blocks)) map.set(row.source, row.status);
    return map;
  })();
  /** A short difference tag for a block, from this side's perspective. */
  function diffTag(source: string, sideKey: string): string {
    const status = statusBySource.get(source);
    if (status === "changed") return "differs";
    if ((status === "left-only" && sideKey === "a") || (status === "right-only" && sideKey === "b")) return "only here";
    return "";
  }
```

In the markup, add the tag to the divider:

```svelte
                <div class="assembled-divider" class:differs={diffTag(block.source, side.key) === "differs"}>
                  {dividerLabel(block.kind, block.source)}
                  {#if diffTag(block.source, side.key)}<span class="diff-tag">{diffTag(block.source, side.key)}</span>{/if}
                </div>
```

- [ ] **Step 6: Add CSS**

Append to `packages/eval-ui/src/app.css`:

```css
.assembled-divider.differs {
  color: #7a4f00;
}
.diff-tag {
  margin-left: 6px;
  font-weight: 700;
  text-transform: uppercase;
  font-size: 10px;
}
```

- [ ] **Step 7: Write the failing UI test**

Add to `packages/eval-ui/src/App.test.ts` a test using artifacts where both sides share a context file with differing content. Use a custom client override so both variants return a CLAUDE.md with different text:

```typescript
  it("marks a context block present on only one side", async () => {
    const client = fakeEvalClient();
    render(App, { props: { client } });
    await screen.findByText(/ui-compare/);
    await fireEvent.click(screen.getByRole("button", { name: "Assembled" }));
    await screen.findByText("root rules");
    // The repo side's CLAUDE.md is absent from the empty side, so its divider is tagged "only here".
    expect(screen.getAllByText("only here").length).toBeGreaterThanOrEqual(1);
  });
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd packages/eval-ui && npx vitest run`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add packages/eval-ui/src/assembled-model.ts packages/eval-ui/src/assembled-model.test.ts packages/eval-ui/src/AssembledContext.svelte packages/eval-ui/src/app.css packages/eval-ui/src/App.test.ts
git commit -m "feat(eval-ui): difference highlighting in the assembled context view"
```

---

### Task 7: Scroll fix for the Context section

**Files:**
- Modify: `packages/eval-ui/src/app.css`

**Interfaces:**
- Consumes: nothing.
- Produces: a Context/compare body that scrolls within the panel.

The compare body lives in `.compare-stack` (`overflow: auto; min-height: 0`), inside `.compare-shell` (`overflow: hidden; flex: 1 1 auto; min-height: 0`), inside `.eval-workspace` (`height: 100vh; overflow: hidden`). In the combined `tangent ui` shell, the embedded eval root may not establish a bounded height down this chain, so a long Context section grows the page instead of scrolling `.compare-stack`. The fix establishes the bounded height and confirms `.compare-stack` is the scroll container.

- [ ] **Step 1: Reproduce in tangent ui**

Run from the worktree:

```bash
node scripts/verify-app.mjs ui
```

Open the printed URL, go to Eval → Results → a run with a long Context files list, and confirm the list overflows without scrolling. Note which ancestor element has the unbounded height (inspect the embedded eval root the shell mounts).

- [ ] **Step 2: Apply the height/scroll rule**

In `packages/eval-ui/src/app.css`, ensure the embedded root and compare chain bound height. Add (adjust the embedded-root selector to whatever the inspection in Step 1 shows the shell mounts the eval app into; the eval app's own root is `.eval-workspace`):

```css
/* In the combined shell the eval app mounts inside a flex slot; bound its height so .compare-stack scrolls
   internally instead of the whole Context list growing the page. */
.eval-workspace {
  min-height: 0;
}
.compare-stack {
  flex: 1 1 auto;
}
```

If Step 1 shows the embedded mount wrapper (not `.eval-workspace`) is the unbounded element, add a `min-height: 0; height: 100%;` rule for that wrapper selector instead, and document the selector in a comment.

- [ ] **Step 3: Verify in tangent ui**

Rebuild and re-verify:

```bash
npm run build && node scripts/verify-app.mjs ui
```

Confirm the Context files list now scrolls within the panel, the header (config pickers, verdict/score) stays put, and no horizontal overflow appears. Kill the verify server when done.

- [ ] **Step 4: Commit**

```bash
git add packages/eval-ui/src/app.css
git commit -m "fix(eval-ui): scroll the compare body within the panel instead of growing the page"
```

---

### Task 8: Documentation

**Files:**
- Modify: `packages/eval/docs/index.md`, `packages/eval/docs/architecture.md`, `packages/eval/docs/public-api.md`
- Modify: `packages/eval-ui/docs/index.md`, `packages/eval-ui/docs/architecture.md`

**Interfaces:**
- Consumes: the modules and endpoints from Tasks 1-6.
- Produces: updated docs.

- [ ] **Step 1: Update eval docs**

In `packages/eval/docs/index.md` and `docs/architecture.md`, add a "Context assembly" subsection: the `context-assembly.ts` engine reconstructs repo-contributed agent context (CLAUDE.md chain root→cwd, `@imports`, skills frontmatter with bodies on load, subagent metadata) over a variant's frozen worktree, exposed read-only at `GET /api/eval/runs/:runId/context/manifest` and `/context/assemble`. In `docs/public-api.md`, list the new exports (`assembleContext`, `contextManifest`, and the types) and the two endpoints with their query params.

- [ ] **Step 2: Update eval-ui docs**

In `packages/eval-ui/docs/index.md` and `docs/architecture.md`, document the Context section's `Files | Assembled` toggle: Assembled renders both variants' verbatim concatenated context with provenance dividers, cwd and skill controls, difference highlighting, and a copy action, talking to `/api/eval/*/context/*`. Note the boundary: repo-contributed context only (no base system prompt, no user-global, no plugin skills).

- [ ] **Step 3: Commit**

```bash
git add packages/eval/docs packages/eval-ui/docs
git commit -m "docs(eval): document the assembled context builder"
```

---

## Final validation (after all tasks)

Run from the worktree root:

```bash
npm run check
npm run test
npm run governance
npm run build
```

Then verify the whole feature in the combined `tangent ui` (`node scripts/verify-app.mjs ui`): open the `context-vs-no-context-haiku` run, toggle the Context section to Assembled, confirm the repo side shows the verbatim CLAUDE.md chain and skills index while the empty side shows the empty state, change cwd and watch both columns re-assemble, load a skill and see its body appear, confirm the section scrolls, and check the console for errors.
