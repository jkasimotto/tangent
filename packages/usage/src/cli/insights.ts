import { repoInfo } from "@tangent/repo";
import { booleanArg, numberArg, requiredString, stringArg, type Args } from "@tangent/core/cli";

import { loadUsageDatasetFromIndex } from "@tangent/usage-index-sqlite/sdk/indexStore";
import type { NormalizedConversation } from "@tangent/usage-core/core/conversation-report";
import {
  computeAgentTimeDistribution,
  FINDING_REMEDY_LABELS,
  globalInsightsParkStatePath,
  loadParkState,
  parkFinding,
  repoInsightsParkStatePath,
  runInsightGenerators,
  unparkFinding,
  type AgentTimeDistribution,
  type Finding,
  type FindingGeneratorName,
  type FindingRemedy,
  type ParkState
} from "@tangent/usage-core/core/insights/index";

import { partitionEvalRunConversations } from "../core/insights-window.js";

const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 10;
const FALLBACK_TERMINAL_COLUMNS = 100;
const MIN_TITLE_COLUMN_WIDTH = 20;
const SHOW_EVIDENCE_LIMIT = 10;
const GENERATOR_NAMES: FindingGeneratorName[] = [
  "info-finding-heavy-sessions",
  "recurring-long-commands",
  "re-read-churn-and-hot-files",
  "failure-retry-loops"
];

/**
 * Compact one-or-two-word remedy tag per remedy category: the list view's sibling of usage-core's
 * FINDING_REMEDY_LABELS. The list shows one finding per line, so there is no room for the full
 * remedy sentence; the tag names the kind of fix at a glance and `insights show` prints the full
 * FINDING_REMEDY_LABELS sentence.
 */
export const FINDING_REMEDY_TAGS: Record<FindingRemedy, string> = {
  "missing-map": "add map",
  "split-or-map-file": "split context",
  "structural-search": "better search",
  "document-command": "document command",
  "document-invocation": "document flags"
};

type InsightsScope = {
  /** The repo argument as loadUsageDatasetFromIndex expects it ("." for the cross-project view). */
  repo: string;
  scope: "repo" | "all";
  /** Where this scope's park state lives on disk. */
  parkStatePath: string;
  /** Repo root label for the header, when scoped to one repo. */
  repoLabel?: string;
};

/** Runs `tangent usage insights` and its `show`/`park`/`unpark` subcommands. */
export async function runUsageInsightsCommand(args: Args, subcommand: string | undefined): Promise<void> {
  const scope = await resolveScope(args);

  if (subcommand === "show") {
    await runShow(args, scope);
    return;
  }
  if (subcommand === "park") {
    await runPark(args, scope);
    return;
  }
  if (subcommand === "unpark") {
    await runUnpark(args, scope);
    return;
  }
  if (subcommand) throw new Error(`Unknown usage insights subcommand: ${subcommand}. Expected show, park, or unpark.`);

  await runList(args, scope);
}

/** Renders the default ranked list view (or the full, unlimited findings JSON with --json). */
async function runList(args: Args, scope: InsightsScope): Promise<void> {
  const { conversations, parkState, excludedEvalRuns } = await loadWindow(args, scope);
  const findings = runInsightGenerators(conversations, {
    generators: generatorList(args),
    parkState,
    includeParked: Boolean(args.parked),
    includeEvalRuns: booleanArg(args["include-eval-runs"])
  });

  if (args.json) {
    console.log(JSON.stringify(findings, null, 2));
    return;
  }

  const distribution = computeAgentTimeDistribution(conversations);
  console.log(renderInsightsList(findings, distribution, {
    scopeLabel: scopeLabel(scope),
    windowDays: days(args),
    limit: limitArg(args),
    excludedEvalRuns,
    columns: process.stdout.columns || FALLBACK_TERMINAL_COLUMNS,
    color: Boolean(process.stdout.isTTY)
  }));
}

/** Renders the detail view for one finding, addressed by 1-based list index or (a unique prefix of) its fingerprint. */
async function runShow(args: Args, scope: InsightsScope): Promise<void> {
  const ref = requiredString(args._[2], "usage insights show requires a finding index or fingerprint.");
  const { finding } = await resolveRefInWindow(args, scope, ref);
  if (args.json) console.log(JSON.stringify(finding, null, 2));
  else console.log(renderFindingDetail(finding, { color: Boolean(process.stdout.isTTY) }));
}

/** Parks a finding (addressed by index or fingerprint) at its current cost in the current window. */
async function runPark(args: Args, scope: InsightsScope): Promise<void> {
  const ref = requiredString(args._[2], "usage insights park requires a finding index or fingerprint.");
  const { finding } = await resolveRefInWindow(args, scope, ref);
  const state = await parkFinding(scope.parkStatePath, finding.fingerprint, finding.costMs);
  if (args.json) console.log(JSON.stringify({ fingerprint: finding.fingerprint, state: state[finding.fingerprint] }, null, 2));
  else console.log(`Parked "${finding.title}" at ${formatDuration(finding.costMs)}. It resurfaces once its cost grows by 50% or more.`);
}

/** Removes the park entry for a finding addressed by index or fingerprint, if any, saying honestly when there was nothing to remove. */
async function runUnpark(args: Args, scope: InsightsScope): Promise<void> {
  const ref = requiredString(args._[2], "usage insights unpark requires a finding index or fingerprint.");
  const { fingerprint, wasParked } = await resolveUnparkFingerprint(args, scope, ref);
  const state = await unparkFinding(scope.parkStatePath, fingerprint);
  if (args.json) console.log(JSON.stringify({ fingerprint, parked: fingerprint in state }, null, 2));
  else if (wasParked) console.log(`Unparked ${fingerprint}. It returns to the feed on the next run.`);
  else console.log(`${fingerprint} was not parked; nothing changed.`);
}

/**
 * Loads the current window and resolves a finding reference against it: a numeric ref resolves as a
 * 1-based index into the same ordering the default list view prints (same window, generator, and
 * parked flags), a non-numeric ref as a full or unique-prefix fingerprint match over all findings
 * including parked ones.
 */
async function resolveRefInWindow(args: Args, scope: InsightsScope, ref: string): Promise<{ finding: Finding; parkState: ParkState }> {
  const { conversations, parkState } = await loadWindow(args, scope);
  const generators = generatorList(args);
  const includeEvalRuns = booleanArg(args["include-eval-runs"]);
  const visible = runInsightGenerators(conversations, { generators, parkState, includeParked: Boolean(args.parked), includeEvalRuns });
  const all = runInsightGenerators(conversations, { generators, includeParked: true, includeEvalRuns });
  return { finding: resolveFindingRef(ref, visible, all), parkState };
}

/**
 * Resolves an unpark reference to a fingerprint plus whether it was actually parked. Beyond the
 * standard index/fingerprint resolution, a non-numeric ref that matches no current finding falls
 * back to a unique-prefix match over the park-state keys themselves, so a finding whose cost has
 * since dropped below the generators' noise floor (and is therefore absent from the window) can
 * still be unparked.
 */
async function resolveUnparkFingerprint(args: Args, scope: InsightsScope, ref: string): Promise<{ fingerprint: string; wasParked: boolean }> {
  const { conversations, parkState } = await loadWindow(args, scope);
  const generators = generatorList(args);
  const includeEvalRuns = booleanArg(args["include-eval-runs"]);
  const visible = runInsightGenerators(conversations, { generators, parkState, includeParked: Boolean(args.parked), includeEvalRuns });
  const all = runInsightGenerators(conversations, { generators, includeParked: true, includeEvalRuns });
  try {
    const fingerprint = resolveFindingRef(ref, visible, all).fingerprint;
    return { fingerprint, wasParked: fingerprint in parkState };
  } catch (error) {
    if (/^\d+$/.test(ref)) throw error;
    const matches = Object.keys(parkState).filter((fingerprint) => fingerprint.startsWith(ref));
    if (matches.length === 1) return { fingerprint: matches[0]!, wasParked: true };
    throw error;
  }
}

/**
 * Resolves a finding reference: an all-digits ref is a 1-based index into `visibleFindings` (the
 * ordering the list view prints), anything else is matched as a full or unique-prefix fingerprint
 * against `allFindings` (which includes parked findings, so a parked finding can be shown or
 * unparked by fingerprint even while hidden from the list).
 */
export function resolveFindingRef(ref: string, visibleFindings: Finding[], allFindings: Finding[]): Finding {
  if (/^\d+$/.test(ref)) {
    const index = Number(ref);
    if (index < 1 || index > visibleFindings.length) {
      throw new Error(`Index ${ref} is out of range: the current view has ${visibleFindings.length} finding${visibleFindings.length === 1 ? "" : "s"}. Run tangent usage insights to list them.`);
    }
    return visibleFindings[index - 1]!;
  }
  const matches = allFindings.filter((finding) => finding.fingerprint.startsWith(ref));
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) throw new Error(`No finding matches ${ref} in the current window. Widen --days or check the fingerprint.`);
  throw new Error(`Fingerprint prefix ${ref} is ambiguous (${matches.length} matches). Use more characters.`);
}

/** Resolves the --repo scope for both dataset loading and park-state file placement: cross-project and cross-profile by default, scoped to one repo only when --repo is given explicitly. */
async function resolveScope(args: Args): Promise<InsightsScope> {
  const repoArg = stringArg(args.repo);
  if (!repoArg) return { repo: ".", scope: "all", parkStatePath: globalInsightsParkStatePath() };
  const info = await repoInfo(repoArg);
  const root = info.root || info.cwd;
  return { repo: repoArg, scope: "repo", parkStatePath: repoInsightsParkStatePath(root), repoLabel: root };
}

/**
 * Loads the usage dataset for the resolved window, builds a NormalizedConversation per conversation,
 * drops Tangent's own eval sandbox sessions (unless --include-eval-runs) before generators or the
 * distribution ever see the window, and loads park state.
 */
async function loadWindow(args: Args, scope: InsightsScope): Promise<{ conversations: NormalizedConversation[]; parkState: ParkState; excludedEvalRuns: number }> {
  const since = daysAgo(days(args));
  const dataset = await loadUsageDatasetFromIndex({ repo: scope.repo, scope: scope.scope, since });
  const loaded = dataset.conversations.all().data
    .map((row) => dataset.conversations.report({ conversationId: row.id }).data);
  const { conversations, excludedEvalRuns } = partitionEvalRunConversations(loaded, { includeEvalRuns: booleanArg(args["include-eval-runs"]) });
  const parkState = await loadParkState(scope.parkStatePath);
  return { conversations, parkState, excludedEvalRuns };
}

/** Parses --generator into the generator list runInsightGenerators expects, validating against the known names. */
function generatorList(args: Args): FindingGeneratorName[] | undefined {
  const value = stringArg(args.generator);
  if (value === undefined) return undefined;
  if ((GENERATOR_NAMES as string[]).includes(value)) return [value as FindingGeneratorName];
  throw new Error(`--generator must be one of: ${GENERATOR_NAMES.join(", ")}.`);
}

/** Parses --days, defaulting to 30. */
function days(args: Args): number {
  return numberArg(args.days) ?? DEFAULT_DAYS;
}

/** Parses the row cap for the list view: --all lifts it entirely, --limit N overrides the default of 10. */
function limitArg(args: Args): number | undefined {
  if (args.all) return undefined;
  return numberArg(args.limit) ?? DEFAULT_LIMIT;
}

/** Returns the Date `days` days before now. */
function daysAgo(daysCount: number): Date {
  return new Date(Date.now() - daysCount * 24 * 60 * 60 * 1000);
}

/** Returns the header label for a scope: "all projects" for the cross-project default, the repo directory name when scoped. */
function scopeLabel(scope: InsightsScope): string {
  if (scope.scope === "all") return "all projects";
  return lastPathSegment(scope.repoLabel) || scope.repo;
}

export type InsightsListOptions = {
  /** Header scope label, e.g. "all projects" or a repo directory name. */
  scopeLabel: string;
  windowDays: number;
  /** Maximum rows to print; undefined (--all) prints every finding. */
  limit?: number;
  /** How many eval sandbox sessions were dropped from the window; 0 suppresses the exclusion note. */
  excludedEvalRuns: number;
  /** Terminal width budget for one row. */
  columns: number;
  /** Emit ANSI styling (bold cost, dim meta). Off for non-TTY output. */
  color: boolean;
};

/**
 * Renders the default list view as one string: a one-line header with the agent-time distribution,
 * a dim honesty note, one line per finding (index, cost, title, remedy tag, project), and a dim
 * footer with counts and next actions. Pure so tests can assert on the exact output; the command
 * wrapper supplies terminal width and TTY color detection.
 */
export function renderInsightsList(findings: Finding[], distribution: AgentTimeDistribution, options: InsightsListOptions): string {
  const paint = createPaint(options.color);
  const lines: string[] = [headerLine(distribution, options), paint.dim(noteLine(options.excludedEvalRuns)), ""];

  if (!findings.length) {
    lines.push("No findings above the noise floor in this window.");
    return lines.join("\n");
  }

  const shown = options.limit === undefined ? findings : findings.slice(0, options.limit);
  lines.push(...renderFindingRows(shown, options.columns, paint));
  lines.push("", paint.dim(footerLine(shown.length, findings.length)));
  return lines.join("\n");
}

/**
 * Renders the detail view for one finding: full title, cost with the estimated token count (always
 * labeled "est." per the honesty constraint), the full remedy sentence, project, generator, up to 10
 * paste-ready `tangent mark --session <id>` evidence lines, and the fingerprint at the bottom (dim)
 * for scripting.
 */
export function renderFindingDetail(finding: Finding, options: { color: boolean }): string {
  const paint = createPaint(options.color);
  const cost = finding.costTokens > 0
    ? `${formatDuration(finding.costMs)} · est. ${finding.costTokens.toLocaleString("en-US")} tokens`
    : formatDuration(finding.costMs);

  const lines: string[] = [finding.title, ""];
  lines.push(detailRow("cost", cost));
  lines.push(detailRow("remedy", FINDING_REMEDY_LABELS[finding.remedy]));
  const project = findingProjectLabel(finding);
  if (project) lines.push(detailRow("project", project));
  lines.push(detailRow("generator", finding.generator));

  lines.push("", "evidence");
  const refs = finding.evidence.slice(0, SHOW_EVIDENCE_LIMIT);
  for (const ref of refs) lines.push(`  tangent mark --session ${ref.sessionId || ref.conversationId}`);
  const remainder = finding.evidence.length - refs.length;
  if (remainder > 0) lines.push(paint.dim(`  +${remainder} more session${remainder === 1 ? "" : "s"}`));
  if (!finding.evidence.length) lines.push(paint.dim("  (no evidence captured)"));

  lines.push("", paint.dim(finding.fingerprint));
  return lines.join("\n");
}

/** Builds the one-line list header: scope, window, and the agent-time distribution sorted by share descending. */
function headerLine(distribution: AgentTimeDistribution, options: InsightsListOptions): string {
  const time = `agent time ${formatDuration(distribution.totalMs)}`;
  const shares = [...distribution.categories]
    .sort((a, b) => b.ms - a.ms)
    .map((category) => `${category.label} ${Math.round(category.fraction * 100)}%`)
    .join(" · ");
  const timePart = shares ? `${time} (${shares})` : time;
  return `INSIGHTS  ${options.scopeLabel} · last ${options.windowDays} day${options.windowDays === 1 ? "" : "s"} · ${timePart}`;
}

/** Builds the honesty note under the header: the eval-run exclusion count (only when any were excluded) plus the standing estimates disclaimer. */
function noteLine(excludedEvalRuns: number): string {
  const exclusion = excludedEvalRuns > 0
    ? `${excludedEvalRuns} eval sandbox session${excludedEvalRuns === 1 ? "" : "s"} excluded. `
    : "";
  return `${exclusion}Estimates, not measurements.`;
}

/** Renders the aligned finding rows: right-aligned index, bold padded cost, width-truncated title, dim remedy tag, dim project. */
function renderFindingRows(shown: Finding[], columns: number, paint: Paint): string[] {
  const costs = shown.map((finding) => formatDuration(finding.costMs));
  const tags = shown.map((finding) => FINDING_REMEDY_TAGS[finding.remedy]);
  const projects = shown.map((finding) => findingProjectLabel(finding) || "");

  const indexWidth = Math.max(2, String(shown.length).length);
  const costWidth = Math.max(...costs.map((cost) => cost.length));
  const tagWidth = Math.max(...tags.map((tag) => tag.length));
  const projectWidth = Math.max(...projects.map((project) => project.length));
  const separatorsWidth = 2 * (projectWidth > 0 ? 4 : 3);
  const titleWidth = Math.max(MIN_TITLE_COLUMN_WIDTH, columns - indexWidth - costWidth - tagWidth - projectWidth - separatorsWidth);

  return shown.map((finding, rowIndex) => {
    const parts = [
      String(rowIndex + 1).padStart(indexWidth),
      paint.bold(costs[rowIndex]!.padEnd(costWidth)),
      truncateToWidth(finding.title, titleWidth).padEnd(titleWidth),
      paint.dim(projects[rowIndex] ? tags[rowIndex]!.padEnd(tagWidth) : tags[rowIndex]!)
    ];
    if (projects[rowIndex]) parts.push(paint.dim(projects[rowIndex]!));
    return parts.join("  ").trimEnd();
  });
}

/** Builds the footer: shown/total counts plus the next actions, hinting --all only when rows were held back. */
function footerLine(shownCount: number, totalCount: number): string {
  const truncated = shownCount < totalCount;
  const counts = truncated
    ? `${shownCount} of ${totalCount} findings`
    : `${totalCount} finding${totalCount === 1 ? "" : "s"}`;
  const parts = [counts, "tangent usage insights show 1", "park 1"];
  if (truncated) parts.push("--all");
  return parts.join(" · ");
}

/** Truncates text to the given width, replacing the overflow with a single ellipsis character. */
function truncateToWidth(text: string, width: number): string {
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

/** One "label value" line of the detail view, with the label padded into a fixed gutter. */
function detailRow(label: string, value: string): string {
  return `${label.padEnd(11)}${value}`;
}

/**
 * Returns the short project label for a finding: the core-provided projectLabel when set, falling
 * back to the directory name of the finding's repo root so a finding without one still gets a human
 * column instead of a blank.
 */
function findingProjectLabel(finding: Finding): string | undefined {
  return finding.projectLabel || lastPathSegment(finding.repo);
}

/** Returns the last path segment of a filesystem path, undefined for empty or root-only input. */
function lastPathSegment(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || undefined;
}

/** The two styles the list and detail views use: bold for the cost column, dim for meta the eye should skip on a fast scan. */
type Paint = {
  bold(text: string): string;
  dim(text: string): string;
};

/** Creates the ANSI painter for a render: real escape codes when color is on, identity passthrough otherwise (non-TTY output must stay plain). */
function createPaint(color: boolean): Paint {
  return {
    /** Bolds text when color is enabled. */
    bold: (text: string): string => (color ? `[1m${text}[22m` : text),
    /** Dims text when color is enabled. */
    dim: (text: string): string => (color ? `[2m${text}[22m` : text)
  };
}

/**
 * Formats a millisecond duration as a compact cost label: "0s" for zero, "<1s" under a second, whole
 * seconds under a minute, whole minutes under an hour, then one-decimal hours. Mirrors usage-core's
 * formatFindingDuration so the cost column always agrees with the durations inside finding titles.
 */
function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  if (ms < 1_000) return "<1s";
  const seconds = ms / 1_000;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}
