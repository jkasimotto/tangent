import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { areaCanvasPath, canvasHash, legacyAreaCanvasPath, parseAreaCanvas, parseLegacyAreaCanvas, safeCanvasPath, serializeAreaCanvas } from "./area-canvas.mjs";
import { createEmptyScene } from "./public/area-board-core.js";

/** Creates the vault-backed repository for canonical Area-map scenes. */
export function createAreaCanvasRepository({ root, runGit, commit, reportError = console.error }) {
  let saveQueue = Promise.resolve();
  /** Reads a canonical scene without invoking legacy migration. */
  async function readScene(area) {
    const file = areaCanvasPath(area);
    const safe = file && safeCanvasPath(root, file);
    if (!safe) throw new Error(`unsafe Area path: ${area}`);
    try {
      const text = await readFile(safe.absolute, "utf8");
      const parsed = parseAreaCanvas(text);
      return { area, file, exists: true, hash: canvasHash(text), text, ...parsed };
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  /** Reads the former .canvas for an in-memory preview without writing on open. */
  async function readLegacy(area) {
    const legacyFile = legacyAreaCanvasPath(area);
    const safeLegacy = legacyFile && safeCanvasPath(root, legacyFile);
    if (!safeLegacy) throw new Error(`unsafe Area path: ${area}`);
    let legacyText;
    try { legacyText = await readFile(safeLegacy.absolute, "utf8"); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
    const parsed = parseLegacyAreaCanvas(legacyText);
    if (!parsed.ok) return { area, file: legacyFile, exists: true, hash: canvasHash(legacyText), ok: false, errors: parsed.errors, warnings: [], fallback: "list" };
    const file = areaCanvasPath(area);
    return { area, file, exists: true, canonicalExists: false, hash: null, ok: true, canvas: parsed.canvas, scene: parsed.canvas, errors: [], warnings: [], migrated: true, legacy: { file: legacyFile, absolute: safeLegacy.absolute, text: legacyText } };
  }

  /** Reads a scene and performs the one-time legacy conversion when needed. */
  async function read(area) {
    const current = await readScene(area);
    if (current) return current;
    const converted = await readLegacy(area);
    if (converted) return converted;
    const file = areaCanvasPath(area);
    const canvas = createEmptyScene();
    return { area, file, exists: false, canonicalExists: false, hash: null, ok: true, canvas, scene: canvas, errors: [], warnings: [] };
  }

  /** Saves all files of one map gesture through one conflict check and commit. */
  async function saveManyNow(writes, { operationId = null, session = null, area = writes[0]?.area ?? "" } = {}) {
    const unique = new Map();
    for (const write of writes) {
      if (!write?.area || unique.has(write.area)) throw new Error("a canvas gesture must name each Area once");
      unique.set(write.area, write);
    }
    const prepared = await Promise.all([...unique.values()].map(async (write) => {
      const current = await read(write.area); const text = serializeAreaCanvas(write.canvas); const desiredHash = canvasHash(text);
      return { ...write, current, text, desiredHash, safe: safeCanvasPath(root, current.file), canonicalExists: current.canonicalExists ?? current.exists };
    }));
    const conflicts = prepared.filter((entry) => entry.current.hash !== entry.desiredHash && entry.current.hash !== (entry.baseHash ?? null));
    if (conflicts.length) return { conflict: true, status: 409, operationId, currentHash: conflicts[0].current.hash, currentHashes: Object.fromEntries(conflicts.map((entry) => [entry.area, entry.current.hash])) };
    const changed = prepared.filter((entry) => entry.current.hash !== entry.desiredHash);
    if (!changed.length) return { committed: true, idempotent: true, operationId, hash: prepared.find((entry) => entry.area === area)?.desiredHash ?? null, hashes: Object.fromEntries(prepared.map((entry) => [entry.area, entry.desiredHash])) };
    const newFiles = []; let staged = [];
    try {
      for (const entry of changed) {
        await mkdir(path.dirname(entry.safe.absolute), { recursive: true });
        const temporary = `${entry.safe.absolute}.tangent-${process.pid}-${Date.now()}.tmp`;
        await writeFile(temporary, entry.text, "utf8"); await rename(temporary, entry.safe.absolute);
        if (!entry.canonicalExists) newFiles.push(entry.current.file);
        if (entry.current.legacy) await unlink(entry.current.legacy.absolute);
      }
      staged = [...newFiles, ...changed.flatMap((entry) => entry.current.legacy?.file ?? [])];
      if (staged.length) await runGit(["-C", root, "add", "--", ...staged]);
      const paths = changed.flatMap((entry) => [entry.current.file, ...(entry.current.legacy ? [entry.current.legacy.file] : [])]);
      const descriptions = changed.map((entry) => entry.reason || `${entry.area.split("/").at(-1)} map`);
      const prefix = changed.some((entry) => entry.current.exists) ? "update" : "add";
      const result = await commit(paths, `${prefix}: ${area} spatial map · ${descriptions.join(" · ")}`, area, session);
      if (!result.committed) throw Object.assign(new Error(result.error || "canvas commit failed"), { commitFailure: true });
    } catch (error) {
      for (const entry of changed) {
        if (entry.canonicalExists) await writeFile(entry.safe.absolute, entry.current.text, "utf8");
        else await unlink(entry.safe.absolute).catch((failure) => { if (failure.code !== "ENOENT") throw failure; });
        if (entry.current.legacy) await writeFile(entry.current.legacy.absolute, entry.current.legacy.text, "utf8");
      }
      if (staged.length) await runGit(["-C", root, "reset", "--quiet", "--", ...staged]).catch(() => {});
      reportError(`canvas gesture rolled back: ${changed.map((entry) => entry.current.file).join(", ")}: ${error.message}`);
      return { status: 503, saved: false, committed: false, error: error.message, operationId, hash: prepared.find((entry) => entry.area === area)?.current.hash ?? null, hashes: Object.fromEntries(prepared.map((entry) => [entry.area, entry.current.hash])) };
    }
    const primary = prepared.find((entry) => entry.area === area) ?? null;
    const metadata = primary ? await stat(primary.safe.absolute) : null;
    return { area, file: primary?.current.file ?? null, exists: Boolean(primary?.current.exists || primary), canvas: primary?.canvas, scene: primary?.canvas, hash: primary?.desiredHash ?? null, hashes: Object.fromEntries(prepared.map((entry) => [entry.area, entry.desiredHash])), bytes: metadata?.size ?? 0, changedAt: metadata?.mtimeMs ?? Date.now(), idempotent: false, committed: true, operationId };
  }

  /** Serializes repository gestures so their optimistic checks cannot interleave. */
  function saveMany(writes, options = {}) {
    const task = saveQueue.then(() => saveManyNow(writes, options));
    saveQueue = task.catch(() => {});
    return task;
  }

  /** Saves one validated scene with optimistic repository-hash protection. */
  async function save(area, canvas, { baseHash = null, operationId = null, session = null, reason = null } = {}) {
    const result = await saveMany([{ area, canvas, baseHash, reason }], { operationId, session, area });
    if (result.status === 409) return result;
    return result;
  }

  return { read, save, saveMany };
}
