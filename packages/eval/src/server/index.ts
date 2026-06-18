import http from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { LocalUiApp, StaticAssetMount, UiRoute, UiRouteResponse } from "@tangent/ui-server";
import { changedFiles, listFilesAtRef, showFile } from "@tangent/repo/git";

import type { EvalAgentConfig } from "../types/provider.js";
import type { EvalRunManifest, EvalRunStatus, EvalRunVariantState } from "../types/run.js";
import type { EvalSpec } from "../types/spec.js";
import { isContextPath } from "../core/context-discovery.js";
import { loadEvalSpec } from "../core/config.js";
import { listRuns, loadRunManifest } from "../core/run-store.js";
import { collectEval } from "../core/metrics.js";
import { runPreparedEval } from "../core/run.js";
import { prepareEval } from "../core/worktree.js";
import { readVariantMetricsView } from "./metrics-read.js";
import { diffLines } from "./diff.js";
import type {
  EvalCompareArtifactKind,
  EvalCompareArtifactStatus,
  EvalCompareArtifactView,
  EvalCompareView,
  EvalDiffView,
  EvalLaunchResultView,
  EvalRunDetailView,
  EvalRunSummaryView,
  EvalSpecSummaryView,
  EvalVariantSummaryView
} from "./types.js";

export type {
  EvalCaseView,
  EvalCompareArtifactKind,
  EvalCompareArtifactStatus,
  EvalCompareArtifactView,
  EvalCompareView,
  EvalDiffLineView,
  EvalDiffView,
  EvalLaunchResultView,
  EvalRunDetailView,
  EvalRunSummaryView,
  EvalSparkline,
  EvalSparklineBucket,
  EvalSparklineKind,
  EvalSpecSummaryView,
  EvalVariantMetricsView,
  EvalVariantSummaryView
} from "./types.js";

export type StartEvalUiServerOptions = {
  runId?: string;
  host?: string;
  port?: number;
  open?: boolean;
};

export type EvalUiServer = {
  url: string;
  runId?: string;
  close(): Promise<void>;
};

export type EvalUiApp = {
  app: LocalUiApp;
  routes: UiRoute[];
  assetMounts: StaticAssetMount[];
  runId?: string;
};

type EvalUiRequestContext = {
  preferredRunId?: string;
};

type ArtifactCandidate = EvalCompareArtifactView & {
  leftContent?: string;
  rightContent?: string;
};

/** Starts the local Eval UI server. */
export async function startEvalUiServer(options: StartEvalUiServerOptions = {}): Promise<EvalUiServer> {
  const host = options.host || "127.0.0.1";
  const evalApp = await createEvalUiApp(options);
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
    routes: evalApp.routes
  });
  return {
    url: server.url,
    runId: evalApp.runId,
    close: server.close
  };
}

/** Creates an Eval app registration for the combined Tangent UI. */
export async function createEvalUiApp(options: StartEvalUiServerOptions = {}): Promise<EvalUiApp> {
  const [{ evalUiAssets }] = await Promise.all([
    import("@tangent/eval-ui/assets")
  ]);
  return {
    app: {
      id: "eval",
      label: "Eval",
      routePath: "/eval",
      modulePath: "/apps/eval/assets/embedded.js"
    },
    routes: evalApiRoutes({ preferredRunId: options.runId }),
    assetMounts: [{ pathPrefix: "/apps/eval", assets: evalUiAssets }],
    runId: options.runId
  };
}

/** Creates the Eval API routes consumed by the Eval UI bundle. */
function evalApiRoutes(context: EvalUiRequestContext): UiRoute[] {
  return [{
    pattern: /^\/api\/eval(?:\/.*)?$/,
    /** Handles an Eval API request through the route adapter. */
    handle: (request, url) => handleApiRequest(request, url, context)
  }];
}

/** Dispatches one Eval API request to the matching read-only handler. */
async function handleApiRequest(request: http.IncomingMessage, url: URL, context: EvalUiRequestContext): Promise<UiRouteResponse> {
  try {
    const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    if (parts[0] !== "api" || parts[1] !== "eval") return json(404, { error: "Not found." });

    if (request.method === "POST") {
      if (parts.length === 3 && parts[2] === "runs") return json(202, await launchRun(request));
      return json(405, { error: "Method not allowed." });
    }
    if (request.method !== "GET") return json(405, { error: "Method not allowed." });

    if (parts.length === 3 && parts[2] === "selection") return json(200, { runId: await preferredRun(context.preferredRunId) });
    if (parts.length === 3 && parts[2] === "specs") return json(200, { specs: await listSpecSummaries() });

    if (parts[2] === "runs") {
      if (parts.length === 3) return json(200, { runs: (await listRuns()).map(runSummary) });
      const runId = await runRef(parts[3], context);
      if (!runId) return json(404, { error: "Missing run id." });
      const manifest = await loadRunManifest(runId);
      if (parts.length === 4) return json(200, await runDetail(manifest));
      if (parts.length === 5 && parts[4] === "compare") return json(200, await compareView(manifest, url));
      if (parts.length === 5 && parts[4] === "diff") return json(200, await diffView(manifest, url));
    }

    return json(404, { error: "Not found." });
  } catch (error) {
    return json(errorStatus(error), { error: (error as Error).message });
  }
}

/** Prepares a run from a spec and starts execution in the background, returning the new run id. */
async function launchRun(request: http.IncomingMessage): Promise<EvalLaunchResultView> {
  const body = await readJsonBody(request);
  const specPath = typeof body.specPath === "string" ? body.specPath : undefined;
  if (!specPath) throw new Error("specPath is required.");
  const prepared = await prepareEval(await loadEvalSpec(specPath));
  // Run and collect detached; the manifest is persisted after each phase so polling sees progress.
  void runPreparedEval(prepared.manifest)
    .then(() => collectEval(prepared.manifest))
    .catch(() => undefined);
  return { runId: prepared.manifest.id };
}

/** Lists eval specs the UI can launch: project `evals/*.json` plus specs of prior runs. */
async function listSpecSummaries(): Promise<EvalSpecSummaryView[]> {
  const summaries = new Map<string, EvalSpecSummaryView>();
  for (const specPath of await discoverSpecPaths()) {
    const summary = await readSpecSummary(specPath);
    if (summary) summaries.set(summary.path, summary);
  }
  return [...summaries.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Collects candidate spec paths from the project evals directory and prior run manifests. */
async function discoverSpecPaths(): Promise<string[]> {
  const evalsDir = path.resolve("evals");
  const entries = await readdir(evalsDir, { withFileTypes: true }).catch(() => []);
  const fromDir = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => path.join(evalsDir, entry.name));
  const fromRuns = (await listRuns()).map((manifest) => manifest.specPath).filter((value): value is string => Boolean(value));
  return [...new Set([...fromDir, ...fromRuns])];
}

/** Reads a spec file into a UI summary, returning undefined when it is not a valid spec. */
async function readSpecSummary(specPath: string): Promise<EvalSpecSummaryView | undefined> {
  try {
    const spec = JSON.parse(await readFile(specPath, "utf8")) as EvalSpec;
    if (spec.schema !== "eval.spec.v1" || !Array.isArray(spec.cases)) return undefined;
    return {
      path: specPath,
      name: spec.name || path.basename(specPath),
      caseCount: spec.cases.length,
      variantCount: spec.cases.reduce((sum, testCase) => sum + (testCase.variants?.length || 0), 0)
    };
  } catch {
    return undefined;
  }
}

/** Reads and parses a JSON request body. */
async function readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

/** Resolves a requested run id or latest selector to a concrete run id. */
async function preferredRun(value: string | undefined): Promise<string | undefined> {
  if (value && value !== "latest") return value;
  return (await listRuns())[0]?.id;
}

/** Resolves a URL run reference, including selected/latest aliases. */
async function runRef(value: string | undefined, context: EvalUiRequestContext): Promise<string | undefined> {
  if (!value) return undefined;
  if (value === "selected") return preferredRun(context.preferredRunId);
  if (value === "latest") return preferredRun("latest");
  return value;
}

/** Converts a run manifest into the full UI run detail shape. */
async function runDetail(manifest: EvalRunManifest): Promise<EvalRunDetailView> {
  const cases = new Map<string, EvalVariantSummaryView[]>();
  for (const variant of manifest.variants) {
    const rows = cases.get(variant.caseId) || [];
    rows.push(await variantSummary(manifest, variant));
    cases.set(variant.caseId, rows);
  }
  return {
    ...runSummary(manifest),
    cases: [...cases.entries()].map(([id, variants]) => ({ id, variants }))
  };
}

/** Converts a run manifest into the compact UI run summary shape. */
function runSummary(manifest: EvalRunManifest): EvalRunSummaryView {
  const caseIds = new Set(manifest.variants.map((variant) => variant.caseId));
  return {
    id: manifest.id,
    name: manifest.name,
    createdAt: manifest.createdAt,
    runDir: manifest.runDir,
    specPath: manifest.specPath,
    variantCount: manifest.variants.length,
    caseCount: caseIds.size,
    statuses: statusCounts(manifest.variants)
  };
}

/** Counts variant statuses for a run summary. */
function statusCounts(variants: EvalRunVariantState[]): Record<EvalRunStatus, number> {
  const counts: Record<EvalRunStatus, number> = {
    prepared: 0,
    running: 0,
    done: 0,
    failed: 0,
    manual: 0,
    cancelled: 0
  };
  for (const variant of variants) counts[variant.status] += 1;
  return counts;
}

/** Converts a variant manifest entry into UI metadata. */
async function variantSummary(manifest: EvalRunManifest, variant: EvalRunVariantState): Promise<EvalVariantSummaryView> {
  return {
    caseId: variant.caseId,
    variantId: variant.variantId,
    label: `${variant.caseId}/${variant.variantId}`,
    status: variant.status,
    agent: variant.agent,
    model: agentModel(variant.agent),
    context: variant.context,
    branch: variant.branch,
    worktree: variant.worktree,
    executionCwd: variant.executionCwd,
    baseCommit: variant.baseCommit,
    contextCommit: variant.contextCommit,
    promptArtifacts: await promptArtifacts(variant),
    metrics: await readVariantMetricsView(manifest, variant),
    warnings: variant.warnings
  };
}

/** Builds the two-variant comparison view for one case. */
async function compareView(manifest: EvalRunManifest, url: URL): Promise<EvalCompareView> {
  const { caseId, left, right } = selectedPair(manifest, url);
  return {
    run: runSummary(manifest),
    caseId,
    left: await variantSummary(manifest, left),
    right: await variantSummary(manifest, right),
    artifacts: (await artifactCandidates(left, right)).map(publicArtifact)
  };
}

/** Builds a diff view for one selected comparison artifact. */
async function diffView(manifest: EvalRunManifest, url: URL): Promise<EvalDiffView> {
  const { left, right } = selectedPair(manifest, url);
  const kind = requiredParam(url, "kind") as EvalCompareArtifactKind;
  if (kind !== "prompt" && kind !== "context" && kind !== "code") throw new Error("kind must be prompt, context, or code.");
  const artifactPath = requiredParam(url, "path");
  const candidates = await artifactCandidates(left, right);
  const artifact = candidates.find((candidate) => candidate.kind === kind && candidate.path === artifactPath);
  if (!artifact) {
    const error = new Error(`Artifact not found for selected variants: ${kind}:${artifactPath}`) as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  return {
    artifact: publicArtifact(artifact),
    left: { variantId: left.variantId, label: `${left.caseId}/${left.variantId}` },
    right: { variantId: right.variantId, label: `${right.caseId}/${right.variantId}` },
    lines: diffLines(artifact.leftContent || "", artifact.rightContent || "")
  };
}

/** Resolves and validates the requested pair of variants. */
function selectedPair(manifest: EvalRunManifest, url: URL): { caseId: string; left: EvalRunVariantState; right: EvalRunVariantState } {
  const caseId = requiredParam(url, "caseId");
  const leftId = requiredParam(url, "left");
  const rightId = requiredParam(url, "right");
  const left = manifest.variants.find((variant) => variant.caseId === caseId && variant.variantId === leftId);
  const right = manifest.variants.find((variant) => variant.caseId === caseId && variant.variantId === rightId);
  if (!left || !right) {
    const error = new Error(`Variant pair not found for case ${caseId}.`) as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  return { caseId, left, right };
}

/** Lists prompt and context artifacts that can be compared for a pair. */
async function artifactCandidates(left: EvalRunVariantState, right: EvalRunVariantState): Promise<ArtifactCandidate[]> {
  const [leftPrompts, rightPrompts, contextPaths, codePaths] = await Promise.all([
    promptCandidates(left),
    promptCandidates(right),
    contextArtifactPaths(left, right),
    codeArtifactPaths(left, right)
  ]);
  const rows: ArtifactCandidate[] = [];
  const promptPaths = new Set([...leftPrompts.keys(), ...rightPrompts.keys()]);
  for (const promptPath of promptPaths) {
    const leftContent = leftPrompts.get(promptPath);
    const rightContent = rightPrompts.get(promptPath);
    rows.push({
      id: `prompt:${promptPath}`,
      kind: "prompt",
      path: promptPath,
      label: promptLabel(promptPath),
      status: contentStatus(leftContent, rightContent),
      leftContent,
      rightContent
    });
  }
  for (const contextPath of contextPaths) {
    const [leftContent, rightContent] = await Promise.all([
      showContextFile(left, contextPath),
      showContextFile(right, contextPath)
    ]);
    rows.push({
      id: `context:${contextPath}`,
      kind: "context",
      path: contextPath,
      label: contextPath,
      status: contentStatus(leftContent, rightContent),
      leftContent,
      rightContent
    });
  }
  for (const codePath of codePaths) {
    const [leftContent, rightContent] = await Promise.all([
      showImplementationFile(left, codePath),
      showImplementationFile(right, codePath)
    ]);
    rows.push({
      id: `code:${codePath}`,
      kind: "code",
      path: codePath,
      label: codePath,
      status: contentStatus(leftContent, rightContent),
      leftContent,
      rightContent
    });
  }
  return rows.sort((a, b) => artifactSortKey(a).localeCompare(artifactSortKey(b)));
}

/** Lists files either variant changed from its base commit, for the A-vs-B code diff. */
async function codeArtifactPaths(left: EvalRunVariantState, right: EvalRunVariantState): Promise<string[]> {
  const [leftPaths, rightPaths] = await Promise.all([variantChangedFiles(left), variantChangedFiles(right)]);
  return [...new Set([...leftPaths, ...rightPaths])].sort();
}

/** Lists files a variant changed between its base and implementation (or context) commit. */
async function variantChangedFiles(variant: EvalRunVariantState): Promise<string[]> {
  const head = variant.implementationCommit || variant.planCommit || variant.contextCommit;
  if (!head) return [];
  return changedFiles(variant.worktree, variant.baseCommit, head).catch(() => []);
}

/** Reads a file at a variant's implementation commit, falling back to its base. */
async function showImplementationFile(variant: EvalRunVariantState, filePath: string): Promise<string | undefined> {
  const head = variant.implementationCommit || variant.planCommit || variant.contextCommit || variant.baseCommit;
  return showFile(variant.worktree, head, filePath).catch(() => undefined);
}

/** Lists prompt artifacts attached to a variant. */
async function promptArtifacts(variant: EvalRunVariantState): Promise<EvalCompareArtifactView[]> {
  const candidates = await promptCandidates(variant);
  return [...candidates.keys()].map((promptPath) => ({
    id: `prompt:${promptPath}`,
    kind: "prompt",
    path: promptPath,
    label: promptLabel(promptPath)
  }));
}

/** Reads comparable prompt files for a variant. */
async function promptCandidates(variant: EvalRunVariantState): Promise<Map<string, string>> {
  const rows = new Map<string, string>();
  await addPrompt(rows, "task", variant.promptPath);
  for (const phase of variant.phases) {
    if (phase.promptPath) await addPrompt(rows, phase.id, phase.promptPath);
  }
  return rows;
}

/** Adds a prompt file to the prompt map when it exists. */
async function addPrompt(rows: Map<string, string>, key: string, filePath: string): Promise<void> {
  if (!await isFile(filePath)) return;
  rows.set(key, await readFile(filePath, "utf8"));
}

/** Returns a readable label for a prompt artifact key. */
function promptLabel(value: string): string {
  if (value === "task") return "Task prompt";
  if (value === "plan") return "Plan prompt";
  if (value === "implement") return "Implement prompt";
  return value;
}

/** Lists all comparable context file paths across a variant pair. */
async function contextArtifactPaths(left: EvalRunVariantState, right: EvalRunVariantState): Promise<string[]> {
  const [leftPaths, rightPaths] = await Promise.all([contextPaths(left), contextPaths(right)]);
  return [...new Set([...leftPaths, ...rightPaths])].sort();
}

/** Lists context files visible at a variant's context commit. */
async function contextPaths(variant: EvalRunVariantState): Promise<string[]> {
  const ref = variant.contextCommit || variant.baseCommit;
  const files = await listFilesAtRef(variant.worktree, ref).catch(() => []);
  return files.filter(isContextPath).sort();
}

/** Reads a context file from the variant's context commit. */
async function showContextFile(variant: EvalRunVariantState, filePath: string): Promise<string | undefined> {
  const ref = variant.contextCommit || variant.baseCommit;
  return showFile(variant.worktree, ref, filePath).catch(() => undefined);
}

/** Strips artifact content before returning it to list endpoints. */
function publicArtifact(candidate: ArtifactCandidate): EvalCompareArtifactView {
  return {
    id: candidate.id,
    kind: candidate.kind,
    path: candidate.path,
    label: candidate.label,
    status: candidate.status
  };
}

/** Computes same/changed/one-sided status for artifact content. */
function contentStatus(left: string | undefined, right: string | undefined): EvalCompareArtifactStatus {
  if (left === undefined) return "right-only";
  if (right === undefined) return "left-only";
  return left === right ? "same" : "changed";
}

/** Returns a stable artifact ordering key for UI lists. */
function artifactSortKey(artifact: EvalCompareArtifactView): string {
  const kind = artifact.kind === "prompt" ? "0" : artifact.kind === "context" ? "1" : "2";
  const promptOrder = artifact.path === "task" ? "0" : artifact.path === "plan" ? "1" : artifact.path === "implement" ? "2" : artifact.path;
  return `${kind}:${artifact.kind === "prompt" ? promptOrder : artifact.path}`;
}

/** Extracts a model name from supported agent configs. */
function agentModel(agent: EvalAgentConfig): string | undefined {
  return agent.kind === "manual" ? undefined : agent.model;
}

/** Returns whether a path points to a file. */
async function isFile(filePath: string): Promise<boolean> {
  return stat(filePath).then((entry) => entry.isFile()).catch(() => false);
}

/** Reads a required query parameter or throws. */
function requiredParam(url: URL, key: string): string {
  const value = url.searchParams.get(key);
  if (!value) throw new Error(`Missing query parameter: ${key}`);
  return value;
}

/** Creates a JSON route response. */
function json(status: number, value: unknown): UiRouteResponse {
  return { status, json: value };
}

/** Maps handler errors to HTTP status codes. */
function errorStatus(error: unknown): number {
  const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
  if (typeof status === "number" && status >= 400 && status < 600) return status;
  const message = error instanceof Error ? error.message : String(error);
  return /not found|Missing run id|No eval runs/i.test(message) ? 404 : 500;
}
