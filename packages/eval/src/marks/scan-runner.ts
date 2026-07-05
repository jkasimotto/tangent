// The phase-3 sweep's model call: one Claude CLI invocation per candidate conversation, constrained
// to a small incidents schema. Mirrors `@tangent/rollup`'s `ClaudeCliCorrectionRunner` (see
// packages/rollup/src/metrics/{runner,prompt,schema}.ts), but lives in `@tangent/eval` because eval
// must not depend on rollup. Split out of scan.ts so that file stays focused on orchestration.

import { parseRunnerJson, runnerFailure, runProcess } from "@tangent/agent-runtime/process";

import type { ScanCandidate } from "./scan-candidates.js";

/** The four incident shapes the sweep's model call is allowed to report; anything else is dropped. */
export type ScanCategory = "user-correction" | "wasted-exploration" | "ignored-instruction" | "wrong-pattern";

const SCAN_CATEGORIES: readonly ScanCategory[] = ["user-correction", "wasted-exploration", "ignored-instruction", "wrong-pattern"];

/** Hard cap on incidents accepted from one conversation's model response, regardless of how many it reports. */
export const MAX_INCIDENTS_PER_CONVERSATION = 3;

/** One model-reported moment worth a human's attention, before it becomes a mark draft. */
export type ScanIncident = {
  quote: string;
  why: string;
  category: ScanCategory;
  confidence: "high" | "low";
};

/** Input to one model call: everything about one candidate conversation the prompt is built from. */
export type ScanRunnerInput = {
  candidate: ScanCandidate;
};

/** The validated result of one model call: zero to `MAX_INCIDENTS_PER_CONVERSATION` incidents. */
export type ScanRunnerResult = {
  incidents: ScanIncident[];
};

/**
 * Judges one conversation for incidents worth a human's attention. Implementations must throw
 * rather than return a partially-invalid result; `scanForSuggestedMarks` treats any thrown error as
 * "skip this conversation and count it", so a malformed response, a process failure, and a timeout
 * are all handled identically by the orchestration loop.
 */
export interface ScanModelRunner {
  analyze(input: ScanRunnerInput): Promise<ScanRunnerResult>;
}

/** Structured-output contract the scan judge must return for one conversation. */
export const scanIncidentsJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["incidents"],
  properties: {
    incidents: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["quote", "why", "category", "confidence"],
        properties: {
          quote: { type: "string" },
          why: { type: "string" },
          category: { type: "string", enum: [...SCAN_CATEGORIES] },
          confidence: { type: "string", enum: ["high", "low"] }
        }
      }
    }
  }
};

/** Configuration for the real Claude CLI scan runner. */
export type ClaudeCliScanRunnerConfig = {
  command?: string;
  model: string;
  timeoutMs?: number;
  maxTurns?: number;
};

const scanRunnerEnv = { USAGE_DISABLE_CAPTURE: "1" };
const minStructuredOutputTurns = 2;

/**
 * Judges one conversation per Claude CLI call, constrained to the incidents schema. Mirrors
 * `@tangent/rollup`'s `ClaudeCliCorrectionRunner` (same `-p`/`--output-format json`/`--json-schema`
 * invocation shape), but lives in `@tangent/eval` because eval must not depend on rollup. The model
 * is a required constructor option with no default baked in here; `tangent mark scan` supplies
 * "haiku" as an explicit CLI-level default, per ADR-0013.
 */
export class ClaudeCliScanRunner implements ScanModelRunner {
  constructor(private readonly config: ClaudeCliScanRunnerConfig) {}

  /** Runs one Claude CLI call to judge a candidate conversation and returns its normalized incidents. */
  async analyze(input: ScanRunnerInput): Promise<ScanRunnerResult> {
    const command = this.config.command || "claude";
    const result = await runProcess({
      command,
      args: [
        "-p",
        buildScanPrompt(input.candidate),
        "--model",
        this.config.model,
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(scanIncidentsJsonSchema),
        "--setting-sources",
        "project,local",
        "--no-session-persistence",
        "--tools",
        "",
        "--max-turns",
        String(Math.max(this.config.maxTurns || minStructuredOutputTurns, minStructuredOutputTurns))
      ],
      timeoutMs: this.config.timeoutMs || 120000,
      defaultEnv: scanRunnerEnv
    });
    if (result.code !== 0) throw runnerFailure(command, result.code, result.stderr, result.stdout);
    return normalizeScanIncidents(parseRunnerJson(result.stdout));
  }
}

/**
 * Builds the scan judge's prompt for one candidate conversation: the user's messages in order, a
 * one-line tool-call summary, and the titles of any deterministic findings that already flagged this
 * conversation. The model describes and classifies; it is explicitly told not to invent an incident
 * to fill the response.
 */
export function buildScanPrompt(candidate: ScanCandidate): string {
  const findingLines = candidate.findingTitles.length
    ? candidate.findingTitles.map((title) => `- ${title}`).join("\n")
    : "(no deterministic finding flagged this conversation; look only for user corrections.)";
  const messages = candidate.userMessages.length
    ? candidate.userMessages.map((text, index) => `[${index + 1}] ${text}`).join("\n\n")
    : "(no user messages)";
  return [
    "You are scanning ONE coding-agent conversation for moments worth a human's attention.",
    "You are given the user's messages in order, a one-line tool-call summary, and any deterministic findings that already flagged this conversation as costly.",
    "",
    "Flag an incident only when you can quote the exact moment and explain why a human should look at it. Categories:",
    "- user-correction: the user rejected, redirected, or restated a constraint the agent ignored.",
    "- wasted-exploration: the agent spent effort finding information it could have found faster.",
    "- ignored-instruction: context available to the agent (an earlier message, a stated constraint) said do X and it did not.",
    "- wrong-pattern: the agent used an approach that conflicts with how this codebase is supposed to work.",
    "",
    `Return at most ${MAX_INCIDENTS_PER_CONVERSATION} incidents. If nothing rises to a real incident, return an empty list. Do not invent an incident to fill the list.`,
    'Return JSON matching the schema: { incidents: [{ quote, why, category, confidence }] }. "quote" must be verbatim from the messages or summary given below. "confidence" is "high" only when the quote alone makes the problem obvious to a stranger.',
    "",
    `Tool calls: ${candidate.toolCallSummary}`,
    "",
    "Deterministic findings for this conversation:",
    findingLines,
    "",
    "User messages:",
    messages
  ].join("\n");
}

/**
 * Validates and caps a raw model response into a `ScanRunnerResult`. Throws when the top-level
 * shape is unusable (not an object, or `incidents` not an array), which is the signal
 * `scanForSuggestedMarks` catches to skip a conversation; individual malformed incident entries
 * within an otherwise-valid array are dropped rather than failing the whole response, since one bad
 * entry should not discard the others.
 */
export function normalizeScanIncidents(value: unknown): ScanRunnerResult {
  if (!value || typeof value !== "object") throw new Error("Scan judge response must be an object.");
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.incidents)) throw new Error('Scan judge response must have an "incidents" array.');
  const incidents = record.incidents
    .flatMap((entry): ScanIncident[] => {
      if (!entry || typeof entry !== "object") return [];
      const candidate = entry as Record<string, unknown>;
      const quote = candidate.quote;
      const why = candidate.why;
      const category = candidate.category;
      const confidence = candidate.confidence;
      if (typeof quote !== "string" || !quote) return [];
      if (typeof why !== "string") return [];
      if (!isScanCategory(category)) return [];
      if (confidence !== "high" && confidence !== "low") return [];
      return [{ quote, why, category, confidence }];
    })
    .slice(0, MAX_INCIDENTS_PER_CONVERSATION);
  return { incidents };
}

/** Returns whether a value is one of the known scan incident categories. */
function isScanCategory(value: unknown): value is ScanCategory {
  return typeof value === "string" && (SCAN_CATEGORIES as readonly string[]).includes(value);
}
