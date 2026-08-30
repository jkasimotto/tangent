import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { canvasHash, safeCanvasPath, serializeAreaCanvas } from "./area-canvas.mjs";

/** Returns one stable digest for an idempotent gesture request. */
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Creates the crash-recoverable multi-shard Area-map write authority. */
export function createAreaMapTransactionRepository({ root, repository, vault, runGit, transactionRoot, reportError = console.error, fault = null }) {
  const lockDirectory = path.join(transactionRoot, ".vault-map.lock");
  let recoveryPromise = null;
  let recoveryRequired = null;
  let readerBarrier = Promise.resolve();
  let releaseReaders = null;

  /** Writes bytes durably before exposing a same-directory rename. */
  async function writeDurable(file, content) {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    const handle = await open(temporary, "w");
    try { await handle.writeFile(content); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, file);
    const directory = await open(path.dirname(file), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  }

  /** Persists one journal state through the durable writer. */
  async function writeManifest(file, value) { await writeDurable(file, `${JSON.stringify(value, null, 2)}\n`); }

  /** Returns the transaction directory for one world and operation. */
  function operationDirectory(worldId, operationId) { return path.join(transactionRoot, digest(worldId).slice(0, 24), digest(operationId)); }

  /** Runs one injected crash checkpoint. */
  async function checkpoint(phase, detail = {}) { if (fault) await fault(phase, detail); }

  /** Sleeps briefly without blocking the event loop. */
  const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  /** Acquires the one cross-process vault map lock. */
  async function acquireLock() {
    const started = Date.now();
    while (true) {
      try {
        await mkdir(lockDirectory, { recursive: false });
        await writeDurable(path.join(lockDirectory, "owner.json"), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
        return;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        let owner = null;
        try { owner = JSON.parse(await readFile(path.join(lockDirectory, "owner.json"), "utf8")); } catch { /* another process can still be creating it */ }
        let alive = false;
        if (Number.isInteger(owner?.pid)) try { process.kill(owner.pid, 0); alive = true; } catch { /* a dead process left the lock */ }
        if (!alive && owner) { await rm(lockDirectory, { recursive: true, force: true }); continue; }
        if (Date.now() - started > 10_000) throw new Error("Area map transaction lock timed out");
        await pause(25);
      }
    }
  }

  /** Runs one operation under the cross-process lock. */
  async function withLock(action) {
    await mkdir(transactionRoot, { recursive: true });
    await acquireLock();
    try { return await action(); }
    finally { await rm(lockDirectory, { recursive: true, force: true }); }
  }

  /** Prevents Agent Shell world readers from observing the install window. */
  function blockReaders() {
    if (releaseReaders) return;
    readerBarrier = new Promise((resolve) => { releaseReaders = resolve; });
  }

  /** Releases readers after one complete old or new state exists. */
  function unblockReaders() { releaseReaders?.(); releaseReaders = null; readerBarrier = Promise.resolve(); }

  /** Reads one target exactly as it exists in the shared worktree. */
  async function readTarget(file) {
    const safe = safeCanvasPath(root, file);
    if (!safe) throw new Error(`unsafe map target: ${file}`);
    try { return await readFile(safe.absolute, "utf8"); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }

  /** Installs one target's prepared bytes in the shared worktree. */
  async function installTarget(target) {
    const safe = safeCanvasPath(root, target.file);
    if (!safe) throw new Error(`unsafe map target: ${target.file}`);
    if (target.newText === null) await unlink(safe.absolute).catch((error) => { if (error.code !== "ENOENT") throw error; });
    else await writeDurable(safe.absolute, target.newText);
  }

  /** Returns the current branch head. */
  async function currentHead() {
    const result = await runGit(["-C", root, "rev-parse", "HEAD"]);
    return String(result?.stdout ?? result ?? "").trim();
  }

  /** Reports whether the current Git tree contains all prepared target bytes. */
  async function gitHasNewTargets(targets) {
    for (const target of targets) {
      if (target.newText === null) {
        try { await runGit(["-C", root, "show", `HEAD:${target.file}`]); return false; }
        catch { continue; }
      }
      try {
        const result = await runGit(["-C", root, "show", `HEAD:${target.file}`]);
        if (canvasHash(String(result?.stdout ?? result ?? "")) !== target.newHash) return false;
      } catch { return false; }
    }
    return true;
  }

  /** Finishes index and worktree installation for one prepared commit. */
  async function finishPrepared(manifest, manifestFile, { installRef }) {
    blockReaders();
    try {
      if (installRef) {
        await vault.installPreparedCommit(manifest.prepared);
        await checkpoint("ref-installed", { operationId: manifest.operationId });
      }
      await vault.updatePreparedIndex(manifest.prepared);
      await checkpoint("index-installed", { operationId: manifest.operationId });
      for (const [index, target] of manifest.targets.entries()) {
        await installTarget(target);
        await checkpoint(`target-installed:${index}`, { operationId: manifest.operationId, target: target.file });
      }
      if (!await gitHasNewTargets(manifest.targets)) throw new Error("prepared map commit does not contain every target");
      for (const target of manifest.targets) {
        const text = await readTarget(target.file);
        const hash = text === null ? null : canvasHash(text);
        if (hash !== target.newHash) throw new Error(`map worktree verification failed for ${target.file}`);
      }
      await checkpoint("verified", { operationId: manifest.operationId });
      const committed = { ...manifest, state: "committed", committedAt: new Date().toISOString() };
      await writeManifest(manifestFile, committed);
      await checkpoint("result-recorded", { operationId: manifest.operationId });
      return committed;
    } finally { unblockReaders(); }
  }

  /** Recovers every interrupted transaction before serving later map work. */
  async function recoverUnlocked() {
    let worlds = [];
    try { worlds = await readdir(transactionRoot, { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    for (const world of worlds.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))) {
      const worldDirectory = path.join(transactionRoot, world.name);
      const operations = await readdir(worldDirectory, { withFileTypes: true });
      for (const operation of operations.filter((entry) => entry.isDirectory())) {
        const manifestFile = path.join(worldDirectory, operation.name, "manifest.json");
        let manifest;
        try { manifest = JSON.parse(await readFile(manifestFile, "utf8")); } catch { continue; }
        if (manifest.state !== "prepared") continue;
        const hashes = await Promise.all(manifest.targets.map(async (target) => {
          const text = await readTarget(target.file); return text === null ? null : canvasHash(text);
        }));
        const recognized = hashes.every((hash, index) => hash === manifest.targets[index].oldHash || hash === manifest.targets[index].newHash);
        if (!recognized) {
          recoveryRequired = { operationId: manifest.operationId, reason: "a map target contains unrelated bytes" };
          await writeManifest(manifestFile, { ...manifest, state: "recovery-required", recoveryRequired, failedAt: new Date().toISOString() });
          continue;
        }
        const head = await currentHead();
        const committed = head === manifest.prepared.commit || await gitHasNewTargets(manifest.targets);
        if (!committed && head !== manifest.prepared.expectedHead) {
          recoveryRequired = { operationId: manifest.operationId, reason: "the vault branch changed before map recovery" };
          await writeManifest(manifestFile, { ...manifest, state: "recovery-required", recoveryRequired, failedAt: new Date().toISOString() });
          continue;
        }
        await finishPrepared(manifest, manifestFile, { installRef: !committed });
      }
    }
  }

  /** Ensures recovery runs once for this server instance. */
  async function ensureRecovered() { recoveryPromise ??= withLock(recoverUnlocked); await recoveryPromise; }

  /** Waits until readers can observe a complete transaction boundary. */
  async function waitForReadable() {
    await ensureRecovered(); await readerBarrier;
    if (recoveryRequired) throw Object.assign(new Error("Area map recovery requires attention"), { status: 503, recoveryRequired });
  }

  /** Saves every source shard of one world gesture as one exact Git commit. */
  async function saveMany(writes, { operationId, worldId = "default", area = writes[0]?.area ?? "", session = null } = {}) {
    if (!operationId) throw new Error("Area map gestures require an operation ID");
    await ensureRecovered();
    if (recoveryRequired) return { status: 503, error: "Area map recovery requires attention", recoveryRequired };
    const requestDigest = digest(writes.map((write) => ({ area: write.area, baseHash: write.baseHash ?? null, canvas: write.canvas })));
    const directory = operationDirectory(worldId, operationId);
    const manifestFile = path.join(directory, "manifest.json");
    try {
      const prior = JSON.parse(await readFile(manifestFile, "utf8"));
      if (prior.digest !== requestDigest) return { status: 409, conflict: true, operationId, error: "operation ID was already used for different map content" };
      if (prior.state === "committed") return { ...prior.result, idempotent: true };
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    return withLock(async () => {
      const unique = new Map();
      for (const write of writes) {
        if (!write?.area || unique.has(write.area)) throw new Error("a map gesture must name each source owner once");
        unique.set(write.area, write);
      }
      const preparedWrites = await Promise.all([...unique.values()].map(async (write) => {
        const current = await repository.read(write.area);
        const newText = serializeAreaCanvas(write.canvas);
        return { write, current, newText, newHash: canvasHash(newText) };
      }));
      const conflicts = preparedWrites.filter((entry) => entry.current.hash !== entry.newHash && entry.current.hash !== (entry.write.baseHash ?? null));
      if (conflicts.length) return { status: 409, conflict: true, operationId, currentHashes: Object.fromEntries(conflicts.map((entry) => [entry.write.area, entry.current.hash])) };
      const changed = preparedWrites.filter((entry) => entry.current.hash !== entry.newHash);
      if (!changed.length) return { committed: true, idempotent: true, operationId, hashes: Object.fromEntries(preparedWrites.map((entry) => [entry.write.area, entry.newHash])) };
      const targets = changed.flatMap((entry) => [
        { area: entry.write.area, file: entry.current.file, oldText: entry.current.canonicalExists === false ? null : entry.current.text ?? null, newText: entry.newText, oldHash: entry.current.hash ?? null, newHash: entry.newHash },
        ...(entry.current.legacy ? [{ area: entry.write.area, file: entry.current.legacy.file, oldText: entry.current.legacy.text, newText: null, oldHash: canvasHash(entry.current.legacy.text), newHash: null }] : []),
      ]);
      const descriptions = changed.map((entry) => entry.write.reason || `${entry.write.area.split("/").at(-1)} map`);
      const prefix = changed.some((entry) => entry.current.exists) ? "update" : "add";
      const message = `${prefix}: ${area} spatial map · ${descriptions.join(" · ")}`;
      const prepared = await vault.prepareExactCommit({ files: targets.map((target) => ({ path: target.file, content: target.newText })), message, area, session, operationId });
      const result = {
        area, file: changed.find((entry) => entry.write.area === area)?.current.file ?? changed[0].current.file,
        hash: preparedWrites.find((entry) => entry.write.area === area)?.newHash ?? null,
        hashes: Object.fromEntries(preparedWrites.map((entry) => [entry.write.area, entry.newHash])),
        committed: true, operationId, idempotent: false,
      };
      const manifest = { schema: "area-map-transaction.v2", operationId, worldId, digest: requestDigest, state: "prepared", preparedAt: new Date().toISOString(), prepared, targets, result };
      await writeManifest(manifestFile, manifest);
      await checkpoint("prepared", { operationId });
      const committed = await finishPrepared(manifest, manifestFile, { installRef: true });
      const primary = changed.find((entry) => entry.write.area === area) ?? changed[0];
      const metadata = await stat(safeCanvasPath(root, primary.current.file).absolute);
      committed.result.bytes = metadata.size;
      await writeManifest(manifestFile, committed);
      return committed.result;
    }).catch((error) => {
      if (error?.simulatedCrash) throw error;
      reportError(`Area map transaction failed: ${error.message}`);
      return { status: 503, committed: false, saved: false, operationId, error: error.message };
    });
  }

  return { recover: ensureRecovered, saveMany, waitForReadable };
}

export default { createAreaMapTransactionRepository };
