import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseAreaCanvas, serializeAreaCanvas } from "./area-canvas.mjs";

const SKIP_DIRECTORIES = new Set([".git", ".obsidian", "node_modules", "shared"]);
const AREA_KEYS = new Set(["area", "child", "owner", "parent"]);

/** Returns path changes in longest-source-first order. */
function orderedChanges(changedPaths) {
  return [...changedPaths].sort((left, right) => right.from.length - left.from.length || left.from.localeCompare(right.from));
}

/** Rewrites one Area key through the complete explicit move table. */
export function remapAreaPath(area, changedPaths) {
  if (typeof area !== "string") return area;
  for (const change of orderedChanges(changedPaths)) {
    if (area === change.from) return change.to;
    if (area.startsWith(`${change.from}/`)) return `${change.to}${area.slice(change.from.length)}`;
  }
  return area;
}

/** Rewrites one vault reference while preserving its subpath suffix. */
function remapReference(reference, changedPaths) {
  if (typeof reference !== "string" || /^(?:https?:|mailto:)/.test(reference)) return reference;
  const hash = reference.indexOf("#");
  const file = hash < 0 ? reference : reference.slice(0, hash);
  const suffix = hash < 0 ? "" : reference.slice(hash);
  for (const change of orderedChanges(changedPaths)) {
    const oldLeaf = path.posix.basename(change.from);
    const newLeaf = path.posix.basename(change.to);
    for (const extension of [".md", ".excalidraw"]) {
      if (file === `${change.from}/${oldLeaf}${extension}`) return `${change.to}/${newLeaf}${extension}${suffix}`;
    }
  }
  return `${remapAreaPath(file, changedPaths)}${suffix}`;
}

/** Rewrites only semantic Area owners and vault references in nested metadata. */
function rewriteMetadata(value, changedPaths, key = "") {
  if (Array.isArray(value)) return value.map((item) => rewriteMetadata(item, changedPaths));
  if (!value || typeof value !== "object") {
    if (AREA_KEYS.has(key)) return remapAreaPath(value, changedPaths);
    if (key === "ref") return remapReference(value, changedPaths);
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, rewriteMetadata(child, changedPaths, childKey)]));
}

/** Rewrites map references while preserving every source element ID and coordinate. */
export function rewriteAreaMapSceneForMove(scene, changedPaths) {
  return {
    ...scene,
    elements: (scene.elements ?? []).map((element) => {
      const next = { ...element };
      if (element.customData) next.customData = rewriteMetadata(element.customData, changedPaths);
      return next;
    }),
  };
}

/** Lists every canonical or migration-source Excalidraw file in the vault. */
async function areaMapFiles(root) {
  const files = [];
  /** Walks one safe vault directory. */
  async function walk(directory, relative = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !SKIP_DIRECTORIES.has(entry.name)) await walk(path.join(directory, entry.name), relative ? `${relative}/${entry.name}` : entry.name);
      } else if (entry.isFile() && entry.name.endsWith(".excalidraw")) {
        files.push(relative ? `${relative}/${entry.name}` : entry.name);
      }
    }
  }
  await walk(root);
  return files.sort();
}

/** Renames canonical shard files and updates explicit owners after an Area move. */
export async function applyAreaMoveToMaps({ treesRoot, changedPaths, runGit }) {
  const renamed = [];
  for (const change of changedPaths) {
    const oldLeaf = path.posix.basename(change.from);
    const newLeaf = path.posix.basename(change.to);
    if (oldLeaf === newLeaf) continue;
    const from = `${change.to}/${oldLeaf}.excalidraw`;
    const to = `${change.to}/${newLeaf}.excalidraw`;
    try {
      await readFile(path.join(treesRoot, from), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    await runGit(["mv", "--", from, to], async () => rename(path.join(treesRoot, from), path.join(treesRoot, to)));
    renamed.push(from, to);
  }

  const rewritten = [];
  for (const file of await areaMapFiles(treesRoot)) {
    const absolute = path.join(treesRoot, file);
    const parsed = parseAreaCanvas(await readFile(absolute, "utf8"));
    if (!parsed.ok) continue;
    const next = rewriteAreaMapSceneForMove(parsed.scene, changedPaths);
    const before = serializeAreaCanvas(parsed.scene);
    const after = serializeAreaCanvas(next);
    if (before === after) continue;
    await writeFile(absolute, after, "utf8");
    rewritten.push(file);
  }
  return [...new Set([...renamed, ...rewritten])].sort();
}

export default { applyAreaMoveToMaps, remapAreaPath, rewriteAreaMapSceneForMove };
