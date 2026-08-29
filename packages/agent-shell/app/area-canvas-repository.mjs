import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { areaCanvasPath, canvasHash, parseAreaCanvas, safeCanvasPath, serializeAreaCanvas } from "./area-canvas.mjs";

export function createAreaCanvasRepository({ root, runGit, commit, reportError = console.error }) {
  async function read(area) {
    const file = areaCanvasPath(area);
    const safe = file && safeCanvasPath(root, file);
    if (!safe) throw new Error(`unsafe Area path: ${area}`);
    try {
      const text = await readFile(safe.absolute, "utf8");
      const parsed = parseAreaCanvas(text);
      return { area, file, exists: true, hash: canvasHash(text), text, ...parsed };
    } catch (error) {
      if (error.code === "ENOENT") return { area, file, exists: false, hash: null, ok: true, canvas: { nodes: [], edges: [] }, errors: [], warnings: [] };
      throw error;
    }
  }

  async function save(area, canvas, { baseHash = null, operationId = null, session = null } = {}) {
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
    const result = await commit([current.file], `${current.exists ? "update" : "add"}: ${area} spatial map`, area, session);
    if (!result.committed) {
      reportError(`canvas saved without a vault commit: ${current.file}: ${result.error}`);
      return { status: 503, saved: true, committed: false, error: result.error, hash: desiredHash, operationId };
    }
    const metadata = await stat(safe.absolute);
    return { area, file: current.file, exists: true, canvas, hash: desiredHash, bytes: metadata.size, changedAt: metadata.mtimeMs, idempotent: false, committed: true, operationId };
  }

  return { read, save };
}
