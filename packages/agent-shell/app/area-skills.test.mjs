import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseSkillNote, projectSkills, readAreaSkills, routeSkills, skillLine, skillSlugFromFile } from "./area-skills.mjs";

test("a skill note reads name and description from frontmatter", () => {
  const skill = parseSkillNote("---\nname: rebase-staging\ndescription: Rebase the staging branch before a release.\n---\n\n# Rebase\n\nSteps.\n", { file: "otto/dnd/skill-rebase.md", area: "otto/dnd", path: "/vault/otto/dnd/skill-rebase.md" });
  assert.equal(skill.name, "rebase-staging");
  assert.equal(skill.description, "Rebase the staging branch before a release.");
  assert.equal(skillLine(skill), "- rebase-staging: Rebase the staging branch before a release. (/vault/otto/dnd/skill-rebase.md)");
});

test("name defaults to the slug and description to the first body line", () => {
  const skill = parseSkillNote("---\ntype: skill\n---\n\n# Rebase the branch\n\nMore.\n", { file: "otto/dnd/skill-rebase.md", area: "otto/dnd" });
  assert.equal(skill.name, "rebase");
  assert.equal(skill.description, "Rebase the branch");
  const bare = parseSkillNote("Just do it.\n", { file: "otto/dnd/skill-do-it.md", area: "otto/dnd" });
  assert.equal(bare.name, "do-it");
  assert.equal(bare.description, "Just do it.");
  assert.equal(skillSlugFromFile("otto/dnd/goal-x.md"), null);
  assert.equal(skillSlugFromFile("otto/dnd/skill-x.md"), "x");
});

test("route skills use canonical agent folders and keep legacy notes compatible", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-skills-"));
  const trees = path.join(root, "trees");
  await mkdir(path.join(trees, "otto", "dnd"), { recursive: true });
  await mkdir(path.join(trees, ".agents", "skills", "remember"), { recursive: true });
  await mkdir(path.join(trees, "otto", ".agents", "skills", "review"), { recursive: true });
  await mkdir(path.join(trees, "otto", "dnd", ".agents", "skills", "build"), { recursive: true });
  await writeFile(path.join(trees, ".agents", "skills", "remember", "SKILL.md"), "---\ndescription: Save durable knowledge.\n---\nSteps.\n", "utf8");
  await writeFile(path.join(trees, "otto", ".agents", "skills", "review", "SKILL.md"), "---\nname: review\ndescription: Review the canonical change.\n---\nSteps.\n", "utf8");
  await writeFile(path.join(trees, "otto", "dnd", ".agents", "skills", "build", "SKILL.md"), "Build the game.\n", "utf8");
  await writeFile(path.join(trees, "otto", "skill-review.md"), "---\nname: review\ndescription: Review a change.\n---\nBody.\n", "utf8");
  await writeFile(path.join(trees, "otto", "dnd", "skill-b.md"), "---\ndescription: Second.\n---\nBody.\n", "utf8");
  await writeFile(path.join(trees, "otto", "dnd", "skill-a.md"), "First body line.\n", "utf8");
  await writeFile(path.join(trees, "otto", "dnd", "process-x.md"), "---\ntype: process\n---\nNot a skill.\n", "utf8");
  const route = await routeSkills(trees, "otto/dnd");
  assert.deepEqual(route.map((skill) => [skill.area, skill.name, skill.description]), [
    ["", "remember", "Save durable knowledge."],
    ["otto", "review", "Review the canonical change."],
    ["otto/dnd", "build", "Build the game."],
    ["otto/dnd", "a", "First body line."],
    ["otto/dnd", "b", "Second."],
  ]);
  assert.equal(route[1].path, path.join(trees, "otto", ".agents", "skills", "review", "SKILL.md"));
  assert.deepEqual(await readAreaSkills(trees, "otto/none"), []);

  const repo = path.join(root, "repo");
  await mkdir(path.join(repo, ".claude", "skills", "deploy"), { recursive: true });
  await mkdir(path.join(repo, ".agents", "skills", "lint"), { recursive: true });
  await mkdir(path.join(repo, ".agents", "skills", "empty"), { recursive: true });
  await writeFile(path.join(repo, ".claude", "skills", "deploy", "SKILL.md"), "---\nname: deploy\ndescription: Deploy the app.\n---\nSteps.\n", "utf8");
  await writeFile(path.join(repo, ".agents", "skills", "lint", "SKILL.md"), "Run the linter.\n", "utf8");
  const project = await projectSkills(repo);
  assert.deepEqual(project.map((skill) => [skill.name, skill.description, skill.path]), [
    ["deploy", "Deploy the app.", path.join(repo, ".claude", "skills", "deploy", "SKILL.md")],
    ["lint", "Run the linter.", path.join(repo, ".agents", "skills", "lint", "SKILL.md")],
  ]);
  assert.deepEqual(await projectSkills(null), []);
  assert.deepEqual(await projectSkills(path.join(root, "missing")), []);
});
