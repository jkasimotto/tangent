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
  type Finding,
  type FindingGeneratorName,
  type ParkState
} from "@tangent/usage-core/core/insights/index";
import { loadUsageDatasetFromIndex } from "@tangent/usage-index-sqlite/sdk/indexStore";
import type { UsageInsightsApiFinding, UsageInsightsApiResponse } from "@tangent/usage-ui-data";

import { json, numberField, numberParam, readJsonBody, requiredBodyString, stringField, stringParam } from "./http.js";

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
 * Handles `GET /api/usage/insights`: the distribution header and ranked findings feed for a window.
 * This is the Usage UI's visual twin of `tangent usage insights`, so it mirrors the CLI's scope,
 * window, and generator/park filtering exactly, down to the same default window (30 days).
 */
export async function handleInsightsGet(url: URL): Promise<UiRouteResponse> {
  const scope = await resolveInsightsScope(stringParam(url, "repo"));
  const windowDays = numberParam(url.searchParams.get("days")) ?? DEFAULT_INSIGHTS_DAYS;
  const generator = generatorParam(url);
  const includeParked = url.searchParams.get("includeParked") === "true";
  const { conversations, parkState } = await loadInsightsWindow(scope, windowDays);
  return json(200, buildInsightsResponse(conversations, parkState, scope, windowDays, { generator, includeParked }));
}

/** Handles `POST /api/usage/insights/park`: parks a finding at its current cost in the given window. */
export async function handleInsightsPark(request: http.IncomingMessage): Promise<UiRouteResponse> {
  const body = await readJsonBody(request);
  const fingerprint = requiredBodyString(body, "fingerprint");
  const scope = await resolveInsightsScope(stringField(body, "repo"));
  const windowDays = numberField(body, "days") ?? DEFAULT_INSIGHTS_DAYS;
  const { conversations, parkState } = await loadInsightsWindow(scope, windowDays);
  const findings = runInsightGenerators(conversations, { includeParked: true });
  const finding = findings.find((row) => row.fingerprint === fingerprint);
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
 * Loads the usage dataset for the resolved window and its park state, building a `NormalizedConversation`
 * per conversation exactly like the CLI feed (`loadUsageDatasetFromIndex`, not the server's own
 * session-projection client, since insight generators need full per-conversation tool-call detail).
 */
async function loadInsightsWindow(scope: InsightsScope, windowDays: number): Promise<{ conversations: NormalizedConversation[]; parkState: ParkState }> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const dataset = await loadUsageDatasetFromIndex({ repo: scope.repo, scope: scope.scope, since });
  const conversations = dataset.conversations.all().data.map((row) => dataset.conversations.report({ conversationId: row.id }).data);
  const parkState = await loadParkState(scope.parkStatePath);
  return { conversations, parkState };
}

type BuildInsightsResponseOptions = {
  generator?: FindingGeneratorName;
  /** When false (the default), parked findings are excluded from the response entirely, matching the CLI default. */
  includeParked: boolean;
};

/**
 * Builds the Insights API response from an already-loaded window: the distribution header plus every
 * qualifying finding ranked by cost, each carrying its own `parked` flag. Pure given its inputs (no
 * IO), so it is unit-testable directly with fixture conversations; `handleInsightsGet` is the only
 * caller that also touches disk.
 */
export function buildInsightsResponse(
  conversations: NormalizedConversation[],
  parkState: ParkState,
  scope: InsightsScope,
  windowDays: number,
  options: BuildInsightsResponseOptions
): UsageInsightsApiResponse {
  const findings = runInsightGenerators(conversations, {
    generators: options.generator ? [options.generator] : undefined,
    includeParked: true
  });
  const rows = findings.map((finding) => ({ finding, parked: isParked(parkState, finding.fingerprint, finding.costMs) }));
  const visible = options.includeParked ? rows : rows.filter((row) => !row.parked);
  const distribution = computeAgentTimeDistribution(conversations);
  return {
    scopeLabel: scope.scope === "all" ? "all projects" : scope.repoLabel || scope.repo,
    windowDays,
    totalMs: distribution.totalMs,
    categories: distribution.categories,
    findings: visible.map(({ finding, parked }) => toApiFinding(finding, parked))
  };
}

/** Converts a core `Finding` into its API wire shape, attaching the resolved `parked` flag and the shared remedy label text. */
function toApiFinding(finding: Finding, parked: boolean): UsageInsightsApiFinding {
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

/** Builds a 404-mapped error for a not-found finding lookup. */
function notFound(message: string): Error & { status?: number } {
  const error = new Error(message) as Error & { status?: number };
  error.status = 404;
  return error;
}
