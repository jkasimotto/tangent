import type { IncomingMessage } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { tangentHome } from "@tangent/core";
import type { LocalUiApp, StaticAssetMount, UiModePreference, UiRoute } from "@tangent/ui-server";
import { pipelineUiEmbeddedAssets } from "@tangent/pipeline-ui/assets";

/** One feature row for the Designs list: enough to scan and select, never to render metadata. */
export type PipelineFeatureSummary = {
  slug: string;
  title: string;
  status: string;
  /** Newest-first sort key only; the UI never renders this (per the UX "NEVER" list). */
  updatedAt: string;
};

/** The scope-stage output for one feature: the two prose blocks the Designs detail pane renders. */
export type PipelineScope = {
  slug: string;
  title: string;
  status: string;
  /** Markdown body of the "## Real problem" section; empty string if absent. */
  realProblem: string;
  /** Markdown body of the "## Minimal surgical solution" section; empty string if absent. */
  proposedDesign: string;
};

export type PipelineUiApp = {
  app: LocalUiApp;
  routes: UiRoute[];
  assetMounts: StaticAssetMount[];
};

export type PipelineUiAppOptions = {
  /** Overridable features directory for tests; defaults to `<tangentHome>/.tangent/features`. */
  featuresDir?: string;
  mode?: UiModePreference;
};

/**
 * Maps a source `## heading` in 10-scope.md to an output field on PipelineScope. The Designs view
 * surfaces only these two sections; the deferred full-dossier viewer would add rows here, not new
 * parsing logic. Order is the on-disk order; the parser is heading-keyed, not positional.
 */
const SCOPE_SECTIONS: ReadonlyArray<{ heading: string; field: "realProblem" | "proposedDesign" }> = [
  { heading: "Real problem", field: "realProblem" },
  { heading: "Minimal surgical solution", field: "proposedDesign" }
];

/** Creates a Designs (pipeline) app registration for the combined Tangent UI. */
export async function createPipelineUiApp(options: PipelineUiAppOptions = {}): Promise<PipelineUiApp> {
  const mode = options.mode || "static";
  const devRoot = mode !== "static" ? await pipelineUiSourceRoot() : undefined;
  return {
    app: {
      id: "pipeline",
      label: "Designs",
      routePath: "/pipeline",
      modulePath: devRoot ? "/apps/pipeline/src/embedded.ts" : "/apps/pipeline/embedded.js",
      stylePaths: devRoot ? [] : ["/apps/pipeline/embedded.css"]
    },
    routes: pipelineApiRoutes(options),
    assetMounts: [{ pathPrefix: "/apps/pipeline", assets: devRoot ? { ...pipelineUiEmbeddedAssets, dev: { sourceRoot: devRoot } } : pipelineUiEmbeddedAssets }]
  };
}

/** Resolves the workspace pipeline UI source root if this install includes it. */
async function pipelineUiSourceRoot(): Promise<string | undefined> {
  const assetsUrl = import.meta.resolve("@tangent/pipeline-ui/assets");
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

/** Resolves the features directory: the test override, else `<tangentHome>/.tangent/features`. */
function resolveFeaturesDir(options: PipelineUiAppOptions): string {
  return options.featuresDir || path.join(tangentHome(), ".tangent", "features");
}

/** Builds the GET-only Designs API routes for the local UI server. */
function pipelineApiRoutes(options: PipelineUiAppOptions): UiRoute[] {
  return [{
    pattern: /^\/api\/pipeline(?:\/.*)?$/,
    /** Handles a Designs API request. */
    handle: (request, url) => handlePipelineApiRequest(request, url, options)
  }];
}

/** Handles one local Designs API request. The view is read-only, so only GET is served. */
async function handlePipelineApiRequest(request: IncomingMessage, url: URL, options: PipelineUiAppOptions): Promise<{ status: number; json: unknown }> {
  try {
    const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    if (parts[0] !== "api" || parts[1] !== "pipeline") return json(404, { error: "Not found." });

    // The Designs view never writes; the readonly guard is kept for verify-harness parity with the other apps.
    if (request.method !== "GET" && process.env.TANGENT_VERIFY_READONLY) return json(403, { error: "Writes disabled in verify harness." });
    if (request.method !== "GET") return json(405, { error: "Method not allowed." });

    const featuresDir = resolveFeaturesDir(options);

    if (parts.length === 3 && parts[2] === "features") {
      return json(200, { features: await listFeatures(featuresDir) });
    }

    if (parts.length === 5 && parts[2] === "features" && parts[4] === "scope") {
      const scope = await readScope(featuresDir, parts[3]!);
      return scope ? json(200, scope) : json(404, { error: `No scope for feature: ${parts[3]}` });
    }

    return json(404, { error: "Not found." });
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : String(error) });
  }
}

type FeatureManifest = { slug?: string; title?: string; status?: string; updatedAt?: string };

/** Lists features that have a readable 10-scope.md, newest-first. Slugs still in feedback/promoted are skipped. */
async function listFeatures(featuresDir: string): Promise<PipelineFeatureSummary[]> {
  const slugs = await readSlugs(featuresDir);
  const summaries: PipelineFeatureSummary[] = [];
  for (const slug of slugs) {
    const manifest = await readManifest(featuresDir, slug);
    if (!manifest) continue;
    if (!(await isFile(path.join(featuresDir, slug, "10-scope.md")))) continue;
    summaries.push({
      slug,
      title: typeof manifest.title === "string" && manifest.title.trim() ? manifest.title : slug,
      status: typeof manifest.status === "string" ? manifest.status : "",
      updatedAt: typeof manifest.updatedAt === "string" ? manifest.updatedAt : ""
    });
  }
  return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/** Reads and parses the scope-stage output for one feature, or null if it has no 10-scope.md. */
async function readScope(featuresDir: string, slug: string): Promise<PipelineScope | null> {
  const manifest = await readManifest(featuresDir, slug);
  if (!manifest) return null;
  const markdown = await readFile(path.join(featuresDir, slug, "10-scope.md"), "utf8").catch(() => null);
  if (markdown === null) return null;
  const sections = parseScopeSections(markdown);
  return {
    slug,
    title: typeof manifest.title === "string" && manifest.title.trim() ? manifest.title : slug,
    status: typeof manifest.status === "string" ? manifest.status : "",
    realProblem: sections.realProblem,
    proposedDesign: sections.proposedDesign
  };
}

/**
 * Extracts the mapped `## heading` sections from a scope file. Slices the body between a
 * `## <heading>` line and the next `## ` line (heading-agnostic to the rest of the file), so
 * extra or renamed sections never break the two the Designs view cares about.
 */
function parseScopeSections(markdown: string): { realProblem: string; proposedDesign: string } {
  const result = { realProblem: "", proposedDesign: "" };
  const lines = markdown.split("\n");
  for (const { heading, field } of SCOPE_SECTIONS) {
    const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
    if (start === -1) continue;
    // The next level-2 heading ends this section. `## ` excludes deeper `### ` headings,
    // so `### Decision taken` under `## Why this is the floor` does not split a section early.
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      if (lines[index]!.trim().startsWith("## ")) { end = index; break; }
    }
    result[field] = lines.slice(start + 1, end).join("\n").trim();
  }
  return result;
}

/** Lists immediate feature subdirectory names under the features dir; empty if the dir is missing. */
async function readSlugs(featuresDir: string): Promise<string[]> {
  const entries = await readdir(featuresDir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

/** Reads and parses a feature's manifest, or null if it is missing or invalid. */
async function readManifest(featuresDir: string, slug: string): Promise<FeatureManifest | null> {
  const raw = await readFile(path.join(featuresDir, slug, "feature.json"), "utf8").catch(() => null);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as FeatureManifest) : null;
  } catch {
    return null;
  }
}

/** Wraps a value as a JSON route response. */
function json(status: number, value: unknown): { status: number; json: unknown } {
  return { status, json: value };
}
