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
    /** Returns all paths in the fixture map. */
    listFiles: async () => Object.keys(files),
    /** Returns the content for a path, or undefined if absent. */
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
  assert.match(joined, /\[claude-md:CLAUDE\.md\][\s\S]*?tail/);
  assert.match(joined, /not found: missing\.md/);
});

test("expandImports caps depth at 4 and guards cycles", async () => {
  const files = { "a.md": "@b.md", "b.md": "@a.md" }; // cycle
  const blocks = await assembleContext(source({ "CLAUDE.md": "@a.md", ...files }), "", []);
  const text = blocks.blocks.map((block) => block.text).join("\n");
  assert.match(text, /cycle|max import depth/);
});

test("expandImports caps at max depth with a pure chain (no cycle)", async () => {
  const files = {
    "CLAUDE.md": "@a.md",
    "a.md": "a content\n@b.md",
    "b.md": "b content\n@c.md",
    "c.md": "c content\n@d.md",
    "d.md": "d content\n@e.md",
    "e.md": "e content should not appear"
  };
  const result = await assembleContext(source(files), "", []);
  const text = result.blocks.map((block) => block.text).join("\n");
  assert.match(text, /max import depth/);
  assert.ok(!text.includes("e content should not appear"), "e.md content must not appear past depth cap");
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
