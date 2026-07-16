import { parseRunnerJson, runnerFailure, runProcess } from "@tangent/agent-runtime/process";
import type { WhyLineRunner, WhyLineRunnerInput, WhyLineRunnerResult } from "./types.js";

/** Structured-output contract the why-line pass must return for one sweep. */
export const whyLineJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["whyLines", "drafts"],
  properties: {
    whyLines: { type: "object", additionalProperties: { type: "string" } },
    drafts: { type: "object", additionalProperties: { type: "string" } }
  }
};

const whyLineRunnerEnv = { USAGE_DISABLE_CAPTURE: "1" };
const minStructuredOutputTurns = 2;

/** Builds the why-line prompt for one sweep: each open thread's already-decided state and facts, never asking the model to choose or change a state. */
export function whyLinePrompt(input: WhyLineRunnerInput): string {
  const open = input.derived.filter((thread) => thread.state !== "done");
  const sections = open.map((thread) => {
    const parsed = input.threadsBySlug.get(thread.slug);
    const overviewExcerpt = input.overviewExcerptsByNode.get(thread.node);
    return [
      `### ${thread.slug}`,
      `state: ${thread.state}`,
      `owner: ${thread.owner}`,
      thread.outcome ? `outcome: ${thread.outcome}` : undefined,
      `deterministic fact: ${thread.templateWhy}`,
      parsed?.bodyExcerpt ? `thread body excerpt:\n${parsed.bodyExcerpt}` : undefined,
      overviewExcerpt ? `node overview excerpt:\n${overviewExcerpt}` : undefined
    ].filter(Boolean).join("\n");
  }).join("\n\n");

  return [
    "You are writing the one-line \"why\" for each delegated thread in a daily glance view (threads.md).",
    "You are given each thread's ALREADY-DECIDED state (working, blocked-on-you, ready-for-you, needs-you, or parked) plus its facts. You never change or imply a different state; you only describe the given state in one short, concrete, plain-language line (well under 100 characters) using the facts given.",
    "For a thread in the needs-you state whose deterministic fact is a check-in cadence (not a hard deadline), draft a short check-in message a person would actually send, using the thread's outcome for context. Omit a draft for every other thread.",
    "Return JSON matching the schema: { whyLines: { <slug>: string }, drafts: { <slug>: string } }. Only use slugs from the threads listed below.",
    "",
    "Threads:",
    sections
  ].join("\n");
}

/** Coerces a runner JSON payload into the why-line result contract, discarding anything except why-line and draft text keyed by a known slug: the haiku pass can describe a derived state, it can never introduce or imply a new one. */
export function normalizeWhyLineResult(value: unknown, knownSlugs: Set<string>): WhyLineRunnerResult {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    whyLines: filterKnownStringMap(record.whyLines, knownSlugs),
    drafts: filterKnownStringMap(record.drafts, knownSlugs)
  };
}

/** Keeps only string entries keyed by a known slug from an arbitrary object, discarding everything else (see normalizeWhyLineResult). */
function filterKnownStringMap(value: unknown, knownSlugs: Set<string>): Record<string, string> {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const result: Record<string, string> = {};
  for (const [slug, text] of Object.entries(record)) {
    if (knownSlugs.has(slug) && typeof text === "string" && text.trim()) result[slug] = text.trim();
  }
  return result;
}

export type ClaudeCliWhyLineRunnerConfig = {
  command?: string;
  model?: string;
  timeoutMs?: number;
  maxTurns?: number;
};

/**
 * Writes why-lines and check-in drafts with one Claude CLI call per sweep, constrained to the
 * why-line schema. Defaults to a small, cheap model (haiku) because the input is already-derived
 * facts, never the raw session transcript. Mirrors rollup's ClaudeCliCorrectionRunner invocation.
 */
export class ClaudeCliWhyLineRunner implements WhyLineRunner {
  constructor(private readonly config: ClaudeCliWhyLineRunnerConfig = {}) {}

  /** Runs the haiku why-line pass for one sweep and normalizes its output; throws on a nonzero exit so callers can fall back to templated why-lines. */
  async run(input: WhyLineRunnerInput): Promise<WhyLineRunnerResult> {
    const command = this.config.command || "claude";
    const knownSlugs = new Set(input.derived.filter((thread) => thread.state !== "done").map((thread) => thread.slug));
    const result = await runProcess({
      command,
      args: [
        "-p",
        whyLinePrompt(input),
        "--model",
        this.config.model || "haiku",
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(whyLineJsonSchema),
        "--setting-sources",
        "project,local",
        "--no-session-persistence",
        "--tools",
        "",
        "--max-turns",
        String(Math.max(this.config.maxTurns || minStructuredOutputTurns, minStructuredOutputTurns))
      ],
      timeoutMs: this.config.timeoutMs || 60000,
      defaultEnv: whyLineRunnerEnv
    });
    if (result.code !== 0) throw runnerFailure(command, result.code, result.stderr, result.stdout);
    return normalizeWhyLineResult(parseRunnerJson(result.stdout), knownSlugs);
  }
}
