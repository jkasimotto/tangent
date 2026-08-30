import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { areaCanvasPath, canvasHash, legacyAreaCanvasPath, parseAreaCanvas, parseLegacyAreaCanvas, safeCanvasPath, serializeAreaCanvas } from "./area-canvas.mjs";
import { createEmptyScene } from "./public/area-board-core.js";

/** Creates the vault-backed repository for canonical Area-map scenes. */
export function createAreaCanvasRepository({ root, runGit, commit, reportError = console.error }) {
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

  /** Converts the former .canvas in one path-limited vault commit. */
  async function migrate(area) {
    const legacyFile = legacyAreaCanvasPath(area);
    const safeLegacy = legacyFile && safeCanvasPath(root, legacyFile);
    if (!safeLegacy) throw new Error(`unsafe Area path: ${area}`);
    let legacyText;
    try { legacyText = await readFile(safeLegacy.absolute, "utf8"); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
    const parsed = parseLegacyAreaCanvas(legacyText);
    if (!parsed.ok) return { area, file: legacyFile, exists: true, hash: canvasHash(legacyText), ok: false, errors: parsed.errors, warnings: [], fallback: "list" };
    const file = areaCanvasPath(area);
    const safe = safeCanvasPath(root, file);
    const text = serializeAreaCanvas(parsed.canvas);
    await mkdir(path.dirname(safe.absolute), { recursive: true });
    const temporary = `${safe.absolute}.tangent-${process.pid}-${Date.now()}.tmp`;
    await writeFile(temporary, text, "utf8");
    await rename(temporary, safe.absolute);
    await unlink(safeLegacy.absolute);
    await runGit(["-C", root, "add", "--", file, legacyFile]);
    const result = await commit([file, legacyFile], `update: ${area} converts spatial map to Excalidraw`, area, null);
    if (!result.committed) reportError(`canvas converted without a vault commit: ${file}: ${result.error}`);
    return { area, file, exists: true, hash: canvasHash(text), text, ok: true, canvas: parsed.canvas, scene: parsed.canvas, errors: [], warnings: [], migrated: true, committed: result.committed };
  }

  /** Reads a scene and performs the one-time legacy conversion when needed. */
  async function read(area) {
    const current = await readScene(area);
    if (current) return current;
    const converted = await migrate(area);
    if (converted) return converted;
    const file = areaCanvasPath(area);
    const canvas = createEmptyScene();
    return { area, file, exists: false, hash: null, ok: true, canvas, scene: canvas, errors: [], warnings: [] };
  }

  /** Saves one validated scene with optimistic repository-hash protection. */
  async function save(area, canvas, { baseHash = null, operationId = null, session = null, reason = null } = {}) {
    const current = await read(area);
    const text = serializeAreaCanvas(canvas);
    const desiredHash = canvasHash(text);
    if (current.hash === desiredHash) return { ...current, canvas, text, hash: desiredHash, idempotent: true, operationId, committed: true };
    if (current.hash !== baseHash) return { conflict: true, status: 409, currentHash: current.hash, operationId };
    const safe = safeCanvasPath(root, current.file);
    await mkdir(path.dirname(safe.absolute), { recursive: true });
    const temporary = `${safe.absolute}.tangent-${process.pid}-${Date.now()}.tmp`;
    await writeFile(temporary, text, "utf8");
    await rename(temporary, safe.absolute);
    if (!current.exists) await runGit(["-C", root, "add", "--", current.file]);
    const suffix = reason ? ` · ${reason}` : "";
    const result = await commit([current.file], `${current.exists ? "update" : "add"}: ${area} spatial map${suffix}`, area, session);
    if (!result.committed) {
      reportError(`canvas saved without a vault commit: ${current.file}: ${result.error}`);
      if (current.exists) await writeFile(safe.absolute, current.text, "utf8");
      else await unlink(safe.absolute).catch((error) => { if (error.code !== "ENOENT") throw error; });
      return { status: 503, saved: false, committed: false, error: result.error, hash: current.hash, operationId };
    }
    const metadata = await stat(safe.absolute);
    return { area, file: current.file, exists: true, canvas, scene: canvas, hash: desiredHash, bytes: metadata.size, changedAt: metadata.mtimeMs, idempotent: false, committed: true, operationId };
  }

  return { read, save };
}
