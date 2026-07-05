import { repoInfo } from "@tangent/repo";
import { numberArg, requiredString, stringArg, type Args } from "@tangent/core/cli";

import { loadUsageDatasetFromIndex } from "@tangent/usage-index-sqlite/sdk/indexStore";
import type { NormalizedConversation } from "@tangent/usage-core/core/conversation-report";
import {
  computeAgentTimeDistribution,
  FINDING_REMEDY_LABELS as REMEDY_LABELS,
  globalInsightsParkStatePath,
  loadParkState,
  parkFinding,
  repoInsightsParkStatePath,
  runInsightGenerators,
  unparkFinding,
  type Finding,
  type FindingGeneratorName,
  type ParkState
} from "@tangent/usage-core/core/insights/index";

const DEFAULT_DAYS = 30;
const GENERATOR_NAMES: FindingGeneratorName[] = [
  "info-finding-heavy-sessions",
  "recurring-long-commands",
  "re-read-churn-and-hot-files",
  "failure-retry-loops"
];

type InsightsScope = {
  /** The repo argument as loadUsageDatasetFromIndex expects it ("." for the cross-project view). */
  repo: string;
  scope: "repo" | "all";
  /** Where this scope's park state lives on disk. */
  parkStatePath: string;
  /** Repo root label for the header, when scoped to one repo. */
  repoLabel?: string;
};

/** Runs `tangent usage insights` and its `park`/`unpark` subcommands. */
export async function runUsageInsightsCommand(args: Args, subcommand: string | undefined): Promise<void> {
  const scope = await resolveScope(args);

  if (subcommand === "park") {
    await runPark(args, scope);
    return;
  }
  if (subcommand === "unpark") {
    await runUnpark(args, scope);
    return;
  }
  if (subcommand) throw new Error(`Unknown usage insights subcommand: ${subcommand}`);

  const generator = generatorArg(args);
  const includeParked = Boolean(args.parked);
  const { conversations, parkState } = await loadWindow(args, scope);
  const findings = runInsightGenerators(conversations, {
    generators: generator ? [generator] : undefined,
    parkState,
    includeParked
  });

  if (args.json) {
    console.log(JSON.stringify(findings, null, 2));
    return;
  }
  printInsights(findings, conversations, scope, days(args));
}

/** Parks the finding with the given fingerprint at its current cost in the current window. */
async function runPark(args: Args, scope: InsightsScope): Promise<void> {
  const fingerprint = requiredString(args._[2], "usage insights park requires a fingerprint.");
  const { conversations, parkState } = await loadWindow(args, scope);
  const findings = runInsightGenerators(conversations, { parkState, includeParked: true });
  const finding = findings.find((row) => row.fingerprint === fingerprint);
  if (!finding) throw new Error(`No finding with fingerprint ${fingerprint} in the current window. Widen --days or check the fingerprint.`);
  const state = await parkFinding(scope.parkStatePath, fingerprint, finding.costMs);
  if (args.json) console.log(JSON.stringify({ fingerprint, state: state[fingerprint] }, null, 2));
  else console.log(`Parked ${fingerprint} (${finding.title}) at ${formatDuration(finding.costMs)}. It resurfaces once its cost grows by 50% or more.`);
}

/** Removes the park entry for the given fingerprint, if any. */
async function runUnpark(args: Args, scope: InsightsScope): Promise<void> {
  const fingerprint = requiredString(args._[2], "usage insights unpark requires a fingerprint.");
  const state = await unparkFinding(scope.parkStatePath, fingerprint);
  if (args.json) console.log(JSON.stringify({ fingerprint, parked: fingerprint in state }, null, 2));
  else console.log(`Unparked ${fingerprint}.`);
}

/** Resolves the --repo scope for both dataset loading and park-state file placement: cross-project and cross-profile by default, scoped to one repo only when --repo is given explicitly. */
async function resolveScope(args: Args): Promise<InsightsScope> {
  const repoArg = stringArg(args.repo);
  if (!repoArg) return { repo: ".", scope: "all", parkStatePath: globalInsightsParkStatePath() };
  const info = await repoInfo(repoArg);
  const root = info.root || info.cwd;
  return { repo: repoArg, scope: "repo", parkStatePath: repoInsightsParkStatePath(root), repoLabel: root };
}

/** Loads the usage dataset for the resolved window, builds a NormalizedConversation per conversation, and loads park state. */
async function loadWindow(args: Args, scope: InsightsScope): Promise<{ conversations: NormalizedConversation[]; parkState: ParkState }> {
  const since = daysAgo(days(args));
  const dataset = await loadUsageDatasetFromIndex({ repo: scope.repo, scope: scope.scope, since });
  const conversations = dataset.conversations.all().data
    .map((row) => dataset.conversations.report({ conversationId: row.id }).data);
  const parkState = await loadParkState(scope.parkStatePath);
  return { conversations, parkState };
}

/** Parses --generator, validating it against the known generator names. */
function generatorArg(args: Args): FindingGeneratorName | undefined {
  const value = stringArg(args.generator);
  if (value === undefined) return undefined;
  if ((GENERATOR_NAMES as string[]).includes(value)) return value as FindingGeneratorName;
  throw new Error(`--generator must be one of: ${GENERATOR_NAMES.join(", ")}.`);
}

/** Parses --days, defaulting to 30. */
function days(args: Args): number {
  return numberArg(args.days) ?? DEFAULT_DAYS;
}

/** Returns the Date `days` days before now. */
function daysAgo(daysCount: number): Date {
  return new Date(Date.now() - daysCount * 24 * 60 * 60 * 1000);
}

/** Prints the distribution header and the ranked findings feed. */
function printInsights(findings: Finding[], conversations: NormalizedConversation[], scope: InsightsScope, windowDays: number): void {
  const scopeLabel = scope.scope === "all" ? "all projects" : scope.repoLabel || scope.repo;
  console.log(`INSIGHTS · ${scopeLabel} · last ${windowDays} days`);
  printDistributionHeader(conversations);
  console.log("");

  if (!findings.length) {
    console.log("No findings above the noise floor in this window.");
    return;
  }

  console.log("FINDINGS (ranked by cost)");
  for (const finding of findings) {
    const tokenNote = finding.costTokens > 0 ? `  (est. ${finding.costTokens} tokens)` : "";
    console.log(`${formatDuration(finding.costMs).padStart(6)}  ${finding.title}${tokenNote}`);
    console.log(`        remedy: ${REMEDY_LABELS[finding.remedy]}`);
    console.log(`        evidence: ${evidenceHint(finding)}`);
    console.log(`        fingerprint: ${finding.fingerprint}`);
    console.log("");
  }
}

/** Prints the one-line-per-category distribution header: total tool time, then a percentage bar per broad category. */
function printDistributionHeader(conversations: NormalizedConversation[]): void {
  const distribution = computeAgentTimeDistribution(conversations);
  console.log(`Agent time ${formatDuration(distribution.totalMs)}`);
  if (!distribution.totalMs) return;
  for (const category of distribution.categories) printCategoryBar(category.label, category.fraction);
}

/** Prints one "label percent bar" line of the distribution header. */
function printCategoryBar(label: string, fraction: number): void {
  console.log(`                 ${label.padEnd(12)} ${Math.round(fraction * 100)}% ${renderBar(fraction)}`);
}

/** Renders a fixed-width filled/empty block bar for a 0..1 fraction. */
function renderBar(fraction: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return "▓".repeat(filled) + "░".repeat(width - filled);
}

/** Builds a paste-ready evidence hint listing `tangent mark --session <id>` for up to 3 sessions, with a "+N more" tail. */
function evidenceHint(finding: Finding): string {
  const ids = finding.evidence.map((row) => row.sessionId || row.conversationId);
  const shown = ids.slice(0, 3).map((id) => `tangent mark --session ${id}`);
  const remainder = ids.length - shown.length;
  return remainder > 0 ? `${shown.join(", ")} (+${remainder} more)` : shown.join(", ") || "(no evidence captured)";
}

/** Formats a millisecond duration as a compact "Xm" or "X.Yh" label, matching the finding titles. */
function formatDuration(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}
