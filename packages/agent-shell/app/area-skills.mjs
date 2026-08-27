// A skill is a note: `<area>/skill-<slug>.md` (D20). Its frontmatter carries
// `name:` and `description:` in the shape of a harness SKILL.md, and its body
// says what to do. A brain sees every skill on the route from the vault root
// to its Area through `tangent area show`, together with the project skills
// of the bound repository, and hands one to a worker with `--source` or by
// naming its path. This module reads and lists them; it keeps no state.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { areaAncestors } from "./area-agent-command.mjs";
import { splitFrontmatter } from "./process-note.mjs";

/** The two project skill folders a harness reads under a repository. */
const PROJECT_SKILL_FOLDERS = [".claude/skills", ".agents/skills"];

/** The slug of a skill note file, or null when the name is not `skill-<slug>.md`. */
export function skillSlugFromFile(file) {
  const match = String(file ?? "").split("/").pop()?.match(/^skill-([a-z0-9][a-z0-9-]*)\.md$/i);
  return match ? match[1] : null;
}

/** The first non-empty body line, without a leading Markdown heading marker. */
function firstBodyLine(body) {
  const line = String(body ?? "").split("\n").map((item) => item.trim()).find(Boolean) ?? "";
  return line.replace(/^#+\s*/, "");
}

/**
 * Parses one skill note. `name` defaults to the file slug and `description`
 * to the first body line, so a note with no frontmatter still lists.
 */
export function parseSkillNote(text, { file, area, path: absolute = null, slug = null }) {
  const { fields, body } = splitFrontmatter(text);
  const fallbackSlug = slug ?? skillSlugFromFile(file) ?? String(file ?? "").split("/").pop()?.replace(/\.md$/i, "") ?? "";
  return {
    file, area, path: absolute,
    name: fields.name || fallbackSlug,
    description: fields.description || firstBodyLine(body),
  };
}

/** Reads every skill note of one Area, by file name. */
export async function readAreaSkills(treesRoot, area) {
  let entries = [];
  try { entries = await readdir(path.join(treesRoot, area)); } catch { return []; }
  const skills = [];
  for (const name of entries.filter((entry) => skillSlugFromFile(entry)).sort()) {
    const file = `${area}/${name}`;
    const absolute = path.join(treesRoot, file);
    let text = "";
    try { text = await readFile(absolute, "utf8"); } catch { continue; }
    skills.push(parseSkillNote(text, { file, area, path: absolute }));
  }
  return skills;
}

/** Every skill on the route from the vault root to one Area, root first. */
export async function routeSkills(treesRoot, area) {
  const skills = [];
  for (const candidate of areaAncestors(area).reverse()) skills.push(...await readAreaSkills(treesRoot, candidate));
  return skills;
}

/** The `<folder>/<name>/SKILL.md` files under one project skill folder, by name. */
async function skillFilesUnder(folder) {
  let entries = [];
  try { entries = await readdir(folder, { withFileTypes: true }); } catch { return []; }
  return entries.filter((entry) => entry.isDirectory() || entry.isSymbolicLink()).map((entry) => entry.name).sort()
    .map((name) => ({ slug: name, path: path.join(folder, name, "SKILL.md") }));
}

/**
 * The bound repository's own project skills: `.claude/skills/<name>/SKILL.md`
 * and `.agents/skills/<name>/SKILL.md`. A missing repository lists nothing.
 */
export async function projectSkills(repository) {
  if (!repository) return [];
  const skills = [];
  for (const folder of PROJECT_SKILL_FOLDERS) {
    for (const item of await skillFilesUnder(path.join(repository, folder))) {
      let text;
      try { text = await readFile(item.path, "utf8"); } catch { continue; }
      skills.push(parseSkillNote(text, { file: path.relative(repository, item.path), area: null, path: item.path, slug: item.slug }));
    }
  }
  return skills;
}

/** One line of the `Skills` section of `tangent area show`. */
export function skillLine(skill) {
  return `- ${skill.name}: ${skill.description} (${skill.path})`;
}
