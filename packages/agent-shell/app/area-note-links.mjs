// The Area note is the brain's instruction file (ADR-0041). Each Area folder
// carries `AGENTS.md -> <dirname>.md` and `CLAUDE.md -> AGENTS.md` as
// relative symlinks, and the vault root carries a real `AGENTS.md` that says
// how to be a brain, with `CLAUDE.md -> AGENTS.md` beside it. The harness a
// brain runs in reads that chain itself, root first. Pure file work: the
// server commits what changed through the vault repository.
//
// Tangent never writes into an Area note. Ideas go to `ideas.md` in the Area
// folder, and a Goal is only its `goal-<slug>.md` file.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, lstat, mkdir, readFile, readlink, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const KNOWN_ROOT_AGENTS_SHA256 = new Set([
  "ccdb0bea5e2062651bd59b959541fc5b63a3ffe8edd52dca492ba498e75ca6e3",
  "a33774d85bed7b636db43925e50583691ede9898397924f3df723656013163c0",
  "bab789f8f60d1f0269cd7ea095be7234fcf2267607b8a4713a0603ea3c99cfb0",
  "14dfde36d20ba15569e0808a1ff622748b9c258db7e14335b827636d757332a7",
  "9432e7e2fd709684ea6d826b8a814f3962bf6fd1b09ddc7c946a5f16678cb3ca",
]);

/** The text of the vault root AGENTS.md this build ships, for a vault that has none. */
export async function vaultRootAgentsText() {
  return readFile(path.join(here, "vault-root-AGENTS.md"), "utf8");
}

/** The note an Area gets when it has none: the template from docs/design/area-note-as-system-prompt/vision.md. */
export function areaNoteTemplate(title) {
  return `---\ntype: area\nstatus: active\n---\n# ${String(title ?? "").trim()}\n## Purpose\n\n## Knowledge\n\n## Current\n\n## Ideas and open questions\n`;
}

/** The vault-relative note file of one Area. */
export function areaNotePath(area) {
  const leaf = String(area).split("/").filter(Boolean).pop();
  return `${area}/${leaf}.md`;
}

/** A human title from an Area's directory name. */
export function areaTitle(area) {
  const leaf = String(area).split("/").filter(Boolean).pop() ?? "";
  return leaf.split("-").filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}

/**
 * Makes one relative symlink when nothing is at the path. A real file, or a
 * symlink to somewhere else, is never replaced: a note Julian wrote by that
 * name stays his. Returns the vault-relative path when a link was made.
 */
async function ensureLink(absoluteDir, name, target) {
  const file = path.join(absoluteDir, name);
  const exists = await lstat(file).then(() => true, () => false);
  if (exists) return null;
  await symlink(target, file);
  return name;
}

/** True when `name` in the folder is a symlink to `target`. */
export async function linkPointsTo(absoluteDir, name, target) {
  try {
    return (await readlink(path.join(absoluteDir, name))) === target;
  } catch {
    return false;
  }
}

/**
 * Gives one Area its note, instruction links, and Claude's link to the
 * canonical `.agents/skills` folder. Idempotent.
 */
export async function ensureAreaNoteLinks({ treesRoot, area }) {
  const absoluteDir = path.join(treesRoot, area);
  const noteName = path.basename(areaNotePath(area));
  const changed = [];
  const note = path.join(absoluteDir, noteName);
  if (!existsSync(note)) {
    await writeFile(note, areaNoteTemplate(areaTitle(area)), "utf8");
    changed.push(areaNotePath(area));
  }
  for (const [name, target] of [["AGENTS.md", noteName], ["CLAUDE.md", "AGENTS.md"]]) {
    const made = await ensureLink(absoluteDir, name, target);
    if (made) changed.push(`${area}/${made}`);
  }
  const claudeDir = path.join(absoluteDir, ".claude");
  await mkdir(claudeDir, { recursive: true });
  const skillsLink = await ensureLink(claudeDir, "skills", "../.agents/skills");
  if (skillsLink) changed.push(`${area}/.claude/${skillsLink}`);
  return changed;
}

/**
 * Gives the vault root its real AGENTS.md and the CLAUDE.md link beside it.
 * Returns the vault-relative paths it wrote.
 */
export async function ensureVaultRootLinks({ treesRoot, agentsText }) {
  const changed = [];
  const agents = path.join(treesRoot, "AGENTS.md");
  if (!existsSync(agents)) {
    await writeFile(agents, agentsText, "utf8");
    changed.push("AGENTS.md");
  } else {
    const current = await readFile(agents, "utf8");
    const currentHash = createHash("sha256").update(current).digest("hex");
    if (KNOWN_ROOT_AGENTS_SHA256.has(currentHash) && current !== agentsText) {
      await writeFile(agents, agentsText, "utf8");
      changed.push("AGENTS.md");
    }
  }
  const made = await ensureLink(treesRoot, "CLAUDE.md", "AGENTS.md");
  if (made) changed.push(made);
  const claudeDir = path.join(treesRoot, ".claude");
  await mkdir(claudeDir, { recursive: true });
  const skillsLink = await ensureLink(claudeDir, "skills", "../.agents/skills");
  if (skillsLink) changed.push(`.claude/${skillsLink}`);
  return changed;
}

/**
 * Removes the machine-written `## Goals` section from an Area note: the
 * heading and its lines up to the next `## ` heading. Every other line stays
 * byte for byte. Returns the same text when there is no such section.
 */
export function removeGoalsSection(text) {
  const source = String(text ?? "");
  const match = /^## Goals[ \t]*\r?\n/m.exec(source);
  if (!match) return { text: source, changed: false };
  const start = match.index;
  const rest = source.slice(start + match[0].length);
  const next = /^## /m.exec(rest);
  const end = next ? start + match[0].length + next.index : source.length;
  return { text: source.slice(0, start) + source.slice(end), changed: true };
}

/** One named `## ` section's text, without the heading, trimmed. */
export function noteSectionText(text, name) {
  const source = String(text ?? "");
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^## ${escaped}[ \\t]*$`, "m").exec(source);
  if (!heading) return "";
  const rest = source.slice(heading.index + heading[0].length).replace(/^\r?\n/, "");
  const next = /^## /m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

export const NOTE_LINE_GUIDE = 100;
export const CURRENT_AGE_GUIDE_DAYS = 14;

/**
 * The read-only signal beside an Area note: how long it is and how old its
 * Current section is. `currentChangedAt` is the epoch ms of the commit that
 * last rewrote Current, or null when git does not know. Warning past the
 * guide either way.
 */
export function noteSignal(text, currentChangedAt = null, now = Date.now()) {
  const source = String(text ?? "");
  const lines = source ? source.replace(/\n$/, "").split("\n").length : 0;
  const current = noteSectionText(source, "Current");
  const days = current && currentChangedAt ? Math.max(0, Math.floor((now - currentChangedAt) / 86_400_000)) : null;
  const warning = lines > NOTE_LINE_GUIDE || (days !== null && days > CURRENT_AGE_GUIDE_DAYS);
  const text_ = `${lines} ${lines === 1 ? "line" : "lines"}${current ? ` · Current ${days === null ? "age unknown" : `${days} ${days === 1 ? "day" : "days"} old`}` : " · no Current"}`;
  return { lines, currentDays: days, warning, text: text_ };
}

/** A stable key for one note's Current text, so a git lookup can be cached. */
export function currentSectionKey(text) {
  return createHash("sha256").update(noteSectionText(text, "Current")).digest("hex");
}

/** The ideas file of one Area. */
export function ideasFilePath(area) {
  return `${area}/ideas.md`;
}

/** Appends one idea line to the Area's ideas.md, creating it with a heading. */
export async function appendIdea({ treesRoot, area, text }) {
  const file = path.join(treesRoot, ideasFilePath(area));
  const line = String(text ?? "").replace(/\s*\n\s*/g, " ").trim();
  if (!line) throw new Error("describe the idea before you save it");
  if (!existsSync(file)) await writeFile(file, "# Ideas\n\n", "utf8");
  await appendFile(file, `- ${line}\n`, "utf8");
  return ideasFilePath(area);
}

/** The idea lines of one ideas.md, in order. */
export function ideasFromFile(text) {
  return String(text ?? "").split("\n")
    .map((line) => line.match(/^-\s+(?:Idea:\s*)?(.+)$/))
    .filter(Boolean)
    .map((match) => match[1].trim());
}

// The order Work shows an Area's Goals in: what runs, what waits for Julian,
// what is open, then the rest, and inside a status the older Goal first.
const STATUS_RANK = new Map([["active", 0], ["verify", 1], ["open", 2], ["waiting", 3], ["parked", 4], ["deferred", 4], ["done", 5], ["dropped", 6]]);

/**
 * Orders Goals by status, then creation time (frontmatter `created`, else the
 * file's birth time), then slug. Goal order no longer comes from the note.
 */
export function orderGoals(goals) {
  /** The creation epoch ms of one Goal, or 0 when nothing records it. */
  const created = (goal) => {
    const fromNote = goal.created ? Date.parse(goal.created) : NaN;
    if (Number.isFinite(fromNote)) return fromNote;
    return Number(goal.birthtime) || 0;
  };
  return [...goals].sort((left, right) =>
    (STATUS_RANK.get(left.status) ?? 3) - (STATUS_RANK.get(right.status) ?? 3)
    || created(left) - created(right)
    || String(left.slug).localeCompare(String(right.slug)));
}
