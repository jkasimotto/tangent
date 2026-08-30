import { lstat, readFile, readdir, rename, writeFile } from "node:fs/promises";
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
  if (Array.isArray(value)) return value.map((item) => key === "overlapWith" ? remapAreaPath(item, changedPaths) : rewriteMetadata(item, changedPaths));
  if (!value || typeof value !== "object") {
    if (AREA_KEYS.has(key)) return remapAreaPath(value, changedPaths);
    if (key === "ref") return remapReference(value, changedPaths);
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, rewriteMetadata(child, changedPaths, childKey)]));
}

/** Returns the Area key encoded by one canonical structural-region reference. */
function regionChild(reference) {
  if (typeof reference !== "string") return null;
  const file = reference.split("#", 1)[0];
  const extension = path.posix.extname(file);
  if (![".md", ".excalidraw"].includes(extension)) return null;
  const area = path.posix.dirname(file);
  if (area === "." || path.posix.basename(file, extension) !== path.posix.basename(area)) return null;
  return area;
}

/** Clears overlap permissions that no longer connect direct sibling Areas. */
function retainSiblingOverlaps(customData) {
  const tangent = customData?.tangent;
  if (tangent?.kind !== "area" || tangent.role !== "region" || !Array.isArray(tangent.layout?.overlapWith)) return customData;
  const child = regionChild(tangent.ref);
  const owner = child && path.posix.dirname(child);
  const overlapWith = tangent.layout.overlapWith.filter((peer) => typeof peer === "string"
    && peer !== child && owner !== null && path.posix.dirname(peer) === owner);
  return { ...customData, tangent: { ...tangent, layout: { ...tangent.layout, overlapWith } } };
}

/** Returns one moved file's destination, including canonical leaf-name changes. */
function movedFilePath(file, preview) {
  let moved = `${preview.destination}${file.slice(preview.source.length)}`;
  for (const change of orderedChanges(preview.changedPaths)) {
    const oldLeaf = path.posix.basename(change.from);
    const newLeaf = path.posix.basename(change.to);
    for (const extension of [".md", ".excalidraw"]) {
      if (moved === `${change.to}/${oldLeaf}${extension}`) moved = `${change.to}/${newLeaf}${extension}`;
    }
  }
  return moved;
}

/** Returns the Git file mode needed by one exact target. */
async function fileMode(file) {
  const metadata = await lstat(file);
  if (!metadata.isFile()) throw new Error(`Area moves do not support symbolic or special files: ${file}`);
  return metadata.mode & 0o111 ? "100755" : "100644";
}

/** Lists every exact source file and the directory shape guarded during prepare. */
async function sourceTree(root, source) {
  const files = [];
  const directories = [source];
  const entries = [];
  /** Walks one Area subtree without following symbolic links. */
  async function walk(directory, relative = "") {
    const values = await readdir(path.join(root, directory), { withFileTypes: true });
    for (const entry of values.sort((left, right) => left.name.localeCompare(right.name))) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        entries.push(`d:${child}`); directories.push(file); await walk(file, child);
      } else {
        if (!entry.isFile()) throw new Error(`Area moves do not support symbolic or special files: ${file}`);
        entries.push(`f:${child}`); files.push(file);
      }
    }
  }
  await walk(source);
  return { directories, entries, files };
}

/** Rewrites map references while preserving every source element ID and coordinate. */
export function rewriteAreaMapSceneForMove(scene, changedPaths) {
  return {
    ...scene,
    elements: (scene.elements ?? []).map((element) => {
      const next = { ...element };
      if (element.customData) next.customData = retainSiblingOverlaps(rewriteMetadata(element.customData, changedPaths));
      return next;
    }),
  };
}

/** Builds exact binary-safe targets for one journaled Area directory move. */
export async function prepareAreaMoveTransaction({ treesRoot, preview }) {
  const source = await sourceTree(treesRoot, preview.source);
  const targets = [];
  const mapChangedPaths = new Set();
  for (const file of source.files) {
    const absolute = path.join(treesRoot, file);
    const oldContent = await readFile(absolute);
    const destination = movedFilePath(file, preview);
    let newContent = oldContent;
    if (file.endsWith(".excalidraw")) {
      const parsed = parseAreaCanvas(oldContent.toString("utf8"));
      if (parsed.ok) newContent = Buffer.from(serializeAreaCanvas(rewriteAreaMapSceneForMove(parsed.scene, preview.changedPaths)));
      mapChangedPaths.add(file); mapChangedPaths.add(destination);
    }
    const mode = await fileMode(absolute);
    targets.push({ file, oldContent, newContent: null, mode });
    targets.push({ file: destination, oldContent: null, newContent, mode });
  }
  for (const file of await areaMapFiles(treesRoot)) {
    if (file === preview.source || file.startsWith(`${preview.source}/`)) continue;
    const absolute = path.join(treesRoot, file);
    const oldContent = await readFile(absolute);
    const parsed = parseAreaCanvas(oldContent.toString("utf8"));
    if (!parsed.ok) continue;
    const newContent = Buffer.from(serializeAreaCanvas(rewriteAreaMapSceneForMove(parsed.scene, preview.changedPaths)));
    if (oldContent.equals(newContent)) continue;
    targets.push({ file, oldContent, newContent, mode: await fileMode(absolute) });
    mapChangedPaths.add(file);
  }
  return {
    targets,
    cleanupDirectories: source.directories,
    directoryGuards: [{ source: preview.source, destination: preview.destination, entries: source.entries }],
    message: `update: ${preview.source} moves to ${preview.destination}`,
    result: { ...preview, mapChangedPaths: [...mapChangedPaths].sort() },
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

export default { applyAreaMoveToMaps, prepareAreaMoveTransaction, remapAreaPath, rewriteAreaMapSceneForMove };
