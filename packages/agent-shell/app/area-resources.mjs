// One parser for the `## Resources` section of an Area note, and the one
// resolver that turns it into the folder a worker starts in. Three parsers
// used to disagree on backticks, the leading dash, and annotated lines, so a
// binding that one reader accepted was invisible to another. Everything that
// needs an Area's folder (workers, brains, programs, `tangent area show`)
// reads through this module.

import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { areaAncestors } from "./area-agent-command.mjs";

/** The three resource lines an Area note may declare, in the order they are reported. */
export const AREA_RESOURCE_LABELS = ["Repository", "Worktree", "Branch"];

/** The `## Resources` section of one note, or an empty string when the note has none. */
function resourcesSection(noteText) {
  return String(noteText ?? "").split(/^## /m).find((section) => /^Resources\b/.test(section)) ?? "";
}

/**
 * Reads one labelled value from the Resources section. The line may or may
 * not start with `- `, the value may sit in backticks, and a trailing
 * ` (annotation)` after the value is ignored, so a note that says
 * `- Worktree: /x/y (tracks origin/main)` still binds `/x/y`.
 */
function resourceValue(section, label) {
  const line = new RegExp(`^\\s*(?:-\\s*)?${label}\\s*:\\s*\`?([^\`\\n]*?)\`?\\s*(?:\\s\\(.*)?$`, "im");
  const match = section.match(line);
  const value = match?.[1].trim() ?? "";
  return value || null;
}

/** Expands a leading `~` to the home directory; other values pass through. */
function expandHome(value) {
  return value ? value.replace(/^~(?=\/|$)/, os.homedir()) : null;
}

/**
 * Parses the `## Resources` section of an Area note into its three resource
 * lines. Paths get `~` expanded; a branch name is kept verbatim. A missing
 * line is null.
 */
export function parseAreaResources(noteText) {
  const section = resourcesSection(noteText);
  return {
    repository: expandHome(resourceValue(section, "Repository")),
    worktree: expandHome(resourceValue(section, "Worktree")),
    branch: resourceValue(section, "Branch"),
  };
}

/** The absolute path of one Area's note inside the vault. */
export function areaNotePath(treesRoot, area) {
  const clean = String(area ?? "").replace(/^\/+|\/+$/g, "");
  return path.join(treesRoot, clean, `${clean.split("/").pop()}.md`);
}

/** Reads one note from disk; a missing note reads as null. */
async function readNoteFromDisk(file) {
  return readFile(file, "utf8").catch(() => null);
}

/** True when the folder is the vault root or sits inside it. */
function insideVault(folder, treesRoot) {
  const relative = path.relative(path.resolve(treesRoot), path.resolve(folder));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** True when the value is an absolute path to an existing directory. */
function existingDirectory(folder) {
  if (!folder || !path.isAbsolute(folder) || !existsSync(folder)) return false;
  try {
    return statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The resources an Area sees, each with the Area that declares it: the
 * nearest declaration wins, walking from the Area to the vault root. The
 * brain prompt and `tangent area show` print the Area beside each value so
 * a reader knows whether a parent bound the folder. Says nothing about
 * whether a path exists; resolveWorkFolder does that.
 */
export async function describeAreaResources(treesRoot, area, readNote = readNoteFromDisk) {
  const seen = { repository: null, worktree: null, branch: null };
  for (const candidate of areaAncestors(area)) {
    const note = await readNote(areaNotePath(treesRoot, candidate));
    if (note == null) continue;
    const declared = parseAreaResources(note);
    for (const key of Object.keys(seen)) {
      if (!seen[key] && declared[key]) seen[key] = { value: declared[key], area: candidate };
    }
  }
  return seen;
}

/** The three resource values an Area sees, without the Areas they come from. */
export async function inheritedAreaResources(treesRoot, area, readNote = readNoteFromDisk) {
  const described = await describeAreaResources(treesRoot, area, readNote);
  return Object.fromEntries(Object.entries(described).map(([key, item]) => [key, item?.value ?? null]));
}

/**
 * The folder a worker for this Area starts in: the first `Worktree` or
 * `Repository` line, nearest Area first, that names an absolute existing
 * directory. Returns `{ cwd, source: "area:<area>", branch }` naming the
 * Area that declared the folder and the nearest declared Branch, or null
 * when the Area and its ancestors bind nothing.
 *
 * A binding that points inside the vault counts only on the exact Area
 * being resolved: an Area that does document-only work may declare its own
 * vault folder as its repository, but that choice never inherits to its
 * children, which would otherwise silently work inside the vault again.
 */
export async function resolveWorkFolder(treesRoot, area, readNote = readNoteFromDisk) {
  for (const candidate of areaAncestors(area)) {
    const note = await readNote(areaNotePath(treesRoot, candidate));
    if (note == null) continue;
    const declared = parseAreaResources(note);
    for (const folder of [declared.worktree, declared.repository]) {
      if (!existingDirectory(folder)) continue;
      if (candidate !== area && insideVault(folder, treesRoot)) continue;
      const { branch } = await inheritedAreaResources(treesRoot, area, readNote);
      return { cwd: folder, source: `area:${candidate}`, branch };
    }
  }
  return null;
}

/**
 * The refusal text for an Area that binds no folder. It names the note to
 * edit and the exact line to add, so a brain that reads the error can fix
 * the Area without a second lookup. pathHint adds the escape hatch for
 * callers that accept `--path`.
 */
export function unboundAreaMessage(treesRoot, area, { pathHint = true } = {}) {
  const note = areaNotePath(treesRoot, area);
  const fix = `Add "- Repository: <path>" under ## Resources in ${note}`;
  return `${area} and its parent Areas bind no repository. ${fix}${pathHint ? ", or pass --path." : "."}`;
}
