import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { areaCanvasPath, canvasHash, legacyAreaCanvasPath, parseAreaCanvas, parseLegacyAreaCanvas, safeCanvasPath, serializeAreaCanvas } from "./area-canvas.mjs";
import { createEmptyScene } from "./public/area-board-core.js";

/** Creates the vault-backed repository for canonical Area-map scenes. */
export function createAreaCanvasRepository({ root, runGit, commit, transactionRoot = process.env.TANGENT_MAP_STATE_ROOT
  ? path.join(process.env.TANGENT_MAP_STATE_ROOT, "transactions")
  : root.startsWith(path.join(os.homedir(), ".tangent", "trees"))
    ? path.join(os.homedir(), ".tangent", "agent-shell", "map-state", "transactions")
    : path.join(root, ".tangent-map-transactions"), reportError = console.error, parseCanvas = parseAreaCanvas }) {
  let saveQueue = Promise.resolve();
  let recovered = null;
  const parsedScenes = new Map();
  /** Keeps one bounded content-addressed parse cache. */
  function cacheParsed(hash, parsed) {
    parsedScenes.set(hash, parsed);
    if (parsedScenes.size > 256) parsedScenes.delete(parsedScenes.keys().next().value);
    return parsed;
  }
  /** Returns the durable directory for one operation ID. */
  const operationPath = (operationId) => path.join(transactionRoot, createHash("sha256").update(String(operationId)).digest("hex"));
  /** Returns the identity digest for one source-space write request. */
  const requestDigest = (writes) => createHash("sha256").update(JSON.stringify(writes.map((write) => ({ area: write.area, baseHash: write.baseHash ?? null, canvas: write.canvas })))).digest("hex");
  /** Writes one JSON record through a same-directory rename. */
  async function writeRecord(file, value) {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(value), "utf8");
    await rename(temporary, file);
  }
  /** Restores interrupted prepared writes before a map reader can observe them. */
  async function recover() {
    let names = [];
    try { names = await readdir(transactionRoot); } catch (error) { if (error.code !== "ENOENT") throw error; }
    for (const name of names) {
      const directory = path.join(transactionRoot, name);
      let manifest;
      try { manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")); } catch { continue; }
      if (manifest.state !== "prepared") continue;
      let committed = Boolean(manifest.targets?.length);
      for (const target of manifest.targets ?? []) {
        try {
          const result = await runGit(["-C", root, "show", `HEAD:${target.file}`]);
          const text = String(result?.stdout ?? result ?? "");
          if (canvasHash(text) !== target.newHash) committed = false;
        } catch { committed = false; }
      }
      for (const target of manifest.targets ?? []) {
        const safe = safeCanvasPath(root, target.file);
        if (!safe) continue;
        const selected = committed ? target.newText : target.oldText;
        if (selected === null) await unlink(safe.absolute).catch((error) => { if (error.code !== "ENOENT") throw error; });
        else { await mkdir(path.dirname(safe.absolute), { recursive: true }); await writeFile(safe.absolute, selected, "utf8"); }
      }
      await writeRecord(path.join(directory, "manifest.json"), { ...manifest, state: committed ? "committed" : "recovered", recoveryOutcome: committed ? "finished-new" : "restored-old", recoveredAt: new Date().toISOString() });
    }
  }
  /** Runs crash recovery once for this repository instance. */
  async function ensureRecovered() { recovered ??= recover(); await recovered; }
  /** Reads a canonical scene without invoking legacy migration. */
  async function readScene(area) {
    await ensureRecovered();
    const file = areaCanvasPath(area);
    const safe = file && safeCanvasPath(root, file);
    if (!safe) throw new Error(`unsafe Area path: ${area}`);
    try {
      const text = await readFile(safe.absolute, "utf8");
      const hash = canvasHash(text);
      const parsed = parsedScenes.get(hash) ?? cacheParsed(hash, parseCanvas(text));
      return { area, file, exists: true, hash, text, ...parsed };
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  /** Reads one Excalidraw file left behind by an external Area move. */
  async function readMovedScene(area) {
    if (area === "@root") return null;
    const file = areaCanvasPath(area);
    const safe = file && safeCanvasPath(root, file);
    if (!safe) throw new Error(`unsafe Area path: ${area}`);
    let entries;
    try { entries = await readdir(path.dirname(safe.absolute), { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
    const candidates = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".excalidraw") && entry.name !== path.basename(safe.absolute))
      .map((entry) => path.posix.join(path.posix.dirname(file), entry.name))
      .filter((candidate) => safeCanvasPath(root, candidate))
      .sort();
    if (candidates.length !== 1) return null;
    const sourceFile = candidates[0];
    const source = safeCanvasPath(root, sourceFile);
    const text = await readFile(source.absolute, "utf8");
    const sourceHash = canvasHash(text);
    const parsed = parsedScenes.get(sourceHash) ?? cacheParsed(sourceHash, parseCanvas(text));
    if (!parsed.ok) return { area, file: sourceFile, exists: true, hash: sourceHash, text, ...parsed };
    return {
      area, file, exists: true, canonicalExists: false, hash: null, text, ...parsed, migrated: true,
      legacy: { file: sourceFile, absolute: source.absolute, text },
    };
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
    const moved = await readMovedScene(area);
    if (moved) return moved;
    const converted = await readLegacy(area);
    if (converted) return converted;
    const file = areaCanvasPath(area);
    const canvas = createEmptyScene();
    return { area, file, exists: false, canonicalExists: false, hash: null, ok: true, canvas, scene: canvas, errors: [], warnings: [] };
  }

  /** Reads the last complete Git scene without consulting worktree bytes. */
  async function readCommitted(area) {
    const file = areaCanvasPath(area);
    if (!file) throw new Error(`unsafe Area path: ${area}`);
    try {
      const result = await runGit(["-C", root, "show", `HEAD:${file}`]);
      const text = String(result?.stdout ?? result ?? "");
      const hash = canvasHash(text);
      const parsed = parsedScenes.get(hash) ?? cacheParsed(hash, parseCanvas(text));
      return { area, file, exists: true, hash, text, ...parsed };
    } catch {
      const legacyFile = legacyAreaCanvasPath(area);
      try {
        const result = await runGit(["-C", root, "show", `HEAD:${legacyFile}`]);
        const legacyText = String(result?.stdout ?? result ?? "");
        const parsed = parseLegacyAreaCanvas(legacyText);
        if (!parsed.ok) return { area, file: legacyFile, exists: true, hash: canvasHash(legacyText), ok: false, errors: parsed.errors, warnings: [], fallback: "list" };
        return { area, file, exists: true, canonicalExists: false, hash: null, ok: true, canvas: parsed.canvas, scene: parsed.canvas, errors: [], warnings: [], migrated: true, legacy: { file: legacyFile, text: legacyText } };
      } catch {
        const canvas = createEmptyScene();
        return { area, file, exists: false, canonicalExists: false, hash: null, ok: true, canvas, scene: canvas, errors: [], warnings: [] };
      }
    }
  }

  /** Saves all files of one map gesture through one conflict check and commit. */
  async function saveManyNow(writes, { operationId = null, session = null, area = writes[0]?.area ?? "" } = {}) {
    await ensureRecovered();
    const digest = requestDigest(writes);
    const operationDirectory = operationId ? operationPath(operationId) : null;
    if (operationDirectory) {
      try {
        const prior = JSON.parse(await readFile(path.join(operationDirectory, "manifest.json"), "utf8"));
        if (prior.digest !== digest) return { status: 409, conflict: true, operationId, error: "operation ID was already used for different map content" };
        if (prior.state === "committed") return { ...prior.result, idempotent: true };
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
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
      if (operationDirectory) await writeRecord(path.join(operationDirectory, "manifest.json"), {
        schema: "area-map-transaction.v1", operationId, digest, state: "prepared", preparedAt: new Date().toISOString(),
        targets: changed.map((entry) => ({ area: entry.area, file: entry.current.file, oldText: entry.canonicalExists ? entry.current.text : null, newText: entry.text, newHash: entry.desiredHash })),
      });
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
      const trailer = operationId ? `\n\nTangent-Map-Operation: ${operationId}` : "";
      const result = await commit(paths, `${prefix}: ${area} spatial map · ${descriptions.join(" · ")}${trailer}`, area, session);
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
    const result = { area, file: primary?.current.file ?? null, exists: Boolean(primary?.current.exists || primary), canvas: primary?.canvas, scene: primary?.canvas, hash: primary?.desiredHash ?? null, hashes: Object.fromEntries(prepared.map((entry) => [entry.area, entry.desiredHash])), bytes: metadata?.size ?? 0, changedAt: metadata?.mtimeMs ?? Date.now(), idempotent: false, committed: true, operationId };
    if (operationDirectory) await writeRecord(path.join(operationDirectory, "manifest.json"), { schema: "area-map-transaction.v1", operationId, digest, state: "committed", committedAt: new Date().toISOString(), result });
    return result;
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

  return { read, readCommitted, recover, save, saveMany };
}
