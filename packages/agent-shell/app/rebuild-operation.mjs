import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonObject, writeJsonObject } from "./json-store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ACTIVE_PHASES = new Set(["building", "restarting", "reconnecting"]);
const STALE_MS = 15 * 60 * 1000;

/** True when one persisted rebuild still owns the shell lifecycle. */
export function rebuildIsActive(operation) {
  return Boolean(operation && ACTIVE_PHASES.has(operation.phase));
}

/** Reads the last rebuild record without changing it. */
export function readRebuildOperation(file) {
  return readJsonObject(file);
}

/** Creates the durable Agent Shell rebuild lifecycle. */
export function createRebuildOperations({ file, root, log, bootId, serverPid = process.pid, revisions, now = () => Date.now(), launch = launchWorker }) {
  /** Reads the record and settles states that crossed a server generation. */
  async function current() {
    const operation = await readRebuildOperation(file);
    if (!operation) return null;
    if (["restarting", "reconnecting"].includes(operation.phase) && operation.oldBoot !== bootId) {
      return writeJsonObject(file, { ...operation, phase: "succeeded", finishedAt: now(), newBoot: bootId });
    }
    if (rebuildIsActive(operation) && now() - Number(operation.updatedAt || operation.startedAt || 0) > STALE_MS) {
      return writeJsonObject(file, { ...operation, phase: "failed", finishedAt: now(), updatedAt: now(), error: `The rebuild stopped during ${operation.phase}. Read ${log}.` });
    }
    return operation;
  }

  /** Starts one rebuild and returns the exact captured commit target. */
  async function start() {
    const existing = await current();
    if (rebuildIsActive(existing)) return { status: 409, value: { error: "A Tangent rebuild is already active.", operation: existing } };
    const revision = await revisions();
    const stamp = now();
    const operation = {
      id: randomUUID(),
      phase: "building",
      oldBoot: bootId,
      oldCommit: revision.deployedCommit,
      targetCommit: revision.currentCommit,
      commits: revision.commits,
      startedAt: stamp,
      updatedAt: stamp,
      log,
    };
    await writeJsonObject(file, operation);
    launch({ file, root, log, serverPid, targetCommit: operation.targetCommit });
    return { status: 202, value: { ok: true, operation } };
  }

  return { current, start };
}

/** Launches the process that can survive and restart the current server. */
function launchWorker({ file, root, log, serverPid, targetCommit }) {
  const worker = path.join(here, "rebuild-worker.mjs");
  const child = spawn(process.execPath, [worker, file, root, log, String(serverPid), targetCommit], { detached: true, stdio: "ignore" });
  child.unref();
}
