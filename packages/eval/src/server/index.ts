import http from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { LocalUiApp, StaticAssetMount, UiRoute, UiRouteResponse } from "@tangent/ui-server";
import { changedFiles, fileOidsAtRef, gitText, showFile, showFileFollowingSymlinks } from "@tangent/repo/git";

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
import { readVariantEvaluation } from "./evaluation-read.js";
import { variantConversationsView } from "./conversation-view.js";
import { assembleContextView, contextManifestView } from "./variant-views.js";
import { diffLines } from "./diff.js";
import { renderReportArtifact } from "./report-export.js";
import { readReviews, writeReviews, type EvalReviews } from "./reviews.js";
import { readSpecPrompts, writeSpecPrompt } from "./prompts.js";
import { getMarkRoute, listMarksRoute, updateMarkRoute } from "./marks-routes.js";
import { scoringView } from "./scoring-view.js";
import { readJsonBody } from "./http-body.js";
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
  EvalSpecPromptsView,
  EvalSpecPromptView,
  EvalSpecSummaryView,
  EvalVariantMetricsView,
  EvalVariantPhaseView,
  EvalVariantSummaryView
} from "./types.js";
export type { EvalScoringVariantColumn, EvalScoringView } from "./scoring-view.js";
export type { ReportCriterion } from "../report/model.js";
export type { MarkKind, MarkRecord, MarkStatus } from "../marks/types.js";

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
  const [{ evalUiEmbeddedAssets }] = await Promise.all([
    import("@tangent/eval-ui/assets")
  ]);
  return {
    app: {
      id: "eval",
      label: "Eval",
      routePath: "/eval",
      modulePath: "/apps/eval/embedded.js",
      stylePaths: ["/apps/eval/embedded.css"]
    },
    routes: evalApiRoutes({ preferredRunId: options.runId }),
    assetMounts: [{ pathPrefix: "/apps/eval", assets: evalUiEmbeddedAssets }],
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
      if (parts.length === 3 && parts[2] === "runs") {
        // Launching spawns real coding-agent processes and spends tokens, so the verify harness disables it.
        if (process.env.TANGENT_VERIFY_READONLY) return json(403, { error: "Launch disabled in verify harness." });
        return json(202, await launchRun(request));
      }
      if (parts.length === 4 && parts[2] === "marks") {
        // A dismiss/fixed edit is a cheap local-file write, but the verify harness blocks every mutation
        // uniformly so a verification run can never leave a trace in real mark data.
        if (process.env.TANGENT_VERIFY_READONLY) return json(403, { error: "Mark updates disabled in verify harness." });
        return json(200, await updateMarkRoute(parts[3], request));
      }
      return json(405, { error: "Method not allowed." });
    }
    if (request.method === "PUT") {
      // Reviews are the user's own notes about a run, not agent execution, so they persist even in the
      // read-only verify harness.
      if (parts.length === 5 && parts[2] === "runs" && parts[4] === "reviews") {
        const runId = await runRef(parts[3], context);
        if (!runId) return json(404, { error: "Missing run id." });
        const manifest = await loadRunManifest(runId);
        return json(200, await writeReviews(manifest.runDir, await readJsonBody(request) as unknown as EvalReviews));
      }
      // Editing an eval's task prompt writes into the project evals dir, not agent execution, so it is
      // allowed in the verify harness (which runs against an isolated worktree copy).
      if (parts.length === 4 && parts[2] === "specs" && parts[3] === "prompts") {
        const body = await readJsonBody(request);
        const specPath = typeof body.specPath === "string" ? body.specPath : undefined;
        const promptPath = typeof body.promptPath === "string" ? body.promptPath : undefined;
        const content = typeof body.content === "string" ? body.content : undefined;
        if (!specPath || !promptPath || content === undefined) throw new Error("specPath, promptPath, and content are required.");
        return json(200, await writeSpecPrompt(specPath, promptPath, content));
      }
      return json(405, { error: "Method not allowed." });
    }
    if (request.method !== "GET") return json(405, { error: "Method not allowed." });

    if (parts.length === 3 && parts[2] === "selection") return json(200, { runId: await preferredRun(context.preferredRunId) });
    if (parts.length === 4 && parts[2] === "specs" && parts[3] === "prompts") {
      return json(200, await readSpecPrompts(requiredParam(url, "path")));
    }
    if (parts.length === 3 && parts[2] === "specs") return json(200, { specs: await listSpecSummaries() });

    if (parts[2] === "marks") {
      if (parts.length === 3) return json(200, await listMarksRoute(url));
      if (parts.length === 4) return json(200, await getMarkRoute(parts[3]));
    }

    if (parts[2] === "runs") {
      if (parts.length === 3) return json(200, { runs: (await listRuns()).map(runSummary) });
      const runId = await runRef(parts[3], context);
      if (!runId) return json(404, { error: "Missing run id." });
      const manifest = await loadRunManifest(runId);
      if (parts.length === 4) return json(200, await runDetail(manifest));
      if (parts.length === 5 && parts[4] === "compare") return json(200, await compareView(manifest, url));
      if (parts.length === 5 && parts[4] === "scoring") return json(200, await scoringView(manifest, requiredParam(url, "caseId")));
      if (parts.length === 5 && parts[4] === "diff") return json(200, await diffView(manifest, url));
      if (parts.length === 5 && parts[4] === "reviews") return json(200, await readReviews(manifest.runDir));
      if (parts.length === 6 && parts[4] === "context" && parts[5] === "manifest") return json(200, await contextManifestView(singleVariant(manifest, url).variant));
      if (parts.length === 6 && parts[4] === "context" && parts[5] === "assemble") return json(200, await assembleContextView(singleVariant(manifest, url).variant, url));
      if (parts.length === 5 && parts[4] === "conversations") {
        const { caseId, variant } = singleVariant(manifest, url);
        return json(200, await variantConversationsView(manifest, caseId, variant));
      }
      if (parts.length === 6 && parts[4] === "report" && parts[5] === "markdown") return text(200, await renderReportArtifact(manifest, "md"), "text/markdown; charset=utf-8");
      if (parts.length === 6 && parts[4] === "report" && parts[5] === "html") return text(200, await renderReportArtifact(manifest, "html"), "text/html; charset=utf-8");
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

/** Lists eval specs the UI can launch: project `evals/` specs plus specs of prior runs. */
async function listSpecSummaries(): Promise<EvalSpecSummaryView[]> {
  const summaries = new Map<string, EvalSpecSummaryView>();
  for (const specPath of await discoverSpecPaths()) {
    const summary = await readSpecSummary(specPath);
    if (summary) summaries.set(summary.path, summary);
  }
  return [...summaries.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Collects candidate spec paths from the project evals directory and prior run manifests. Evals are
 * conventionally a directory (`evals/<name>/eval.json` alongside a `prompts/` folder), so this scans one
 * level into subdirectories for an `eval.json`, and still accepts a flat `evals/<name>.json`.
 */
async function discoverSpecPaths(): Promise<string[]> {
  const evalsDir = path.resolve("evals");
  const entries = await readdir(evalsDir, { withFileTypes: true }).catch(() => []);
  const fromDir: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      fromDir.push(path.join(evalsDir, entry.name));
    } else if (entry.isDirectory()) {
      const nested = path.join(evalsDir, entry.name, "eval.json");
      if (await isFile(nested)) fromDir.push(nested);
    }
  }
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

/** Resolves a requested run id or latest selector to a concrete run id. */
async function preferredRun(value: string | undefined): Promise<string | undefined> {
  if (value && value !== "latest") return value;
  // Default to the newest run that has variants: an empty run (e.g. an aborted prepare) has nothing
  // to compare and would otherwise leave the UI on a permanent "Loading comparison" with no request.
  const runs = await listRuns();
  return (runs.find((run) => run.variants.length > 0) || runs[0])?.id;
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
  const metrics = await readVariantMetricsView(manifest, variant);
  const evaluation = await readVariantEvaluation(manifest, variant);
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
    startedAt: variant.startedAt,
    endedAt: variant.endedAt,
    phases: variant.phases.map((phase) => ({ id: phase.id, status: phase.status, agentDurationMs: phase.agentDurationMs })),
    error: variant.error,
    promptArtifacts: await promptArtifacts(variant),
    metrics,
    evaluation,
    warnings: variant.warnings
  };
}

/** Builds the two-variant comparison view for one case. */
async function compareView(manifest: EvalRunManifest, url: URL): Promise<EvalCompareView> {
  const { caseId, left, right } = selectedPair(manifest, url);
  const [leftSummary, rightSummary, artifacts] = await Promise.all([
    variantSummary(manifest, left),
    variantSummary(manifest, right),
    compareArtifacts(left, right)
  ]);
  return { run: runSummary(manifest), caseId, left: leftSummary, right: rightSummary, artifacts };
}

/** Builds a diff view for one selected comparison artifact. */
async function diffView(manifest: EvalRunManifest, url: URL): Promise<EvalDiffView> {
  const { left, right } = selectedPair(manifest, url);
  const kind = requiredParam(url, "kind") as EvalCompareArtifactKind;
  if (kind !== "prompt" && kind !== "context" && kind !== "code") throw new Error("kind must be prompt, context, or code.");
  const artifactPath = requiredParam(url, "path");
  const { leftContent, rightContent } = await artifactContent(left, right, kind, artifactPath);
  if (leftContent === undefined && rightContent === undefined) {
    const error = new Error(`Artifact not found for selected variants: ${kind}:${artifactPath}`) as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  return {
    artifact: {
      id: `${kind}:${artifactPath}`,
      kind,
      path: artifactPath,
      label: kind === "prompt" ? promptLabel(artifactPath) : artifactPath,
      status: contentStatus(leftContent, rightContent)
    },
    left: { variantId: left.variantId, label: `${left.caseId}/${left.variantId}` },
    right: { variantId: right.variantId, label: `${right.caseId}/${right.variantId}` },
    lines: diffLines(leftContent || "", rightContent || "")
  };
}

/** Resolves and validates a single requested variant (manifest + caseId + variant query params). */
function singleVariant(manifest: EvalRunManifest, url: URL): { caseId: string; variant: EvalRunVariantState } {
  const caseId = requiredParam(url, "caseId");
  const variantId = requiredParam(url, "variant");
  const variant = manifest.variants.find((entry) => entry.caseId === caseId && entry.variantId === variantId);
  if (!variant) {
    const error = new Error(`Variant ${variantId} not found for case ${caseId}.`) as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  return { caseId, variant };
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

/**
 * Lists prompt, context, and code artifacts for a pair with same/changed badges, without reading any
 * file content. Context and code badges come from comparing blob OIDs at each variant's ref (two
 * `git ls-tree` calls per ref), so the comparison list stays fast even when a repo has hundreds of
 * context files. Content for a single artifact is read lazily by the diff endpoint via artifactContent.
 */
async function compareArtifacts(left: EvalRunVariantState, right: EvalRunVariantState): Promise<EvalCompareArtifactView[]> {
  // Memoize ls-tree per (worktree, ref): a variant's context and code refs usually coincide
  // (prepared runs have no implementation commit), so this collapses four ls-tree calls into two.
  const oidCache = new Map<string, Promise<Map<string, string>>>();
  /** Returns the cached path-to-OID map for a worktree+ref, running ls-tree only on the first request. */
  const oidsAt = (repo: string, ref: string): Promise<Map<string, string>> => {
    const key = `${repo}\0${ref}`;
    const cached = oidCache.get(key);
    if (cached) return cached;
    const pending = fileOidsAtRef(repo, ref).catch(() => new Map<string, string>());
    oidCache.set(key, pending);
    return pending;
  };
  const [promptRows, contextRows, codeRows] = await Promise.all([
    promptArtifactStatuses(left, right),
    contextArtifactStatuses(left, right, oidsAt),
    codeArtifactStatuses(left, right, oidsAt)
  ]);
  return [...promptRows, ...contextRows, ...codeRows].sort((a, b) => artifactSortKey(a).localeCompare(artifactSortKey(b)));
}

type OidsAt = (repo: string, ref: string) => Promise<Map<string, string>>;

/** Badges prompt artifacts by comparing their (small, local) contents. */
async function promptArtifactStatuses(left: EvalRunVariantState, right: EvalRunVariantState): Promise<EvalCompareArtifactView[]> {
  const [leftPrompts, rightPrompts] = await Promise.all([promptCandidates(left), promptCandidates(right)]);
  const paths = new Set([...leftPrompts.keys(), ...rightPrompts.keys()]);
  return [...paths].map((promptPath) => ({
    id: `prompt:${promptPath}`,
    kind: "prompt",
    path: promptPath,
    label: promptLabel(promptPath),
    status: contentStatus(leftPrompts.get(promptPath), rightPrompts.get(promptPath))
  }));
}

/** Badges context artifacts by comparing blob OIDs at each variant's context ref. */
async function contextArtifactStatuses(left: EvalRunVariantState, right: EvalRunVariantState, oidsAt: OidsAt): Promise<EvalCompareArtifactView[]> {
  const [leftOids, rightOids] = await Promise.all([contextOids(left, oidsAt), contextOids(right, oidsAt)]);
  const paths = [...new Set([...leftOids.keys(), ...rightOids.keys()])].sort();
  return paths.map((contextPath) => ({
    id: `context:${contextPath}`,
    kind: "context",
    path: contextPath,
    label: contextPath,
    status: oidStatus(leftOids.get(contextPath), rightOids.get(contextPath))
  }));
}

/**
 * Lists code artifacts (files either variant's agent changed) with a pair status comparing the two
 * outputs and per-variant flags for which variant actually changed each file. The flags let single-variant
 * review show only the files that variant changed (the pair status alone can't: a file only one variant
 * touched still differs between the two outputs and would read as "changed").
 */
async function codeArtifactStatuses(left: EvalRunVariantState, right: EvalRunVariantState, oidsAt: OidsAt): Promise<EvalCompareArtifactView[]> {
  const [leftPaths, rightPaths, leftOids, rightOids, leftCounts, rightCounts] = await Promise.all([
    variantChangedFiles(left),
    variantChangedFiles(right),
    implementationOids(left, oidsAt),
    implementationOids(right, oidsAt),
    variantNumstat(left),
    variantNumstat(right)
  ]);
  const leftChanged = new Set(leftPaths);
  const rightChanged = new Set(rightPaths);
  const paths = [...new Set([...leftPaths, ...rightPaths])].sort();
  return paths.map((codePath) => {
    const lc = leftCounts.get(codePath);
    const rc = rightCounts.get(codePath);
    return {
      id: `code:${codePath}`,
      kind: "code",
      path: codePath,
      label: codePath,
      status: oidStatus(leftOids.get(codePath), rightOids.get(codePath)),
      changedLeft: leftChanged.has(codePath),
      changedRight: rightChanged.has(codePath),
      ...(lc !== undefined ? { addedLeft: lc.added, removedLeft: lc.removed } : {}),
      ...(rc !== undefined ? { addedRight: rc.added, removedRight: rc.removed } : {})
    };
  });
}

/** Reads left/right content for one selected artifact, the only place compare reads file content. */
async function artifactContent(left: EvalRunVariantState, right: EvalRunVariantState, kind: EvalCompareArtifactKind, artifactPath: string): Promise<{ leftContent?: string; rightContent?: string }> {
  if (kind === "prompt") {
    const [leftPrompts, rightPrompts] = await Promise.all([promptCandidates(left), promptCandidates(right)]);
    return { leftContent: leftPrompts.get(artifactPath), rightContent: rightPrompts.get(artifactPath) };
  }
  // Reviewing a single variant's code (left === right) shows the agent's change: its context commit (the
  // state it started from, after context setup) to its implementation. Diffing against the file itself
  // would be all-equal (a whole file with nothing to find); diffing against the base commit would fold in
  // context setup (e.g. empty-context mode stripping files) as if the agent had done it.
  if (kind === "code" && left.caseId === right.caseId && left.variantId === right.variantId) {
    const from = left.contextCommit || left.baseCommit;
    const [fromContent, headContent] = await Promise.all([
      showFile(left.worktree, from, artifactPath).catch(() => undefined),
      showImplementationFile(left, artifactPath)
    ]);
    return { leftContent: fromContent, rightContent: headContent };
  }
  const read = kind === "context" ? showContextFile : showImplementationFile;
  const [leftContent, rightContent] = await Promise.all([read(left, artifactPath), read(right, artifactPath)]);
  return { leftContent, rightContent };
}

/** Blob OIDs of a variant's context files at its context commit. */
async function contextOids(variant: EvalRunVariantState, oidsAt: OidsAt): Promise<Map<string, string>> {
  const ref = variant.contextCommit || variant.baseCommit;
  const oids = await oidsAt(variant.worktree, ref);
  return new Map([...oids].filter(([filePath]) => isContextPath(filePath)));
}

/** Blob OIDs at a variant's implementation commit, for code-artifact comparison. */
async function implementationOids(variant: EvalRunVariantState, oidsAt: OidsAt): Promise<Map<string, string>> {
  const head = variant.implementationCommit || variant.planCommit || variant.contextCommit || variant.baseCommit;
  return oidsAt(variant.worktree, head);
}

/** Computes same/changed/one-sided status from two blob OIDs. */
function oidStatus(left: string | undefined, right: string | undefined): EvalCompareArtifactStatus {
  if (left === undefined) return "right-only";
  if (right === undefined) return "left-only";
  return left === right ? "same" : "changed";
}

/**
 * Lists files the variant's agent changed: from its context commit (the state it started from, after
 * context setup) to its implementation. Diffing from the base commit instead would include context setup
 * (e.g. empty-context mode stripping files) as files the agent "changed".
 */
async function variantChangedFiles(variant: EvalRunVariantState): Promise<string[]> {
  const from = variant.contextCommit || variant.baseCommit;
  const head = variant.implementationCommit || variant.planCommit || variant.contextCommit;
  if (!head || head === from) return [];
  return changedFiles(variant.worktree, from, head).catch(() => []);
}

type FileCounts = { added: number; removed: number };

/**
 * Returns per-file added/removed line counts for the variant's agent change (context -> implementation)
 * via `git diff --numstat`. Binary files (shown as `-\t-` by numstat) and errors produce no entry.
 * Keeps the same from/head logic as variantChangedFiles so the sets stay consistent.
 */
async function variantNumstat(variant: EvalRunVariantState): Promise<Map<string, FileCounts>> {
  const from = variant.contextCommit || variant.baseCommit;
  const head = variant.implementationCommit || variant.planCommit || variant.contextCommit;
  if (!head || head === from) return new Map();
  const output = await gitText(variant.worktree, ["diff", "--numstat", `${from}..${head}`]).catch(() => "");
  const result = new Map<string, FileCounts>();
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("\t");
    if (parts.length < 3) continue;
    const added = parseInt(parts[0], 10);
    const removed = parseInt(parts[1], 10);
    const filePath = parts[2];
    if (!Number.isNaN(added) && !Number.isNaN(removed)) result.set(filePath, { added, removed });
  }
  return result;
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

/** Reads a context file from the variant's context commit. */
async function showContextFile(variant: EvalRunVariantState, filePath: string): Promise<string | undefined> {
  const ref = variant.contextCommit || variant.baseCommit;
  return showFileFollowingSymlinks(variant.worktree, ref, filePath).catch(() => undefined);
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

/** Creates a plain-text route response with an explicit content type, for the report export endpoints. */
function text(status: number, body: string, contentType: string): UiRouteResponse {
  return { status, body, headers: { "content-type": contentType } };
}

/** Maps handler errors to HTTP status codes. */
function errorStatus(error: unknown): number {
  const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
  if (typeof status === "number" && status >= 400 && status < 600) return status;
  const message = error instanceof Error ? error.message : String(error);
  return /not found|Missing run id|No eval runs/i.test(message) ? 404 : 500;
}
