import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** Creates the JSON record store for one vault root, one file per Area and record name. */
export function createAreaMapRecordStore({ root }) {
  /** Resolves a record's path under its Area, rejecting unsafe Area paths. */
  function file(area, name) {
    if (typeof area !== "string" || !area || area.startsWith("/") || area.includes("\\") || path.posix.normalize(area) !== area || area.includes("..")) throw new Error(`unsafe Area path: ${area}`);
    return path.join(root, "areas", ...area.split("/"), name);
  }
  /** Reads a record, or a clone of the fallback when it does not exist yet. */
  async function read(area, name, fallback) { try { return JSON.parse(await readFile(file(area, name), "utf8")); } catch (error) { if (error.code === "ENOENT") return structuredClone(fallback); throw error; } }
  /** Writes a record atomically through a temporary file and returns the value. */
  async function write(area, name, value) { const target = file(area, name); await mkdir(path.dirname(target), { recursive: true }); const temporary = `${target}.${process.pid}.${Date.now()}.tmp`; await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); await rename(temporary, target); return value; }
  return { file, read, write };
}
