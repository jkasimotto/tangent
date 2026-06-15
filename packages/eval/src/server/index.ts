import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { collectEval } from "../core/metrics.js";
import { listRuns, loadRunManifest } from "../core/run-store.js";
import type { EvalMetrics } from "../types/metrics.js";
import type { EvalRunManifest } from "../types/run.js";
import { buildComparisonView } from "./compare.js";
import { variantSummary, type EvalRunListItem, type EvalRunView } from "./dto.js";
import { createEvalJobManager } from "./jobs.js";
import { createEvalSpecRegistry } from "./specs.js";
import type { UiRoute, UiRouteResponse } from "@tangent/ui-server";

export type StartEvalUiServerOptions = {
  runId?: string;
  specPath?: string;
  cwd?: string;
  host?: string;
  port?: number;
  open?: boolean;
};

export type EvalUiServer = {
  url: string;
  runId?: string;
  close(): Promise<void>;
};

/** Supports the start eval ui server helper. */
export async function startEvalUiServer(options: StartEvalUiServerOptions = {}): Promise<EvalUiServer> {
  const host = options.host || "127.0.0.1";
  const cwd = options.cwd || process.cwd();
  const preferredRunId = options.runId ? await resolveRunId(options.runId) : (await listRuns())[0]?.id;
  const specs = createEvalSpecRegistry({ cwd, explicitSpecPath: options.specPath });
  const jobs = createEvalJobManager({ cwd });
  const [{ createLocalUiServer }, { evalUiAssets }] = await Promise.all([
    import("@tangent/ui-server"),
    import("@tangent/eval-ui/assets")
  ]);
  const server = await createLocalUiServer({
    product: "eval",
    host,
    port: options.port ?? 0,
    open: Boolean(options.open),
    assets: evalUiAssets,
    routes: evalApiRoutes({ preferredRunId, specs, jobs })
  });
  return {
    url: server.url,
    runId: preferredRunId,
    close: server.close
  };
}

type EvalUiRequestContext = {
  preferredRunId?: string;
  specs: ReturnType<typeof createEvalSpecRegistry>;
  jobs: ReturnType<typeof createEvalJobManager>;
};

/** Supports the eval api routes helper. */
function evalApiRoutes(context: EvalUiRequestContext): UiRoute[] {
  return [{
    pattern: /^\/api\/eval(?:\/.*)?$/,
    /** Handles the local UI request. */
    handle: (request, url) => handleApiRequest(request, url, context)
  }];
}

/** Handles the local UI request. */
async function handleApiRequest(request: http.IncomingMessage, url: URL, context: EvalUiRequestContext): Promise<UiRouteResponse> {
  try {
    const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    if (parts[0] === "api" && parts[1] === "eval" && parts[2] === "specs") {
      if (request.method === "GET" && parts.length === 3) return json(200, await context.specs.listSpecs());
      if (request.method === "GET" && parts.length === 4) return json(200, await context.specs.getSpec(parts[3]!));
      if (request.method === "GET" && parts.length === 5 && parts[4] === "context") {
        return json(200, await context.specs.getContext(parts[3]!, requiredParam(url, "caseId"), requiredParam(url, "variantId")));
      }
      if (request.method === "POST" && parts.length === 5 && parts[4] === "runs") {
        const specPath = await context.specs.resolveSpecPath(parts[3]!);
        return json(202, context.jobs.start(parts[3]!, specPath));
      }
    }
    if (parts[0] === "api" && parts[1] === "eval" && parts[2] === "jobs" && parts[3]) {
      if (request.method === "GET" && parts.length === 4) return json(200, context.jobs.get(parts[3]));
      if (request.method === "GET" && parts.length === 5 && parts[4] === "events") {
        return json(200, context.jobs.events(parts[3], numberParam(url.searchParams.get("after"))));
      }
      if (request.method === "POST" && parts.length === 5 && parts[4] === "cancel") return json(200, context.jobs.cancel(parts[3]));
    }
    if (request.method !== "GET") return json(405, { error: "Method not allowed." });
    if (url.pathname === "/api/eval/runs") {
      const runs = await listRuns();
      return json(200, runs.map(runListItem));
    }
    if (parts[0] === "api" && parts[1] === "eval" && parts[2] === "runs" && parts[3]) {
      const runId = await resolveRunId(parts[3] === "selected" && context.preferredRunId ? context.preferredRunId : parts[3]);
      if (parts.length === 4) return json(200, await runView(runId));
      if (parts.length === 5 && parts[4] === "status") return json(200, await loadRunManifest(runId));
      if (parts.length === 5 && parts[4] === "metrics") return json(200, await loadMetrics(await loadRunManifest(runId)));
      if (parts.length === 5 && parts[4] === "compare") {
        const manifest = await loadRunManifest(runId);
        const metrics = await loadMetrics(manifest);
        const caseId = requiredParam(url, "caseId");
        const left = requiredParam(url, "a");
        const right = requiredParam(url, "b");
        const phase = phaseParam(url.searchParams.get("phase") || "impl");
        return json(200, await buildComparisonView({ manifest, metrics, caseId, left, right, phase }));
      }
    }
    return json(404, { error: "Not found." });
  } catch (error) {
    return json(errorStatus(error), { error: (error as Error).message });
  }
}

/** Supports the run view helper. */
async function runView(runId: string): Promise<EvalRunView> {
  const manifest = await loadRunManifest(runId);
  const metrics = await loadMetrics(manifest);
  const metricMap = new Map(metrics.map((metric) => [`${metric.caseId}:${metric.variantId}`, metric]));
  const caseIds = [...new Set(manifest.variants.map((variant) => variant.caseId))];
  return {
    run: manifest,
    metrics,
    cases: caseIds.map((caseId) => ({
      caseId,
      variants: manifest.variants
        .filter((variant) => variant.caseId === caseId)
        .map((variant) => variantSummary(variant, metricMap.get(`${variant.caseId}:${variant.variantId}`)))
    }))
  };
}

/** Loads metrics. */
async function loadMetrics(manifest: EvalRunManifest): Promise<EvalMetrics[]> {
  const report = await readFile(path.join(manifest.runDir, "report.json"), "utf8")
    .then((text) => JSON.parse(text) as EvalMetrics[])
    .catch(() => undefined);
  if (report) return report;

  const rows: EvalMetrics[] = [];
  for (const variant of manifest.variants) {
    const metric = await readFile(variant.metricsPath, "utf8")
      .then((text) => JSON.parse(text) as EvalMetrics)
      .catch(() => undefined);
    if (metric) rows.push(metric);
  }
  if (rows.length === manifest.variants.length) return rows;
  return (await collectEval(manifest)).metrics;
}

/** Supports the run list item helper. */
function runListItem(run: EvalRunManifest): EvalRunListItem {
  const statuses: Record<string, number> = {};
  for (const variant of run.variants) statuses[variant.status] = (statuses[variant.status] || 0) + 1;
  return { id: run.id, name: run.name, createdAt: run.createdAt, runDir: run.runDir, variants: run.variants.length, statuses };
}

/** Resolves run id. */
async function resolveRunId(value: string): Promise<string> {
  if (value !== "latest") return value;
  const latest = (await listRuns())[0];
  if (!latest) throw new Error("No eval runs found.");
  return latest.id;
}

/** Reads the required param. */
function requiredParam(url: URL, key: string): string {
  const value = url.searchParams.get(key);
  if (!value) throw new Error(`Missing query parameter: ${key}`);
  return value;
}

/** Reads the numeric param. */
function numberParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Reads the requested eval phase. */
function phaseParam(value: string): "context" | "plan" | "impl" | "all" {
  if (value === "context" || value === "plan" || value === "impl" || value === "all") return value;
  throw new Error("phase must be context, plan, impl, or all.");
}

/** Sends a JSON response. */
function json(status: number, value: unknown): UiRouteResponse {
  return { status, json: value };
}

/** Supports the error status helper. */
function errorStatus(error: unknown): number {
  const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
  return typeof status === "number" && status >= 400 && status < 600 ? status : 500;
}
