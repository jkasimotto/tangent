import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { areaNoteTemplate } from "./area-note-links.mjs";

const RESERVED = new Set(["shared", ".git", ".obsidian", "node_modules"]);

/** Converts a visible area name into its directory name. */
export function areaSlug(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Validates one vault-relative area path and returns its clean form. */
export function cleanAreaPath(value, { allowEmpty = false } = {}) {
  const clean = String(value ?? "").replace(/^\/+|\/+$/g, "");
  if (!clean && allowEmpty) return "";
  const parts = clean.split("/");
  if (!clean || parts.some((part) => !part || part === "." || part === ".." || part.startsWith("."))) {
    throw new Error("Choose a valid area.");
  }
  return clean;
}

/** Resolves an Area beneath the vault and rejects path escapes. */
export function absoluteAreaPath(treesRoot, area) {
  const clean = cleanAreaPath(area);
  const absolute = path.resolve(treesRoot, clean);
  const root = `${path.resolve(treesRoot)}${path.sep}`;
  if (!absolute.startsWith(root)) throw new Error("The area path leaves the Tangent vault.");
  return absolute;
}

/** Lists an Area and every descendant Area path. */
export async function descendantAreaPaths(treesRoot, area) {
  const clean = cleanAreaPath(area);
  const out = [];
  /** Walks one known area directory. */
  const walk = async (current) => {
    out.push(current);
    const entries = await readdir(absoluteAreaPath(treesRoot, current), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || RESERVED.has(entry.name) || entry.name.startsWith(".")) continue;
      await walk(`${current}/${entry.name}`);
    }
  };
  await walk(clean);
  return out;
}

/** Creates one tracked area below an existing parent. */
export async function createArea({ treesRoot, parent, name }) {
  const cleanParent = cleanAreaPath(parent);
  if (!existsSync(absoluteAreaPath(treesRoot, cleanParent))) throw new Error("The containing Area no longer exists.");
  const slug = areaSlug(name);
  if (!slug || RESERVED.has(slug)) throw new Error("Use an Area name with letters or numbers.");
  const area = `${cleanParent}/${slug}`;
  const absolute = absoluteAreaPath(treesRoot, area);
  if (existsSync(absolute)) throw new Error(`“${area}” already exists.`);
  await mkdir(absolute);
  await writeFile(path.join(absolute, ".gitkeep"), "", "utf8");
  const title = String(name ?? "").trim();
  const note = `${area}/${slug}.md`;
  await writeFile(path.join(treesRoot, note), areaNoteTemplate(title), "utf8");
  return { area, note, changedPaths: [`${area}/.gitkeep`, note] };
}

/** Builds the exact area-path preview for a rename or move. */
export async function previewAreaMove({ treesRoot, area, parent, name }) {
  const source = cleanAreaPath(area);
  const destinationParent = cleanAreaPath(parent);
  if (source.split("/").length < 2) throw new Error("The root area groups cannot move.");
  if (!existsSync(absoluteAreaPath(treesRoot, source))) throw new Error("The area no longer exists.");
  if (!existsSync(absoluteAreaPath(treesRoot, destinationParent))) throw new Error("The new containing Area no longer exists.");
  if (destinationParent === source || destinationParent.startsWith(`${source}/`)) {
    throw new Error("An Area cannot move inside itself.");
  }
  const slug = areaSlug(name || path.basename(source));
  if (!slug || RESERVED.has(slug)) throw new Error("Use an Area name with letters or numbers.");
  const destination = `${destinationParent}/${slug}`;
  if (destination !== source && existsSync(absoluteAreaPath(treesRoot, destination))) {
    throw new Error(`“${destination}” already exists.`);
  }
  const sources = await descendantAreaPaths(treesRoot, source);
  return {
    source,
    destination,
    changedPaths: sources.map((item) => ({ from: item, to: `${destination}${item.slice(source.length)}` })),
  };
}

/** Moves one area directory and keeps its canonical note name aligned. */
export async function moveArea({ treesRoot, area, parent, name, runGit }) {
  const preview = await previewAreaMove({ treesRoot, area, parent, name });
  if (preview.source === preview.destination) return preview;
  const oldBase = path.basename(preview.source);
  const newBase = path.basename(preview.destination);
  await runGit(["mv", "--", preview.source, preview.destination], async () => {
    await rename(absoluteAreaPath(treesRoot, preview.source), absoluteAreaPath(treesRoot, preview.destination));
  });
  if (oldBase !== newBase) {
    const oldNote = `${preview.destination}/${oldBase}.md`;
    const newNote = `${preview.destination}/${newBase}.md`;
    if (existsSync(absoluteAreaPath(treesRoot, oldNote))) {
      await runGit(["mv", "--", oldNote, newNote], async () => {
        await rename(absoluteAreaPath(treesRoot, oldNote), absoluteAreaPath(treesRoot, newNote));
      });
    }
  }
  return preview;
}

/** Returns true when git reports edits inside one area subtree. */
export async function areaHasGitChanges({ treesRoot, area, runGitCapture }) {
  const clean = cleanAreaPath(area);
  const output = await runGitCapture(["status", "--porcelain", "--", clean]);
  return output.trim().length > 0;
}
