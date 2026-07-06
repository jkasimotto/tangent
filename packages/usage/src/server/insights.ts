import type http from "node:http";

import { repoInfo } from "@tangent/repo";
import type { UiRouteResponse } from "@tangent/ui-server";
import type { NormalizedConversation } from "@tangent/usage-core/core/conversation-report";
import {
  computeAgentTimeDistribution,
  FINDING_REMEDY_LABELS,
  globalInsightsParkStatePath,
  isParked,
  loadParkState,
  parkFinding,
  repoInsightsParkStatePath,
  runInsightGenerators,
  unparkFinding,
  type AgentTimeCategoryShare,
  type Finding,
  type FindingGeneratorName,
  type ParkState
} from "@tangent/usage-core/core/insights/index";
import { loadUsageDatasetFromIndex } from "@tangent/usage-index-sqlite/sdk/indexStore";
import type { UsageInsightsApiFinding, UsageInsightsApiResponse } from "@tangent/usage-ui-data";

import { partitionEvalRunConversations } from "../core/insights-window.js";
import { json, numberField, numberParam, readJsonBody, requiredBodyString, stringField, stringParam } from "./http.js";
import { createInsightsComputationCache, insightsComputationCacheKey, type InsightsComputation } from "./insights-cache.js";

const DEFAULT_INSIGHTS_DAYS = 30;
const GENERATOR_NAMES: FindingGeneratorName[] = [
  "info-finding-heavy-sessions",
  "recurring-long-commands",
  "re-read-churn-and-hot-files",
  "failure-retry-loops"
];

/** Where a resolved Insights request is scoped: cross-project (default) or one repo, and where that scope's park state lives on disk. */
type InsightsScope = {
  repo: string;
  scope: "repo" | "all";
  parkStatePath: string;
  repoLabel?: string;
};

/**
 * One finding on the wire, extended with the additive projectLabel field. Declared as an
 * intersection rather than editing UsageInsightsApiFinding directly because that type lives in
 * @tangent/usage-ui-data (the UI package's mirror of this wire shape); the intersection stays
 * correct whether or not the mirror has caught up.
 */
type InsightsApiFindingPayload = UsageInsightsApiFinding & { projectLabel?: string };

/**
 * The full Insights response on the wire: everything UsageInsightsApiResponse already promises plus
 * the additive computedAt and excludedEvalRuns fields, with findings and categories re-declared so
 * the additive projectLabel and "other tools" category typecheck independently of when
 * @tangent/usage-ui-data mirrors them.
 */
type InsightsApiResponsePayload = Omit<UsageInsightsApiResponse, "findings" | "categories"> & {
  findings: InsightsApiFindingPayload[];
  categories: AgentTimeCategoryShare[];
  /** ISO timestamp of when the served computation ran; older than the request time when served from cache. */
  computedAt: string;
  /** How many of Tangent's own eval sandbox sessions were excluded from the window. */
  excludedEvalRuns: number;
};

/**
 * The server keeps one computation per (repo, scope, days, includeEvalRuns) key for two minutes.
 * Park state is read fresh on every request and applied after cache retrieval, so park and unpark
 * reflect immediately despite the cache.
 */
const computationCache = createInsightsComputationCache();

/**
 * Handles `GET /api/usage/insights`: the distribution header and ranked findings feed for a window.
 * This is the Usage UI's visual twin of `tangent usage insights`, so it mirrors the CLI's scope,
 * window, generator/park filtering, and eval-run exclusion exactly, down to the same default window
 * (30 days). Pass includeEvalRuns=1 to opt eval sandbox sessions back in.
 */
export async function handleInsightsGet(url: URL): Promise<UiRouteResponse> {
  const scope = await resolveInsightsScope(stringParam(url, "repo"));
  const windowDays = numberParam(url.searchParams.get("days")) ?? DEFAULT_INSIGHTS_DAYS;
  const generator = generatorParam(url);
  const includeParked = url.searchParams.get("includeParked") === "true";
  const includeEvalRuns = includeEvalRunsParam(url);
  const computation = await cachedInsightsComputation(scope, windowDays, includeEvalRuns);
  const parkState = await loadParkState(scope.parkStatePath);
  return json(200, buildInsightsResponse(computation, parkState, scope, windowDays, { generator, includeParked }));
}

/** Handles `POST /api/usage/insights/park`: parks a finding at its current cost in the given window. */
export async function handleInsightsPark(request: http.IncomingMessage): Promise<UiRouteResponse> {
  const body = await readJsonBody(request);
  const fingerprint = requiredBodyString(body, "fingerprint");
  const scope = await resolveInsightsScope(stringField(body, "repo"));
  const windowDays = numberField(body, "days") ?? DEFAULT_INSIGHTS_DAYS;
  const computation = await cachedInsightsComputation(scope, windowDays, false);
  const finding = computation.findings.find((row) => row.fingerprint === fingerprint);
  if (!finding) throw notFound(`No finding with fingerprint ${fingerprint} in the current window. Widen the window or check the fingerprint.`);
  const state = await parkFinding(scope.parkStatePath, fingerprint, finding.costMs);
  return json(200, { fingerprint, parked: fingerprint in state });
}

/** Handles `POST /api/usage/insights/unpark`: removes a finding's park entry. A no-op when it was not parked. */
export async function handleInsightsUnpark(request: http.IncomingMessage): Promise<UiRouteResponse> {
  const body = await readJsonBody(request);
  const fingerprint = requiredBodyString(body, "fingerprint");
  const scope = await resolveInsightsScope(stringField(body, "repo"));
  const state = await unparkFinding(scope.parkStatePath, fingerprint);
  return json(200, { fingerprint, parked: fingerprint in state });
}

/**
 * Resolves the Insights scope for both dataset loading and park-state file placement: cross-project
 * and cross-profile by default (matching the Usage panel's default), scoped to one repo only when a
 * repo is given explicitly. Mirrors `tangent usage insights`'s own scope resolution so the CLI and UI
 * feeds always agree on the same window for the same inputs.
 */
async function resolveInsightsScope(repoArg: string | undefined): Promise<InsightsScope> {
  if (!repoArg) return { repo: ".", scope: "all", parkStatePath: globalInsightsParkStatePath() };
  const info = await repoInfo(repoArg);
  const root = info.root || info.cwd;
  return { repo: repoArg, scope: "repo", parkStatePath: repoInsightsParkStatePath(root), repoLabel: root };
}

/**
 * Returns the Insights computation for a key from the in-process cache, loading the window and
 * computing it on a miss. This wraps the expensive part of every Insights request (re-reading and
 * re-normalizing each conversation in the window, then running every generator); park state stays
 * outside on purpose so parking is never two minutes stale.
 */
async function cachedInsightsComputation(scope: InsightsScope, windowDays: number, includeEvalRuns: boolean): Promise<InsightsComputation> {
  const key = insightsComputationCacheKey({ repo: scope.repo, scope: scope.scope, days: windowDays, includeEvalRuns });
  const cached = computationCache.get(key);
  if (cached) return cached;
  const { conversations, excludedEvalRuns } = await loadInsightsWindow(scope, windowDays, includeEvalRuns);
  const computation = computeInsights(conversations, excludedEvalRuns, { includeEvalRuns });
  computationCache.set(key, computation);
  return computation;
}

/**
 * Loads the usage dataset for the resolved window, building a `NormalizedConversation` per
 * conversation exactly like the CLI feed (`loadUsageDatasetFromIndex`, not the server's own
 * session-projection client, since insight generators need full per-conversation tool-call detail),
 * then drops Tangent's own eval sandbox sessions (unless includeEvalRuns) before generators or the
 * distribution ever see the window.
 */
async function loadInsightsWindow(scope: InsightsScope, windowDays: number, includeEvalRuns: boolean): Promise<{ conversations: NormalizedConversation[]; excludedEvalRuns: number }> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const dataset = await loadUsageDatasetFromIndex({ repo: scope.repo, scope: scope.scope, since });
  const loaded = dataset.conversations.all().data.map((row) => dataset.conversations.report({ conversationId: row.id }).data);
  return partitionEvalRunConversations(loaded, { includeEvalRuns });
}

/**
 * Runs the park-independent part of one Insights request over an already-loaded window: every
 * generator with includeParked true, plus the agent-time distribution. Pure given its inputs (no
 * IO), so it is unit-testable with fixture conversations; `now` is injectable for deterministic
 * computedAt assertions. `includeEvalRuns` must mirror how the window was loaded, so the
 * generators' own eval-run guard does not silently re-drop sessions the request opted back in.
 */
export function computeInsights(
  conversations: NormalizedConversation[],
  excludedEvalRuns: number,
  options: { includeEvalRuns?: boolean; now?: Date } = {}
): InsightsComputation {
  const now = options.now || new Date();
  return {
    findings: runInsightGenerators(conversations, { includeParked: true, includeEvalRuns: options.includeEvalRuns }),
    distribution: computeAgentTimeDistribution(conversations),
    computedAt: now.toISOString(),
    excludedEvalRuns
  };
}

type BuildInsightsResponseOptions = {
  generator?: FindingGeneratorName;
  /** When false (the default), parked findings are excluded from the response entirely, matching the CLI default. */
  includeParked: boolean;
};

/**
 * Shapes a (possibly cached) Insights computation into the API response: the distribution header
 * plus every qualifying finding ranked by cost, each carrying its own `parked` flag. Generator and
 * park filtering happen here, per request, so one cached computation serves every combination of
 * them and park state is never stale. Pure given its inputs (no IO), so it is unit-testable with a
 * computation built by `computeInsights`.
 */
export function buildInsightsResponse(
  computation: InsightsComputation,
  parkState: ParkState,
  scope: InsightsScope,
  windowDays: number,
  options: BuildInsightsResponseOptions
): InsightsApiResponsePayload {
  const generatorFiltered = options.generator
    ? computation.findings.filter((finding) => finding.generator === options.generator)
    : computation.findings;
  const rows = generatorFiltered.map((finding) => ({ finding, parked: isParked(parkState, finding.fingerprint, finding.costMs) }));
  const visible = options.includeParked ? rows : rows.filter((row) => !row.parked);
  return {
    scopeLabel: scope.scope === "all" ? "all projects" : scope.repoLabel || scope.repo,
    windowDays,
    totalMs: computation.distribution.totalMs,
    categories: computation.distribution.categories,
    findings: visible.map(({ finding, parked }) => toApiFinding(finding, parked)),
    computedAt: computation.computedAt,
    excludedEvalRuns: computation.excludedEvalRuns
  };
}

/** Converts a core `Finding` into its API wire shape, attaching the resolved `parked` flag, the shared remedy label text, and the human projectLabel. */
function toApiFinding(finding: Finding, parked: boolean): InsightsApiFindingPayload {
  return {
    generator: finding.generator,
    subject: finding.subject,
    title: finding.title,
    costMs: finding.costMs,
    costTokens: finding.costTokens,
    costTokensEstimated: finding.costTokensEstimated,
    evidence: finding.evidence,
    remedyLabel: FINDING_REMEDY_LABELS[finding.remedy],
    fingerprint: finding.fingerprint,
    repo: finding.repo,
    projectLabel: finding.projectLabel,
    parked
  };
}

/** Parses the `generator` query parameter, validating it against the known generator names. */
function generatorParam(url: URL): FindingGeneratorName | undefined {
  const value = stringParam(url, "generator");
  if (value === undefined) return undefined;
  if ((GENERATOR_NAMES as string[]).includes(value)) return value as FindingGeneratorName;
  const error = new Error(`generator must be one of: ${GENERATOR_NAMES.join(", ")}.`) as Error & { status?: number };
  error.status = 400;
  throw error;
}

/** Parses the `includeEvalRuns` query parameter: "1" (or "true") opts Tangent's own eval sandbox sessions back into the window. */
function includeEvalRunsParam(url: URL): boolean {
  const value = url.searchParams.get("includeEvalRuns");
  return value === "1" || value === "true";
}

/** Builds a 404-mapped error for a not-found finding lookup. */
function notFound(message: string): Error & { status?: number } {
  const error = new Error(message) as Error & { status?: number };
  error.status = 404;
  return error;
}
