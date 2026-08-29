import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export function createAreaMapRecordStore({ root }) {
  function file(area, name) {
    if (typeof area !== "string" || !area || area.startsWith("/") || area.includes("\\") || path.posix.normalize(area) !== area || area.includes("..")) throw new Error(`unsafe Area path: ${area}`);
    return path.join(root, "areas", ...area.split("/"), name);
  }
  async function read(area, name, fallback) { try { return JSON.parse(await readFile(file(area, name), "utf8")); } catch (error) { if (error.code === "ENOENT") return structuredClone(fallback); throw error; } }
  async function write(area, name, value) { const target = file(area, name); await mkdir(path.dirname(target), { recursive: true }); const temporary = `${target}.${process.pid}.${Date.now()}.tmp`; await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); await rename(temporary, target); return value; }
  return { file, read, write };
}
