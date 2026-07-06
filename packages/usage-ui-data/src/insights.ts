/**
 * View-model layer for the Insights view: the Usage UI's visual twin of `tangent usage insights`.
 * Types here mirror the wire shape of the Insights API response by value rather than importing
 * `@tangent/usage-core`'s `Finding`/`FindingRemedy` types directly, matching how the rest of this
 * package mirrors Usage domain types instead of depending on them, so this package stays
 * dependency-light. The server (`@tangent/usage`, which already depends on usage-core) is
 * responsible for translating real `Finding` records into `UsageInsightsApiResponse`.
 */

/**
 * One category's share of the window's total agent tool time, as served by the API. `key` is
 * intentionally a plain string (not a closed union): the server is moving to emit only nonzero
 * categories, including new ones like "other tools", and this view model must render whatever
 * categories arrive without a matching client release.
 */
export type UsageInsightsApiCategory = {
  key: string;
  label: string;
  ms: number;
  fraction: number;
};

/** One evidence conversation backing a finding, as served by the API. */
export type UsageInsightsApiEvidence = {
  conversationId: string;
  sessionId?: string;
};

/** One finding as served by the Insights API: numeric costs and raw evidence, not yet formatted for display. */
export type UsageInsightsApiFinding = {
  generator: string;
  subject: string;
  title: string;
  costMs: number;
  costTokens: number;
  costTokensEstimated: boolean;
  evidence: UsageInsightsApiEvidence[];
  remedyLabel: string;
  fingerprint: string;
  repo?: string;
  /** Short human project name (the basename of `repo`), for the card's project chip. Additive/optional: older servers omit it, in which case the chip is simply not shown. */
  projectLabel?: string;
  /** Whether this finding is currently parked, per the fingerprint-keyed park state. */
  parked: boolean;
};

/** The full Insights API response for a window: distribution header plus the findings feed. */
export type UsageInsightsApiResponse = {
  scopeLabel: string;
  windowDays: number;
  totalMs: number;
  categories: UsageInsightsApiCategory[];
  findings: UsageInsightsApiFinding[];
  /** Count of eval-sandbox sessions excluded from this window, for the "N eval sandbox sessions excluded" footnote. Additive/optional: older servers omit it, in which case no footnote renders. */
  excludedEvalRuns?: number;
};

/** One category bar in the distribution header, formatted for display. */
export type UsageInsightsCategoryView = {
  key: string;
  label: string;
  percentLabel: string;
  fraction: number;
};

/** One evidence conversation row, with the paste-ready mark command already built. */
export type UsageInsightsEvidenceRow = {
  conversationId: string;
  sessionId?: string;
  /** Paste-ready `tangent mark --session <id>` command for this evidence conversation. */
  markCommand: string;
};

/** One ranked finding row, formatted for display in the findings feed. */
export type UsageInsightsFindingRow = {
  fingerprint: string;
  costLabel: string;
  tokenLabel?: string;
  title: string;
  /** Full remedy sentence; kept as the chip's tooltip so the card itself only needs the short `remedyChip` text. */
  remedyLabel: string;
  /** Short chip label derived from `remedyLabel` (e.g. "Document/cache command"), so the card shows a tag, not a repeated sentence. */
  remedyChip: string;
  /** Short project name when the API row carries one, for the card's dim project chip. */
  projectLabel?: string;
  evidence: UsageInsightsEvidenceRow[];
  /** The mark command for the finding's top evidence session, for the row's one-click copy action. */
  primaryMarkCommand: string;
  parked: boolean;
};

/** The assembled Insights feed view-model: header plus the findings feed split into visible and parked. */
export type UsageInsightsFeedView = {
  scopeLabel: string;
  windowDays: number;
  totalLabel: string;
  categories: UsageInsightsCategoryView[];
  /** Unparked findings, ranked by cost descending. */
  findings: UsageInsightsFindingRow[];
  /** Parked findings, ranked by cost descending, hidden by default behind the "parked (N)" toggle. */
  parkedFindings: UsageInsightsFindingRow[];
  parkedCount: number;
  /** True when the window has no agent tool time at all: nothing has been indexed yet, distinct from a
   * populated window that simply cleared the noise floor with no findings. */
  isEmpty: boolean;
  /** Count of eval-sandbox sessions excluded from this window, for a dim footnote; undefined when the API omits the field or the count is zero. */
  excludedEvalRuns?: number;
};

/**
 * Assembles the full Insights feed view-model from the raw API response: formats durations, token
 * counts, and percentages once so the Svelte view only ever renders precomputed strings, and splits
 * findings into visible/parked so the "parked (N)" toggle needs no extra request. The API response is
 * expected to include every finding in the window (both parked and unparked) each carrying its own
 * `parked` flag; this function does the visible/parked partition, not the server.
 */
export function buildInsightsFeedView(response: UsageInsightsApiResponse): UsageInsightsFeedView {
  const rows = response.findings.map(buildFindingRow);
  const findings = rows.filter((row) => !row.parked);
  const parkedFindings = rows.filter((row) => row.parked);
  return {
    scopeLabel: response.scopeLabel,
    windowDays: response.windowDays,
    totalLabel: formatInsightsDuration(response.totalMs),
    // Defensive filter: a transitional server may still send zero-fraction categories, which the
    // single stacked bar + legend has no use for (a zero-width segment with no visible presence).
    categories: response.categories.filter((category) => category.fraction > 0).sort((left, right) => right.fraction - left.fraction).map(buildCategoryView),
    findings,
    parkedFindings,
    parkedCount: parkedFindings.length,
    isEmpty: response.totalMs <= 0 && rows.length === 0,
    excludedEvalRuns: response.excludedEvalRuns && response.excludedEvalRuns > 0 ? response.excludedEvalRuns : undefined
  };
}

/** Formats one distribution category for display: a rounded percent label alongside its raw fraction (for bar width). A tiny nonzero share reads "<1%" rather than a broken-looking "0%". */
function buildCategoryView(category: UsageInsightsApiCategory): UsageInsightsCategoryView {
  const rounded = Math.round(category.fraction * 100);
  const percentLabel = rounded === 0 && category.fraction > 0 ? "<1%" : `${rounded}%`;
  return { key: category.key, label: category.label, percentLabel, fraction: category.fraction };
}

/**
 * Local map from the known remedy sentences (shared verbatim with `tangent usage insights` via
 * `FINDING_REMEDY_LABELS` in usage-core) to a short chip label. Unrecognized remedy text (e.g. a
 * newly added remedy category the client hasn't caught up to) falls back to a truncated leading
 * clause so the chip never shows a blank or the full sentence.
 */
const REMEDY_CHIP_LABELS: Record<string, string> = {
  "missing map: add a CLAUDE.md pointer or docs index entry": "Add doc pointer",
  "context too big to retain in one file: split it, or summarize it in CLAUDE.md": "Split or map file",
  "missing tool: structural search instead of grep/glob chains": "Use structural search",
  "document the correct scoped invocation in CLAUDE.md, or cache the result": "Document/cache command",
  "document the correct invocation so the agent stops guessing": "Document invocation"
};

/** Derives a short chip label for a finding's remedy sentence, for display as a tag instead of repeating the full sentence on every card. */
function remedyChipLabel(remedyLabel: string): string {
  const known = REMEDY_CHIP_LABELS[remedyLabel];
  if (known) return known;
  const leadClause = remedyLabel.split(/[:,]| or /i)[0]?.trim() || remedyLabel;
  return capitalizeFirst(truncateInsightsText(leadClause, 30));
}

/** Uppercases the first character of a chip label; a no-op on an empty string. */
function capitalizeFirst(value: string): string {
  return value ? `${value[0]!.toUpperCase()}${value.slice(1)}` : value;
}

/** Formats one finding for display, building its evidence rows and the top-evidence mark command shortcut. */
function buildFindingRow(finding: UsageInsightsApiFinding): UsageInsightsFindingRow {
  const evidence = finding.evidence.map(buildEvidenceRow);
  return {
    fingerprint: finding.fingerprint,
    costLabel: formatInsightsDuration(finding.costMs),
    tokenLabel: finding.costTokens > 0 ? `est. ${formatInsightsTokenCount(finding.costTokens)} tokens` : undefined,
    title: finding.title,
    remedyLabel: finding.remedyLabel,
    remedyChip: remedyChipLabel(finding.remedyLabel),
    projectLabel: finding.projectLabel,
    evidence,
    primaryMarkCommand: evidence[0]?.markCommand || "",
    parked: finding.parked
  };
}

/**
 * Builds one evidence row's mark command. The provider session id (not the conversation id) is what
 * `tangent mark --session` expects, matching the CLI feed's evidence hint; the conversation id is kept
 * alongside for "view sessions" to open the existing conversation view, which resolves by conversation id.
 */
function buildEvidenceRow(evidence: UsageInsightsApiEvidence): UsageInsightsEvidenceRow {
  const markId = evidence.sessionId || evidence.conversationId;
  return { conversationId: evidence.conversationId, sessionId: evidence.sessionId, markCommand: `tangent mark --session ${markId}` };
}

/** Formats a millisecond duration as a compact "Xm" or "X.Yh" label, matching the CLI feed's finding durations. */
export function formatInsightsDuration(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

/** Formats an estimated token count compactly (e.g. 24,205 -> "24k") for the dim "est. N tokens" metadata line. */
function formatInsightsTokenCount(value: number): string {
  const rounded = Math.round(value);
  if (Math.abs(rounded) < 1_000) return String(rounded);
  if (Math.abs(rounded) < 1_000_000) return `${Math.round(rounded / 1_000)}k`;
  return `${Math.round(rounded / 1_000_000)}M`;
}

/** Truncates text to a maximum length with an ellipsis, for the remedy chip's derived label. */
function truncateInsightsText(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, Math.max(0, length - 1)).trimEnd()}…` : value;
}

/** Query parameters shared by the Insights fetch and its park/unpark scope resolution. */
export type UsageInsightsQuery = {
  days?: number;
  repo?: string;
  generator?: string;
  includeParked?: boolean;
};

/** Result of a park or unpark mutation: the fingerprint acted on and its resulting park state. */
export type UsageInsightsParkResult = {
  fingerprint: string;
  parked: boolean;
};

/** Browser client for the Insights API: the feed fetch plus the park/unpark mutations. Kept separate
 * from `UsageUiClient` because it talks to a dataset-backed endpoint with no server-side direct-call
 * counterpart (unlike the session-projection routes `UsageUiClient` abstracts over). */
export interface UsageInsightsClient {
  getInsights(query?: UsageInsightsQuery): Promise<UsageInsightsApiResponse>;
  park(fingerprint: string, query?: Pick<UsageInsightsQuery, "days" | "repo" | "generator">): Promise<UsageInsightsParkResult>;
  unpark(fingerprint: string, query?: Pick<UsageInsightsQuery, "repo">): Promise<UsageInsightsParkResult>;
}

/** Creates a browser API client for the Insights view. */
export function createInsightsApiClient(baseUrl = ""): UsageInsightsClient {
  /** Requests JSON from the local Insights API. */
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${baseUrl}${path}`, init);
    if (!response.ok) throw new Error(await response.text().catch(() => `Insights API returned ${response.status}.`));
    return response.json() as Promise<T>;
  };
  return {
    /** Fetches the Insights feed for a window through the local API. */
    getInsights: (query = {}) => request(`/api/usage/insights${insightsQueryString(query)}`),
    /** Parks a finding at its current cost in the given window through the local API. */
    park: (fingerprint, query = {}) => request("/api/usage/insights/park", postInit({ fingerprint, ...query })),
    /** Removes a finding's park entry through the local API. */
    unpark: (fingerprint, query = {}) => request("/api/usage/insights/unpark", postInit({ fingerprint, ...query }))
  };
}

/** Builds a fetch POST init with a JSON body. */
function postInit(body: Record<string, unknown>): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

/** Builds a query string from defined scalar values, omitting undefined and false flags. */
function insightsQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === false) continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}
