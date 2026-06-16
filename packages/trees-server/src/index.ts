import type { IncomingMessage } from "node:http";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { TreeEntity } from "@tangent/trees-schema";
import { openFsTrees, type FsTreesClientOptions } from "@tangent/trees-runtime/fs";
import type { LocalUiApp, StaticAssetMount, UiModePreference, UiRoute } from "@tangent/ui-server";
import { treesUiEmbeddedAssets } from "@tangent/trees-ui/assets";

export type TreesUiApp = {
  app: LocalUiApp;
  routes: UiRoute[];
  assetMounts: StaticAssetMount[];
};

export type TreesUiAppOptions = {
  store?: FsTreesClientOptions;
  mode?: UiModePreference;
};

/** Creates a Trees app registration for the combined Tangent UI. */
export async function createTreesUiApp(options: TreesUiAppOptions = {}): Promise<TreesUiApp> {
  const mode = options.mode || "static";
  const devRoot = mode !== "static" ? await treesUiSourceRoot() : undefined;
  return {
    app: {
      id: "trees",
      label: "Trees",
      routePath: "/trees",
      modulePath: devRoot ? "/apps/trees/src/embedded.ts" : "/apps/trees/embedded.js",
      stylePaths: devRoot ? [] : ["/apps/trees/embedded.css"]
    },
    routes: treesApiRoutes(options),
    assetMounts: [{ pathPrefix: "/apps/trees", assets: devRoot ? { ...treesUiEmbeddedAssets, dev: { sourceRoot: devRoot } } : treesUiEmbeddedAssets }]
  };
}

/** Resolves the workspace Trees UI source root if this install includes it. */
async function treesUiSourceRoot(): Promise<string | undefined> {
  const assetsUrl = import.meta.resolve("@tangent/trees-ui/assets");
  let current = path.dirname(fileURLToPath(assetsUrl));
  for (let index = 0; index < 6; index += 1) {
    const packageJson = path.join(current, "package.json");
    const indexHtml = path.join(current, "index.html");
    const main = path.join(current, "src", "main.ts");
    if (await isFile(packageJson) && await isFile(indexHtml) && await isFile(main)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

/** Tests whether a path is a readable file. */
async function isFile(filePath: string): Promise<boolean> {
  return stat(filePath).then((entry) => entry.isFile()).catch(() => false);
}

/** Builds Trees API routes for the local UI server. */
function treesApiRoutes(options: TreesUiAppOptions): UiRoute[] {
  return [{
    pattern: /^\/api\/trees(?:\/.*)?$/,
    /** Handles a Trees API request. */
    handle: (request, url) => handleTreesApiRequest(request, url, options)
  }];
}

/** Handles one local Trees API request. */
async function handleTreesApiRequest(request: IncomingMessage, url: URL, options: TreesUiAppOptions): Promise<{ status: number; json: unknown }> {
  try {
    const client = await openFsTrees({
      ...options.store,
      source: options.store?.source || { id: "trees-ui", kind: "trees-ui" }
    });
    const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    if (parts[0] !== "api" || parts[1] !== "trees") return json(404, { error: "Not found." });

    if (request.method === "GET" && parts.length === 3 && parts[2] === "workspace") {
      return json(200, await workspace(client));
    }

    if (request.method === "POST" && parts.length === 4 && parts[2] === "entities" && parts[3] === "path") {
      const input = await readJson(request);
      await createPath(client, requiredString(input.path, "path"));
      return json(200, await workspace(client));
    }

    if (request.method === "POST" && parts.length === 5 && parts[2] === "entities" && parts[4] === "leaf") {
      const input = await readJson(request);
      await saveLeaf(client, parts[3]!, {
        projectId: requiredString(input.projectId, "projectId"),
        branch: requiredString(input.branch, "branch"),
        worktreePath: optionalString(input.worktreePath)
      });
      return json(200, await workspace(client));
    }

    if (request.method === "POST" && parts.length === 6 && parts[2] === "entities" && parts[4] === "leaf" && parts[5] === "clear") {
      await clearLeaf(client, parts[3]!);
      return json(200, await workspace(client));
    }

    if (url.pathname.startsWith("/api/trees")) return json(request.method === "GET" || request.method === "POST" ? 404 : 405, { error: request.method === "GET" || request.method === "POST" ? "Not found." : "Method not allowed." });
    return json(404, { error: "Not found." });
  } catch (error) {
    return json(errorStatus(error), { error: error instanceof Error ? error.message : String(error) });
  }
}

/** Returns the UI workspace DTO from the current Trees projection. */
async function workspace(client: Awaited<ReturnType<typeof openFsTrees>>) {
  const projection = await client.projection();
  return {
    entities: projection.entities.map((entity) => ({
      id: entity.id,
      path: entity.path,
      title: entity.title,
      projectId: entity.projectId,
      branch: entity.branch,
      worktreePath: entity.worktreePath,
      kind: entity.kind
    })),
    projects: projection.projects.map((project) => ({
      id: project.id,
      name: project.name,
      path: project.path
    }))
  };
}

/** Creates missing unconfigured group-ready entities for a path. */
async function createPath(client: Awaited<ReturnType<typeof openFsTrees>>, rawPath: string): Promise<void> {
  const path = normalizeTreePath(rawPath);
  const projection = await client.projection();
  const entities = projection.entities;
  const locked = lockedPrefix(path, entities);
  if (locked) throw statusError(400, `${locked} is configured as a leaf. Clear its project and branch before adding children.`);
  const parts = path.split("/");
  for (let index = 0; index < parts.length; index += 1) {
    const nextPath = parts.slice(0, index + 1).join("/");
    if (!entities.some((entity) => entity.path === nextPath)) {
      const entity = await client.entities.create({ path: nextPath, kind: "group" });
      entities.push(entity);
    }
  }
}

/** Saves leaf metadata on a terminal entity. */
async function saveLeaf(client: Awaited<ReturnType<typeof openFsTrees>>, ref: string, input: { projectId: string; branch: string; worktreePath?: string }): Promise<void> {
  const projection = await client.projection();
  const entity = resolveEntity(projection.entities, ref);
  if (hasChildren(entity.path, projection.entities)) throw statusError(400, "Nodes with children cannot be locked as leaves.");
  if (!projection.projects.some((project) => project.id === input.projectId)) throw statusError(400, `Unknown tree project: ${input.projectId}`);
  await client.entities.update(entity.id, {
    kind: "work",
    projectId: input.projectId,
    branch: input.branch.trim(),
    worktreePath: input.worktreePath
  });
}

/** Clears leaf metadata using a full entity replacement event. */
async function clearLeaf(client: Awaited<ReturnType<typeof openFsTrees>>, ref: string): Promise<void> {
  const entity = resolveEntity((await client.projection()).entities, ref);
  const replacement: TreeEntity = {
    ...entity,
    kind: "group",
    projectId: undefined,
    branch: undefined,
    worktreePath: undefined,
    updatedAt: new Date().toISOString()
  };
  await client.events.append({ type: "entity.updated", entityId: entity.id, data: { entity: replacement } });
}

/** Resolves an entity by id, exact path, or unique path suffix. */
function resolveEntity(entities: TreeEntity[], ref: string): TreeEntity {
  const direct = entities.find((entity) => entity.id === ref || entity.path === ref);
  if (direct) return direct;
  const matches = entities.filter((entity) => entity.path.endsWith(`/${ref}`));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) throw statusError(400, `Ambiguous tree path '${ref}': ${matches.map((entity) => entity.path).join(", ")}`);
  throw statusError(404, `Unknown tree entity: ${ref}`);
}

/** Finds the first configured terminal prefix that would block child creation. */
function lockedPrefix(path: string, entities: TreeEntity[]): string | undefined {
  const parts = path.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    const prefix = parts.slice(0, index).join("/");
    const entity = entities.find((candidate) => candidate.path === prefix);
    if (entity?.projectId && entity.branch && !hasChildren(prefix, entities)) return prefix;
  }
  return undefined;
}

/** Tests whether an entity path has descendants. */
function hasChildren(path: string, entities: TreeEntity[]): boolean {
  return entities.some((entity) => entity.path.startsWith(`${path}/`));
}

/** Normalizes and validates a tree path from an API request. */
function normalizeTreePath(value: string): string {
  const path = value.trim().replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
  if (!path) throw statusError(400, "Path is required.");
  if (path.split("/").some((part) => !part || part === "." || part === "..")) throw statusError(400, "Invalid tree path.");
  return path;
}

/** Reads a JSON object body from the request. */
async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of request) body += chunk;
  if (!body.trim()) return {};
  const parsed = JSON.parse(body) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw statusError(400, "Expected JSON object body.");
  return parsed as Record<string, unknown>;
}

/** Reads a required string field from an API body. */
function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw statusError(400, `${field} is required.`);
  return value.trim();
}

/** Reads an optional string field from an API body. */
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Wraps a value as a JSON route response. */
function json(status: number, value: unknown): { status: number; json: unknown } {
  return { status, json: value };
}

/** Creates an HTTP status-bearing error. */
function statusError(status: number, message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

/** Maps thrown errors to an HTTP status code. */
function errorStatus(error: unknown): number {
  const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
  if (typeof status === "number") return status;
  if (error instanceof SyntaxError) return 400;
  return 500;
}
