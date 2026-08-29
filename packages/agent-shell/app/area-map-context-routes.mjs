import { readFile } from "node:fs/promises";
import { areaCanvasPath, parseAreaCanvas, safeCanvasPath } from "./area-canvas.mjs";
import { isAreaBoundary, isAreaRegion, areaForBlock } from "./public/area-board-core.js";
import { sendJson } from "./http-json.mjs";

/** Copies one Excalidraw element's spatial rectangle. */
const rect = (element) => element ? { x: element.x, y: element.y, width: element.width, height: element.height } : null;

/** Extracts only spatial facts needed to project one ancestor. */
export function sceneFrames(scene, childArea = "") {
  const visible = (scene?.elements ?? []).filter((element) => !element.isDeleted);
  const boundary = visible.find(isAreaBoundary) ?? null;
  const regions = visible.filter(isAreaRegion);
  const region = regions.find((element) => areaForBlock(element) === childArea) ?? null;
  return { boundary: rect(boundary), regionForChild: rect(region), elementId: region?.id ?? null, placedChildren: regions.map(areaForBlock).filter(Boolean) };
}

/** Parses first-commit Tangent element positions. */
export function legacyBaseline(scene) {
  return Object.fromEntries((scene?.elements ?? []).filter((element) => element.customData?.tangent).map((element) => [element.id, { x: element.x, y: element.y }]));
}

/** Creates the two read-only Area-map context routes. */
export function createAreaMapContextRoutes({ root, repository, runGit, areaExists }) {
  /** Reads one Area's authoritative scene. */
  const readScene = async (area) => repository.read(area);
  /** Reads the first committed geometry for one legacy scene. */
  async function baselineFor(area, current) {
    if (!current.exists || Number(current.scene?.tangent?.format ?? 0) >= 2) return null;
    const file = areaCanvasPath(area);
    try {
      const added = await runGit(["-C", root, "log", "--diff-filter=A", "--format=%H", "--", file]);
      const sha = String(added.stdout ?? "").trim().split("\n").at(-1);
      if (!sha) return null;
      const shown = await runGit(["-C", root, "show", `${sha}:${file}`]);
      const parsed = parseAreaCanvas(shown.stdout);
      return parsed.ok ? legacyBaseline(parsed.scene) : null;
    } catch { return null; }
  }
  /** Reads picker facts that belong to one target Area. */
  async function targetFacts(area) {
    const leaf = area.split("/").at(-1);
    const noteFile = `${area}/${leaf}.md`;
    let note = "";
    try { note = await readFile(safeCanvasPath(root, areaCanvasPath(area)).absolute.replace(/\.excalidraw$/, ".md"), "utf8"); } catch {}
    const resources = note.match(/^## Resources\s*$([\s\S]*?)(?=^## |\s*$)/m)?.[1] ?? "";
    const links = [...resources.matchAll(/^(?:-\s*)?([^:\n]+):\s*(https?:\/\/\S+)|https?:\/\/\S+/gm)].map((match) => ({ url: match[2] ?? match[0].trim(), label: match[1]?.trim() || new URL(match[2] ?? match[0].trim()).hostname }));
    let commits = [];
    try {
      const result = await runGit(["-C", root, "log", "-10", "--format=%x00%H%x1f%ct%x1f%s", "--name-only", "--", `${area}/`]);
      commits = String(result.stdout ?? "").split("\0").filter(Boolean).map((part) => { const [header, ...files] = part.trim().split("\n"); const [sha, at, subject] = header.split("\x1f"); return { sha, at: Number(at) * 1000, subject, files: files.filter(Boolean) }; });
    } catch {}
    const scene = await readScene(area);
    return { area, name: leaf, path: area.split("/"), status: "active", placedChildren: sceneFrames(scene.scene).placedChildren, commits, links, noteFile };
  }
  /** Handles a matching context or target GET request. */
  async function handle(request, response, url) {
    if (!["/api/areas/map-context", "/api/areas/map-target"].includes(url.pathname)) return false;
    if (request.method !== "GET") return false;
    const area = String(url.searchParams.get("area") ?? "");
    if (!await areaExists(area)) { sendJson(response, 404, { error: `no Area ${area || "(none)"}` }); return true; }
    if (url.pathname.endsWith("map-target")) { sendJson(response, 200, await targetFacts(area)); return true; }
    const parts = area.split("/"); const current = await readScene(area); const ancestors = [];
    for (let depth = 1; depth < parts.length; depth += 1) {
      const ancestorArea = parts.slice(0, depth).join("/"); const childArea = parts.slice(0, depth + 1).join("/"); const source = await readScene(ancestorArea);
      ancestors.push({ area: ancestorArea, name: parts[depth - 1], status: "active", exists: source.exists, hash: source.hash, ...sceneFrames(source.scene, childArea) });
    }
    sendJson(response, 200, { area, hash: current.hash, ancestors, legacyBaseline: await baselineFor(area, current) }); return true;
  }
  return { handle };
}
