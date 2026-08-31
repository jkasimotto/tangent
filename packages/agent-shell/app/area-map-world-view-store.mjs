import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const VIEW_SCHEMA = "area-map-view.v2";

/** Reports whether a world ID is safe for one private state file. */
export function validAreaMapWorldId(worldId) {
  return typeof worldId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(worldId);
}

/** Creates the private, world-keyed Area-map view store. */
export function createAreaMapWorldViewStore({ root, beforeWrite = null }) {
  const writeQueues = new Map();

  /** Returns the one view-state file for a validated world ID. */
  function file(worldId) {
    if (!validAreaMapWorldId(worldId)) throw Object.assign(new Error("worldId is invalid"), { status: 400 });
    return path.join(root, `${worldId}.world-v2.json`);
  }

  /** Reads one valid view without making corrupt private state authoritative. */
  async function read(worldId) {
    const target = file(worldId);
    try {
      const value = JSON.parse(await readFile(target, "utf8"));
      return value?.schema === VIEW_SCHEMA && value.worldId === worldId ? value : null;
    } catch (error) {
      if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  /** Atomically replaces one validated private world view. */
  async function replace(worldId, view, target) {
    await beforeWrite?.(worldId, view);
    await mkdir(root, { recursive: true });
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(view)}\n`, "utf8");
    await rename(temporary, target);
    return view;
  }

  /** Serializes writes per world so the newest invocation remains authoritative. */
  async function write(worldId, view) {
    if (view?.schema !== VIEW_SCHEMA || view.worldId !== worldId) {
      throw Object.assign(new Error("area-map-view.v2 with a matching worldId is required"), { status: 400 });
    }
    const target = file(worldId);
    const previous = writeQueues.get(worldId) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(() => replace(worldId, view, target));
    writeQueues.set(worldId, task);
    try { return await task; }
    finally { if (writeQueues.get(worldId) === task) writeQueues.delete(worldId); }
  }

  return { file, read, write };
}

export default { createAreaMapWorldViewStore, validAreaMapWorldId };
