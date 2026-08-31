import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, open, readFile, readdir, rename, rm, rmdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { canvasHash, safeCanvasPath, serializeAreaCanvas } from "./area-canvas.mjs";

const LOCK_STALE_MS = 10_000;
const LOCK_POLL_MS = 25;

/** Returns one stable digest for an idempotent gesture request. */
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Resolves one exact vault target without permitting traversal or Git internals. */
function safeVaultTarget(root, file) {
  if (typeof file !== "string" || !file || file.includes("\0") || file.includes("\\") || path.posix.isAbsolute(file)) return null;
  const normalized = path.posix.normalize(file);
  if (normalized !== file || normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.split("/").includes(".git")) return null;
  const absolute = path.resolve(root, normalized);
  return absolute.startsWith(`${path.resolve(root)}${path.sep}`) ? { relative: normalized, absolute } : null;
}

/** Returns one journal target side as exact bytes. */
function targetBytes(target, side) {
  const encoded = `${side}Base64`;
  if (Object.hasOwn(target, encoded)) return target[encoded] === null ? null : Buffer.from(target[encoded], "base64");
  const text = target[`${side}Text`];
  return text === null || text === undefined ? null : Buffer.from(text);
}

/** Returns the stable content hash used by transaction preconditions. */
const contentHash = (value) => value === null ? null : canvasHash(value);

/** Creates the crash-recoverable multi-shard Area-map write authority. */
export function createAreaMapTransactionRepository({ root, repository, vault, runGit, transactionRoot, reportError = console.error, recordEvent = null, fault = null }) {
  const lockDirectory = path.join(transactionRoot, ".vault-map.lock");
  let recoveryPromise = null;
  let recoveryPending = null;
  let recoveryRequired = null;
  let readerBarrier = Promise.resolve();
  let releaseReaders = null;
  let activeReaders = 0;
  const readerDrainWaiters = [];
  const readLeaseContext = new AsyncLocalStorage();

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

  /** Emits one coordinate-free transaction event without affecting map authority. */
  function emitEvent(name, fields = {}) {
    try {
      const result = recordEvent?.({ name, at: Date.now(), ...fields });
      result?.catch?.(() => {});
    } catch { /* Diagnostics never affect a transaction. */ }
  }

  /** Runs one observable injected crash checkpoint. */
  async function checkpoint(phase, detail = {}) {
    emitEvent("area_map_save_phase", { ...detail, phase });
    if (fault) await fault(phase, detail);
  }

  /** Returns coordinate-free phase fields for one journaled transaction. */
  function phaseFields(manifest) {
    return {
      operationId: manifest.operationId,
      shardCount: Number(manifest.shardCount ?? 0),
      duration: Math.max(0, Date.now() - Date.parse(manifest.preparedAt)),
    };
  }

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
        let lock = null;
        if (!owner) try { lock = await stat(lockDirectory); }
        catch (failure) { if (failure.code !== "ENOENT") throw failure; }
        if (!owner && lock && Date.now() - lock.mtimeMs >= LOCK_STALE_MS) { await rm(lockDirectory, { recursive: true, force: true }); continue; }
        if (Date.now() - started > LOCK_STALE_MS) throw new Error("Area map transaction lock timed out");
        await pause(LOCK_POLL_MS);
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

  /** Releases one read lease and wakes a writer after the last reader exits. */
  function releaseReader() {
    activeReaders -= 1;
    if (activeReaders !== 0) return;
    for (const resolve of readerDrainWaiters.splice(0)) resolve();
  }

  /** Acquires one read lease that cannot overlap a map install. */
  async function acquireReader() {
    while (true) {
      await readerBarrier;
      activeReaders += 1;
      if (!releaseReaders) return releaseReader;
      releaseReader();
    }
  }

  /** Prevents new reads and waits for every active map reader to finish. */
  async function blockReaders() {
    if (!releaseReaders) readerBarrier = new Promise((resolve) => { releaseReaders = resolve; });
    if (activeReaders) await new Promise((resolve) => readerDrainWaiters.push(resolve));
  }

  /** Releases readers after one complete old or new state exists. */
  function unblockReaders() {
    const release = releaseReaders;
    releaseReaders = null;
    readerBarrier = Promise.resolve();
    release?.();
  }

  /** Reads one target exactly as it exists in the shared worktree. */
  async function readTarget(file) {
    const safe = safeVaultTarget(root, file);
    if (!safe) throw new Error(`unsafe vault target: ${file}`);
    try { return await readFile(safe.absolute); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }

  /** Installs one target's prepared bytes in the shared worktree. */
  async function installTarget(target) {
    const safe = safeVaultTarget(root, target.file);
    if (!safe) throw new Error(`unsafe vault target: ${target.file}`);
    const content = targetBytes(target, "new");
    if (content === null) await unlink(safe.absolute).catch((error) => { if (error.code !== "ENOENT") throw error; });
    else await writeDurable(safe.absolute, content);
  }

  /** Returns the current branch head. */
  async function currentHead() {
    const result = await runGit(["-C", root, "rev-parse", "HEAD"]);
    return String(result?.stdout ?? result ?? "").trim();
  }

  /** Reports whether the current Git tree contains every prepared exact entry. */
  async function gitHasPreparedFiles(prepared) {
    for (const file of prepared.files) {
      if (file.remove || file.content === null) {
        try { await runGit(["-C", root, "rev-parse", `HEAD:${file.path}`]); return false; }
        catch { continue; }
      }
      try {
        const result = await runGit(["-C", root, "rev-parse", `HEAD:${file.path}`]);
        if (String(result?.stdout ?? result ?? "").trim() !== file.blob) return false;
      } catch { return false; }
    }
    return true;
  }

  /** Rejects an install when any worktree target changed after preparation. */
  async function rejectChangedTargets(manifest, manifestFile) {
    const changed = [];
    for (const target of manifest.targets) {
      const text = await readTarget(target.file);
      const hash = contentHash(text);
      if (hash !== target.oldHash) changed.push({ ...target, currentHash: hash });
    }
    if (!changed.length) return;
    const currentHashes = {};
    for (const target of changed) if (!(target.area in currentHashes)) currentHashes[target.area] = target.currentHash;
    const conflict = {
      status: 409,
      conflict: true,
      code: "target-race",
      retryable: false,
      operationId: manifest.operationId,
      currentHashes,
      changedPaths: changed.map((target) => target.file),
      error: "a map target changed while the gesture was preparing",
    };
    await writeManifest(manifestFile, { ...manifest, state: "conflict", conflict, failedAt: new Date().toISOString() });
    throw Object.assign(new Error(conflict.error), conflict);
  }

  /** Returns one path's blob identity from a Git revision, or null when absent. */
  async function revisionBlob(revision, file) {
    try {
      const result = await runGit(["-C", root, "rev-parse", `${revision}:${file}`]);
      return String(result?.stdout ?? result ?? "").trim() || null;
    } catch { return null; }
  }

  /** Returns one path's blob identity from the shared index, or null when absent. */
  async function indexBlob(file) {
    const result = await runGit(["-C", root, "ls-files", "--stage", "--", file]);
    const lines = String(result?.stdout ?? result ?? "").trim().split("\n").filter(Boolean);
    if (!lines.length) return null;
    if (lines.length !== 1) return "unmerged";
    return lines[0].match(/^\d+\s+([0-9a-f]+)\s+\d+\t/)?.[1] ?? "invalid";
  }

  /** Returns one worktree path's Git blob identity, or null when absent. */
  async function worktreeBlob(file) {
    if (await readTarget(file) === null) return null;
    const result = await runGit(["-C", root, "hash-object", "--", file]);
    return String(result?.stdout ?? result ?? "").trim() || null;
  }

  /** Rejects exact moves that would sweep or overwrite targeted user edits. */
  async function rejectDirtyExactTargets(manifest, manifestFile) {
    const changed = [];
    for (const target of manifest.targets) {
      const head = await revisionBlob(manifest.prepared.expectedHead, target.file);
      const index = await indexBlob(target.file);
      const worktree = await worktreeBlob(target.file);
      if (head !== index || head !== worktree) changed.push(target.file);
    }
    if (!changed.length) return;
    const conflict = { status: 409, conflict: true, code: "target-race", retryable: false, operationId: manifest.operationId, changedPaths: changed, error: "an exact move target has pending vault edits" };
    await writeManifest(manifestFile, { ...manifest, state: "conflict", conflict, failedAt: new Date().toISOString() });
    throw Object.assign(new Error(conflict.error), conflict);
  }

  /** Lists the complete file and directory shape below one guarded directory. */
  async function directoryEntries(directory) {
    const safe = safeVaultTarget(root, directory);
    if (!safe) throw new Error(`unsafe vault directory: ${directory}`);
    const entries = [];
    /** Walks one guarded directory without following symbolic links. */
    async function walk(absolute, relative = "") {
      let values;
      try { values = await readdir(absolute, { withFileTypes: true }); }
      catch (error) { if (error.code === "ENOENT") return null; throw error; }
      for (const entry of values.sort((left, right) => left.name.localeCompare(right.name))) {
        const child = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          entries.push(`d:${child}`);
          if (await walk(path.join(absolute, entry.name), child) === null) return null;
        } else entries.push(`${entry.isSymbolicLink() ? "l" : "f"}:${child}`);
      }
      return entries;
    }
    return walk(safe.absolute);
  }

  /** Rejects a directory move whose source shape or destination changed. */
  async function rejectChangedDirectoryGuards(manifest, manifestFile) {
    for (const guard of manifest.directoryGuards ?? []) {
      const source = await directoryEntries(guard.source);
      const destination = await directoryEntries(guard.destination);
      if (source && JSON.stringify(source) === JSON.stringify(guard.entries) && destination === null) continue;
      const conflict = { status: 409, conflict: true, code: "target-race", retryable: false, operationId: manifest.operationId, changedPaths: [guard.source, guard.destination], error: "the Area directory changed while its move was preparing" };
      await writeManifest(manifestFile, { ...manifest, state: "conflict", conflict, failedAt: new Date().toISOString() });
      throw Object.assign(new Error(conflict.error), conflict);
    }
  }

  /** Removes one now-empty source directory without deleting new unrelated data. */
  async function cleanupDirectory(directory) {
    const safe = safeVaultTarget(root, directory);
    if (!safe) throw new Error(`unsafe vault directory: ${directory}`);
    await rmdir(safe.absolute).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }

  /** Finishes index and worktree installation for one prepared commit. */
  async function finishPrepared(manifest, manifestFile, { installRef, recheckTargets = false }) {
    const phase = phaseFields(manifest);
    let refInstalled = !installRef;
    await blockReaders();
    try {
      if (installRef) {
        if (recheckTargets) {
          await rejectChangedTargets(manifest, manifestFile);
          if (manifest.exactClean) await rejectDirtyExactTargets(manifest, manifestFile);
          await rejectChangedDirectoryGuards(manifest, manifestFile);
        }
        await vault.installPreparedCommit(manifest.prepared);
        refInstalled = true;
        await checkpoint("ref-installed", phase);
      }
      await vault.updatePreparedIndex(manifest.prepared);
      await checkpoint("index-installed", phase);
      for (const [index, target] of manifest.targets.entries()) {
        await installTarget(target);
        await checkpoint(`target-installed:${index}`, phase);
      }
      for (const [index, directory] of (manifest.cleanupDirectories ?? []).entries()) {
        await cleanupDirectory(directory);
        await checkpoint(`directory-cleaned:${index}`, phase);
      }
      if (!await gitHasPreparedFiles(manifest.prepared)) throw new Error("prepared map commit does not contain every target");
      for (const target of manifest.targets) {
        const text = await readTarget(target.file);
        const hash = contentHash(text);
        if (hash !== target.newHash) throw new Error(`map worktree verification failed for ${target.file}`);
      }
      await checkpoint("verified", phase);
      const committed = { ...manifest, state: "committed", committedAt: new Date().toISOString() };
      await writeManifest(manifestFile, committed);
      await checkpoint("result-recorded", phase);
      return committed;
    } catch (error) {
      if (!refInstalled) {
        const head = await currentHead().catch(() => "");
        if (head === manifest.prepared.commit) refInstalled = true;
        else {
          const headRace = Boolean(head && head !== manifest.prepared.expectedHead);
          if (!error?.conflict) {
            Object.assign(error, {
              status: headRace ? 409 : Number(error?.status ?? 503),
              conflict: headRace,
              code: headRace ? "head-race" : "install-failed",
              retryable: true,
            });
            await writeManifest(manifestFile, {
              ...manifest,
              state: "aborted",
              failure: { status: error.status, code: error.code, retryable: error.retryable },
              failedAt: new Date().toISOString(),
            }).catch(() => {});
          }
          throw error;
        }
      }
      Object.assign(error, { status: Number(error?.status ?? 503), code: "install-interrupted", retryable: true });
      recoveryPending = { operationId: manifest.operationId, reason: "an interrupted map install needs recovery" };
      recoveryPromise = null;
      throw error;
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
        if (!["prepared", "recovery-required"].includes(manifest.state)) continue;
        const recovery = { operationId: manifest.operationId, priorPhase: manifest.state };
        emitEvent("area_map_recovery", { ...recovery, outcome: "started" });
        const hashes = await Promise.all(manifest.targets.map(async (target) => {
          const text = await readTarget(target.file); return contentHash(text);
        }));
        const recognized = hashes.every((hash, index) => hash === manifest.targets[index].oldHash || hash === manifest.targets[index].newHash);
        if (!recognized) {
          recoveryRequired = { operationId: manifest.operationId, reason: "a map target contains unrelated bytes" };
          await writeManifest(manifestFile, { ...manifest, state: "recovery-required", recoveryRequired, failedAt: new Date().toISOString() });
          emitEvent("area_map_recovery", { ...recovery, outcome: "recovery-required" });
          continue;
        }
        const head = await currentHead();
        const committed = head === manifest.prepared.commit || await gitHasPreparedFiles(manifest.prepared);
        if (!committed && head !== manifest.prepared.expectedHead) {
          recoveryRequired = { operationId: manifest.operationId, reason: "the vault branch changed before map recovery" };
          await writeManifest(manifestFile, { ...manifest, state: "recovery-required", recoveryRequired, failedAt: new Date().toISOString() });
          emitEvent("area_map_recovery", { ...recovery, outcome: "recovery-required" });
          continue;
        }
        try {
          await finishPrepared(manifest, manifestFile, { installRef: !committed });
          emitEvent("area_map_recovery", { ...recovery, outcome: "completed" });
        } catch (error) {
          emitEvent("area_map_recovery", { ...recovery, outcome: "failed" });
          throw error;
        }
      }
    }
    recoveryPending = null;
  }

  /** Ensures recovery runs once for this server instance. */
  async function ensureRecovered() { recoveryPromise ??= withLock(recoverUnlocked); await recoveryPromise; }

  /** Runs one complete map read while no transaction can install a partial world. */
  async function withRead(action) {
    if (readLeaseContext.getStore()?.active) return action();
    await ensureRecovered();
    const release = await acquireReader();
    const lease = { active: true };
    try { return await readLeaseContext.run(lease, action); }
    finally { lease.active = false; release(); }
  }

  /** Waits until readers can observe a complete transaction boundary. */
  async function waitForReadable() {
    await withRead(() => {
      if (recoveryRequired) throw Object.assign(new Error("Area map recovery requires attention"), { status: 503, recoveryRequired });
      if (recoveryPending) throw Object.assign(new Error("Area map recovery is pending"), { status: 503, recoveryPending });
    });
  }

  /** Reads worktree authority or the last complete Git snapshot during recovery. */
  async function read(area) {
    return withRead(() => recoveryRequired || recoveryPending ? repository.readCommitted(area) : repository.read(area));
  }

  /** Saves every source shard of one world gesture as one exact Git commit. */
  async function saveMany(writes, { operationId, worldId = "default", area = writes[0]?.area ?? "", session = null, preflight = null, acknowledgement = null } = {}) {
    if (!operationId) throw new Error("Area map gestures require an operation ID");
    const startedAt = Date.now();
    await ensureRecovered();
    if (recoveryRequired) return { status: 503, code: "recovery-required", retryable: false, error: "Area map recovery requires attention", recoveryRequired };
    const requestDigest = digest(writes.map((write) => ({ area: write.area, baseHash: write.baseHash ?? null, canvas: write.canvas })));
    const directory = operationDirectory(worldId, operationId);
    const manifestFile = path.join(directory, "manifest.json");
    return withLock(async () => {
      await recoverUnlocked();
      if (recoveryRequired) return { status: 503, code: "recovery-required", retryable: false, error: "Area map recovery requires attention", recoveryRequired };
      try {
        const prior = JSON.parse(await readFile(manifestFile, "utf8"));
        if (prior.digest !== requestDigest) return { status: 409, conflict: true, code: "operation-id-reused", retryable: false, operationId, error: "operation ID was already used for different map content" };
        if (prior.state === "committed") return { ...prior.result, idempotent: true };
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (typeof preflight === "function") {
        const result = await preflight();
        if (Number(result?.status ?? 0) >= 400) return { ...result, operationId: result.operationId ?? operationId };
      }
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
      if (conflicts.length) return { status: 409, conflict: true, code: "shard-conflict", retryable: false, operationId, currentHashes: Object.fromEntries(conflicts.map((entry) => [entry.write.area, entry.current.hash])) };
      const changed = preparedWrites.filter((entry) => entry.current.hash !== entry.newHash);
      if (!changed.length) {
        return {
          committed: true, idempotent: true, operationId,
          hashes: Object.fromEntries(preparedWrites.map((entry) => [entry.write.area, entry.newHash])),
          ...(acknowledgement ? { acknowledgement } : {}),
        };
      }
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
        bytes: Buffer.byteLength((changed.find((entry) => entry.write.area === area) ?? changed[0]).newText),
        committed: true, operationId, idempotent: false,
        ...(acknowledgement ? { acknowledgement } : {}),
      };
      const manifest = { schema: "area-map-transaction.v2", operationId, worldId, digest: requestDigest, state: "prepared", preparedAt: new Date().toISOString(), shardCount: changed.length, prepared, targets, result };
      await writeManifest(manifestFile, manifest);
      await checkpoint("prepared", phaseFields(manifest));
      const committed = await finishPrepared(manifest, manifestFile, { installRef: true, recheckTargets: true });
      return committed.result;
    }).catch((error) => {
      if (error?.simulatedCrash) throw error;
      emitEvent("area_map_save_phase", { operationId, phase: "failed", shardCount: writes.length, duration: Date.now() - startedAt, status: Number(error?.status ?? 503), failureKind: error?.code ?? "transaction-failed", retryable: error?.retryable === true });
      reportError(`Area map transaction failed: ${error.message}`);
      return {
        status: Number(error?.status ?? 503), committed: false, saved: false, operationId, error: error.message,
        code: error?.code ?? "transaction-failed", retryable: error?.retryable === true,
        ...(error?.conflict ? { conflict: true, currentHashes: error.currentHashes ?? {}, changedPaths: error.changedPaths ?? [] } : {}),
      };
    });
  }

  /** Converts one in-memory exact target into a durable binary-safe journal record. */
  function journalTarget(target, area) {
    const oldContent = target.oldContent === null || target.oldContent === undefined ? null : Buffer.from(target.oldContent);
    const newContent = target.newContent === null || target.newContent === undefined ? null : Buffer.from(target.newContent);
    if (!safeVaultTarget(root, target.file)) throw new Error(`unsafe vault target: ${target.file}`);
    return {
      area: target.area ?? area,
      file: target.file,
      oldBase64: oldContent?.toString("base64") ?? null,
      newBase64: newContent?.toString("base64") ?? null,
      oldHash: contentHash(oldContent),
      newHash: contentHash(newContent),
      mode: target.mode ?? "100644",
    };
  }

  /** Commits and installs one generalized exact-target operation under the map lock. */
  async function saveExact(buildPlan, { operationId, worldId = "area-tree", area = "", session = null, intent = {} } = {}) {
    if (!operationId || typeof buildPlan !== "function") throw new Error("exact vault transactions require an operation ID and plan builder");
    await ensureRecovered();
    if (recoveryRequired) return { status: 503, error: "Area map recovery requires attention", recoveryRequired };
    const requestDigest = digest(intent);
    const directory = operationDirectory(worldId, operationId);
    const manifestFile = path.join(directory, "manifest.json");
    return withLock(async () => {
      await recoverUnlocked();
      if (recoveryRequired) return { status: 503, error: "Area map recovery requires attention", recoveryRequired };
      try {
        const prior = JSON.parse(await readFile(manifestFile, "utf8"));
        if (prior.digest !== requestDigest) return { status: 409, conflict: true, operationId, error: "operation ID was already used for a different exact vault change" };
        if (prior.state === "committed") return { ...prior.result, idempotent: true };
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      const plan = await buildPlan();
      const unique = new Set();
      const targets = (plan.targets ?? []).map((target) => journalTarget(target, area));
      for (const target of targets) {
        if (unique.has(target.file)) throw new Error(`exact vault target appears more than once: ${target.file}`);
        unique.add(target.file);
      }
      targets.sort((left, right) => Number(targetBytes(left, "new") === null) - Number(targetBytes(right, "new") === null) || left.file.localeCompare(right.file));
      if (!targets.length) return { ...(plan.result ?? {}), committed: true, idempotent: true, operationId };
      const cleanupDirectories = [...new Set(plan.cleanupDirectories ?? [])].sort((left, right) => right.split("/").length - left.split("/").length || right.localeCompare(left));
      for (const value of cleanupDirectories) if (!safeVaultTarget(root, value)) throw new Error(`unsafe cleanup directory: ${value}`);
      const prepared = await vault.prepareExactCommit({
        files: targets.map((target) => ({ path: target.file, content: targetBytes(target, "new"), mode: target.mode })),
        message: plan.message,
        area,
        session,
        operationId,
      });
      const result = { ...(plan.result ?? {}), committed: true, operationId, idempotent: false };
      const manifest = {
        schema: "area-map-transaction.v3", operationId, worldId, digest: requestDigest, state: "prepared", exactClean: true,
        preparedAt: new Date().toISOString(), shardCount: targets.filter((target) => target.file.endsWith(".excalidraw")).length, prepared, targets, cleanupDirectories,
        directoryGuards: plan.directoryGuards ?? [], result,
      };
      await writeManifest(manifestFile, manifest);
      await checkpoint("prepared", phaseFields(manifest));
      const committed = await finishPrepared(manifest, manifestFile, { installRef: true, recheckTargets: true });
      return committed.result;
    }).catch((error) => {
      if (error?.simulatedCrash) throw error;
      emitEvent("area_map_save_phase", { operationId, phase: "failed", shardCount: 0, duration: 0 });
      reportError(`Exact vault transaction failed: ${error.message}`);
      return {
        status: Number(error?.status ?? 503), committed: false, operationId, error: error.message,
        ...(error?.conflict ? { conflict: true, changedPaths: error.changedPaths ?? [] } : {}),
      };
    });
  }

  return { read, recover: ensureRecovered, saveExact, saveMany, waitForReadable, withRead };
}

export default { createAreaMapTransactionRepository };
