import { spawn } from "node:child_process";
import http, { type Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { collectEval } from "../core/metrics.js";
import { listRuns, loadRunManifest } from "../core/run-store.js";
import type { EvalMetrics } from "../types/metrics.js";
import type { EvalRunManifest } from "../types/run.js";
import { buildComparisonView } from "./compare.js";
import { staticResponse } from "./static.js";
import { variantSummary, type EvalRunListItem, type EvalRunView } from "./dto.js";
import { createEvalJobManager } from "./jobs.js";
import { createEvalSpecRegistry } from "./specs.js";

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

export async function startEvalUiServer(options: StartEvalUiServerOptions = {}): Promise<EvalUiServer> {
  const host = options.host || "127.0.0.1";
  const cwd = options.cwd || process.cwd();
  const preferredRunId = options.runId ? await resolveRunId(options.runId) : (await listRuns())[0]?.id;
  const specs = createEvalSpecRegistry({ cwd, explicitSpecPath: options.specPath });
  const jobs = createEvalJobManager({ cwd });
  const server = http.createServer((request, response) => {
    void handleRequest(request, response, { preferredRunId, specs, jobs });
  });
  await listen(server, options.port ?? 0, host);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Eval UI server did not bind to a TCP address.");
  const url = `http://${host}:${address.port}/`;
  if (options.open) openBrowser(url);
  return {
    url,
    runId: preferredRunId,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

type EvalUiRequestContext = {
  preferredRunId?: string;
  specs: ReturnType<typeof createEvalSpecRegistry>;
  jobs: ReturnType<typeof createEvalJobManager>;
};

async function handleRequest(request: http.IncomingMessage, response: http.ServerResponse, context: EvalUiRequestContext): Promise<void> {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    const staticAsset = staticResponse(url.pathname);
    if (staticAsset) return send(response, 200, staticAsset.body, staticAsset.contentType);

    const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    if (parts[0] === "api" && parts[1] === "eval" && parts[2] === "specs") {
      if (request.method === "GET" && parts.length === 3) return sendJson(response, 200, await context.specs.listSpecs());
      if (request.method === "GET" && parts.length === 4) return sendJson(response, 200, await context.specs.getSpec(parts[3]!));
      if (request.method === "GET" && parts.length === 5 && parts[4] === "context") {
        return sendJson(response, 200, await context.specs.getContext(parts[3]!, requiredParam(url, "caseId"), requiredParam(url, "variantId")));
      }
      if (request.method === "POST" && parts.length === 5 && parts[4] === "runs") {
        const specPath = await context.specs.resolveSpecPath(parts[3]!);
        return sendJson(response, 202, context.jobs.start(parts[3]!, specPath));
      }
    }
    if (parts[0] === "api" && parts[1] === "eval" && parts[2] === "jobs" && parts[3]) {
      if (request.method === "GET" && parts.length === 4) return sendJson(response, 200, context.jobs.get(parts[3]));
      if (request.method === "GET" && parts.length === 5 && parts[4] === "events") {
        return sendJson(response, 200, context.jobs.events(parts[3], numberParam(url.searchParams.get("after"))));
      }
      if (request.method === "POST" && parts.length === 5 && parts[4] === "cancel") return sendJson(response, 200, context.jobs.cancel(parts[3]));
    }
    if (request.method !== "GET") return sendJson(response, 405, { error: "Method not allowed." });
    if (url.pathname === "/api/eval/runs") {
      const runs = await listRuns();
      return sendJson(response, 200, runs.map(runListItem));
    }
    if (parts[0] === "api" && parts[1] === "eval" && parts[2] === "runs" && parts[3]) {
      const runId = await resolveRunId(parts[3] === "selected" && context.preferredRunId ? context.preferredRunId : parts[3]);
      if (parts.length === 4) return sendJson(response, 200, await runView(runId));
      if (parts.length === 5 && parts[4] === "status") return sendJson(response, 200, await loadRunManifest(runId));
      if (parts.length === 5 && parts[4] === "metrics") return sendJson(response, 200, await loadMetrics(await loadRunManifest(runId)));
      if (parts.length === 5 && parts[4] === "compare") {
        const manifest = await loadRunManifest(runId);
        const metrics = await loadMetrics(manifest);
        const caseId = requiredParam(url, "caseId");
        const left = requiredParam(url, "a");
        const right = requiredParam(url, "b");
        const phase = phaseParam(url.searchParams.get("phase") || "impl");
        return sendJson(response, 200, await buildComparisonView({ manifest, metrics, caseId, left, right, phase }));
      }
    }
    return sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    return sendJson(response, errorStatus(error), { error: (error as Error).message });
  }
}

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

function runListItem(run: EvalRunManifest): EvalRunListItem {
  const statuses: Record<string, number> = {};
  for (const variant of run.variants) statuses[variant.status] = (statuses[variant.status] || 0) + 1;
  return { id: run.id, name: run.name, createdAt: run.createdAt, runDir: run.runDir, variants: run.variants.length, statuses };
}

async function resolveRunId(value: string): Promise<string> {
  if (value !== "latest") return value;
  const latest = (await listRuns())[0];
  if (!latest) throw new Error("No eval runs found.");
  return latest.id;
}

function requiredParam(url: URL, key: string): string {
  const value = url.searchParams.get(key);
  if (!value) throw new Error(`Missing query parameter: ${key}`);
  return value;
}

function numberParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function phaseParam(value: string): "context" | "plan" | "impl" | "all" {
  if (value === "context" || value === "plan" || value === "impl" || value === "all") return value;
  throw new Error("phase must be context, plan, impl, or all.");
}

function sendJson(response: http.ServerResponse, status: number, value: unknown): void {
  send(response, status, `${JSON.stringify(value, null, 2)}\n`, "application/json; charset=utf-8");
}

function send(response: http.ServerResponse, status: number, body: string, contentType: string): void {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store"
  });
  response.end(body);
}

function errorStatus(error: unknown): number {
  const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
  return typeof status === "number" && status >= 400 && status < 600 ? status : 500;
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.unref();
}
