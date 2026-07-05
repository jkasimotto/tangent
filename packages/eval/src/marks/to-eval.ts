// Promotes a mark into a runnable eval scaffold: `tangent mark to-eval <id>` composes the existing
// eval spec, context-snapshot, and prompt scaffolding (see ../cli/commands/capture.ts and
// ../core/context-snapshot.ts) around one mark instead of asking the user to hand-assemble an
// eval.json from scratch. It writes evals/<slug>/{eval.json,prompts/task.md,README.md} into the
// mark's repo and updates the mark's status/links so the trail from failure to proof stays intact.
//
// See docs/superpowers/specs/2026-07-05-mark-loop-design.md, "Mark to eval", for the full contract.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { ensureUsageIndex, readConversationsUserMessages, type ConversationUserMessage, type ConversationUserMessages, type UsageProvider } from "@tangent/usage-index-sqlite";

import { readMark, updateMark, type MarkUpdatePatch } from "./store.js";
import type { MarkRecord } from "./types.js";
import { contextRef, sanitizePathSegment } from "../core/paths.js";
import type { EvalAgentConfig } from "../types/provider.js";
import type { EvalCriterion, EvalPhaseSpec, EvalSpec } from "../types/spec.js";

const DEFAULT_JUDGE_MODEL = "haiku";
const DEFAULT_PHASES: EvalPhaseSpec[] = ["plan", "implement"];
const DEFAULT_AGENT: EvalAgentConfig = { kind: "manual" };
const MARK_ANCHOR_PROVIDERS: UsageProvider[] = ["claude"];

/** Where the task prompt text came from: a real conversation turn, or a stub drafted from the mark itself. */
export type PromptSource = "conversation" | "stub";

/** The task prompt text selected for the scaffolded eval, plus where it came from. */
export type SelectedTaskPrompt = {
  text: string;
  source: PromptSource;
};

/** Caller-supplied options for `runToEval`; everything but the mark id has a sensible default. */
export type ToEvalOptions = {
  markId: string;
  name?: string;
  repo?: string;
  agent?: EvalAgentConfig;
  phases?: EvalPhaseSpec[];
  judgeModel?: string;
  marksDir?: string;
};

/**
 * Injectable dependencies for `runToEval`. All four default to the real store/index implementations;
 * tests inject fakes so a golden-file run never touches the real `~/.tangent` or `~/.claude`.
 */
export type ToEvalDependencies = {
  readMark?: typeof readMark;
  updateMark?: typeof updateMark;
  ensureIndex?: typeof ensureUsageIndex;
  readMessages?: typeof readConversationsUserMessages;
};

/** Everything `runToEval` wrote or changed, for the CLI to print and for tests to assert against. */
export type ToEvalResult = {
  mark: MarkRecord;
  slug: string;
  evalDir: string;
  specPath: string;
  promptPath: string;
  readmePath: string;
  spec: EvalSpec;
  promptSource: PromptSource;
};

/**
 * Derives the eval's directory/spec slug from an explicit `--name` override, or else from the
 * mark's own id (the human-readable slug `createMarkId` appended after the compact timestamp).
 * Always sanitized to the same path-safe alphabet `contextRef` uses for snapshot names, so the
 * slug is usable unmodified as both a directory name and a context-ref name.
 */
export function deriveEvalSlug(mark: MarkRecord, nameOverride?: string): string {
  const source = nameOverride?.trim() || slugFromMarkId(mark.id);
  return sanitizePathSegment(source);
}

/** Strips the leading `<yyyymmddThhmmss>-` timestamp segment `createMarkId` prefixes onto every mark id. */
function slugFromMarkId(id: string): string {
  const match = id.match(/^\d{8}T\d{6}-(.+)$/);
  return match ? match[1]! : id;
}

/**
 * Selects the task prompt for the scaffolded eval: the user message at or nearest before the
 * mark's anchor. Prefers the anchor's `ordinal` (the Usage index's stable per-session message
 * position, counted across every role) when the anchor carries one; falls back to the last user
 * message at or before the mark's own `at` timestamp otherwise. Returns a stub drafted from the
 * mark's own text when the conversation has no user messages at all (session not indexed).
 */
export function selectTaskPrompt(mark: MarkRecord, userMessages: ConversationUserMessage[]): SelectedTaskPrompt {
  if (userMessages.length === 0) return { text: stubPromptText(mark), source: "stub" };
  const sorted = [...userMessages].sort((left, right) => left.ordinal - right.ordinal);
  const anchorOrdinal = mark.anchor.ordinal;
  const picked = anchorOrdinal !== undefined
    ? lastMatching(sorted, (message) => message.ordinal <= anchorOrdinal)
    : lastMatching(sorted, (message) => message.at !== undefined && message.at <= mark.at);
  return { text: (picked ?? sorted[sorted.length - 1]!).text, source: "conversation" };
}

/** Returns the last element satisfying the predicate in an ascending-ordered list, or undefined when none match. */
function lastMatching<T>(ascending: T[], predicate: (item: T) => boolean): T | undefined {
  let match: T | undefined;
  for (const item of ascending) {
    if (predicate(item)) match = item;
  }
  return match;
}

/** Drafts a stub task prompt from the mark's own observed/expected/hypothesis text, for an unindexed session. */
function stubPromptText(mark: MarkRecord): string {
  const lines = [`Observed: ${mark.observed}`];
  if (mark.expected) lines.push(`Expected: ${mark.expected}`);
  if (mark.hypothesis) lines.push(`Hypothesis: ${mark.hypothesis}`);
  return lines.join("\n\n");
}

/**
 * Renders `prompts/task.md`: a banner comment marking the file as editable (it is the eval's task
 * prompt, not the mark record), followed by the selected prompt text.
 */
export function renderTaskPromptFile(mark: MarkRecord, selection: SelectedTaskPrompt): string {
  const banner = selection.source === "conversation"
    ? `<!-- Generated by "tangent mark to-eval ${mark.id}". This is the user message nearest the marked moment, pulled from the Usage index. Edit freely: this file is the eval's task prompt, not the mark record. -->`
    : `<!-- Generated by "tangent mark to-eval ${mark.id}". The session was not indexed yet, so this stub is drafted from the mark's observed/expected text. Edit to restate the task the agent should perform. -->`;
  return `${banner}\n\n${selection.text.trim()}\n`;
}

/**
 * Drafts binary evaluator criteria from the mark's `expected` text, one criterion per sentence or
 * semicolon-separated clause, phrased as a declarative statement the judge can answer yes or no
 * (matching the style ADR-0013 and existing eval.json rubrics already use). These are a mechanical
 * first draft, not a finished rubric; the CLI's next-steps output tells the user to review them.
 */
export function draftCriteriaFromExpected(expected: string | undefined): EvalCriterion[] {
  const clauses = splitIntoClauses(expected);
  if (clauses.length === 0) {
    return [{
      id: "criterion-1",
      statement: "The agent's behavior matches the fix this eval is meant to prove (the mark recorded no expected text to draft a sharper criterion from; rewrite this by hand).",
      points: 1
    }];
  }
  return clauses.map((clause, index) => ({
    id: `criterion-${index + 1}`,
    statement: criterionStatementFromClause(clause),
    points: 1
  }));
}

/** Splits free text into sentence- and semicolon-delimited clauses, trimmed and with empties dropped. */
function splitIntoClauses(expected: string | undefined): string[] {
  const text = (expected || "").trim();
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+/)
    .flatMap((sentence) => sentence.split(";"))
    .map((clause) => clause.trim())
    .filter(Boolean);
}

/** Turns one clause of `expected` text (often phrased "should ...") into a declarative "The agent ..." statement. */
function criterionStatementFromClause(clause: string): string {
  const trimmed = clause.replace(/[.;,]+$/, "").trim();
  const withoutShould = trimmed.replace(/^should\s+(have\s+)?/i, "").trim();
  const body = withoutShould || trimmed;
  return `The agent ${lowerFirstLetter(body)}.`;
}

/** Lowercases the first character of a string, leaving the rest unchanged. */
function lowerFirstLetter(text: string): string {
  return text.length ? text[0]!.toLowerCase() + text.slice(1) : text;
}

/** Options for building the generated `eval.json` spec, once the slug and prompt selection are known. */
export type BuildEvalSpecOptions = {
  slug: string;
  mark: MarkRecord;
  agent: EvalAgentConfig;
  phases: EvalPhaseSpec[];
  judgeModel: string;
};

/**
 * Builds the `eval.spec.v1` scaffold for a mark: one case with two variants, `baseline` and
 * `fixed`, each a `snapshot` context mode pointing at a context ref the user captures via
 * `tangent eval context capture` (the README next to this spec prints the exact commands). The
 * evaluator model is explicit per ADR-0013; criteria are drafted from the mark's `expected` text.
 * Sets `markId` to the originating mark's id, so the report renderers can print the link back to
 * the failure or candidate that motivated the eval (see `report/model.ts`).
 */
export function buildEvalSpec(options: BuildEvalSpecOptions): EvalSpec {
  return {
    schema: "eval.spec.v1",
    name: options.slug,
    markId: options.mark.id,
    defaults: {
      repo: { path: ".", ref: "HEAD" },
      cwd: ".",
      agent: options.agent,
      phases: options.phases
    },
    evaluator: {
      model: options.judgeModel,
      criteria: draftCriteriaFromExpected(options.mark.expected)
    },
    cases: [
      {
        id: options.slug,
        prompt: "prompts/task.md",
        variants: [
          { id: "baseline", context: { mode: "snapshot", ref: contextRef(`${options.slug}-baseline`) } },
          { id: "fixed", context: { mode: "snapshot", ref: contextRef(`${options.slug}-fixed`) } }
        ]
      }
    ]
  };
}

/**
 * Renders the scaffold README: the exact `tangent eval context capture` commands for the baseline
 * (before the fix) and fixed (after the fix) snapshots, in order, plus the run/report commands.
 * `eval.json` is strict JSON with no comment syntax, so this is where the workflow is spelled out.
 */
export function renderReadme(args: { mark: MarkRecord; slug: string; repoRoot: string }): string {
  const { mark, slug, repoRoot } = args;
  return [
    `# ${slug} eval scaffold`,
    "",
    `Generated by \`tangent mark to-eval ${mark.id}\`.`,
    "",
    "## 1. Capture the baseline context, before applying your fix",
    "",
    "```",
    `tangent eval context capture ${slug}-baseline --repo ${repoRoot} --cwd . --include-ancestors`,
    "```",
    "",
    "## 2. Apply your fix (a CLAUDE.md edit, a skill patch, a new tool on PATH)",
    "",
    "## 3. Capture the fixed context, after applying your fix",
    "",
    "```",
    `tangent eval context capture ${slug}-fixed --repo ${repoRoot} --cwd . --include-ancestors --include-dirty-context`,
    "```",
    "",
    "## 4. Run the eval and read the report",
    "",
    "```",
    `tangent eval run evals/${slug}/eval.json`,
    "tangent eval report latest",
    "```",
    "",
    "TODO: review the evaluator criteria in `eval.json`. They are mechanically split from the mark's",
    "expected text, one criterion per sentence or clause, and likely need sharper wording before a run",
    "counts as real evidence.",
    ""
  ].join("\n");
}

/**
 * Promotes a mark into a runnable eval scaffold: reads the mark, derives the slug, pulls the
 * anchored user message from the Usage index (falling back to a stub when the session is not
 * indexed), writes `eval.json`/`prompts/task.md`/`README.md` under `evals/<slug>/` in the mark's
 * repo, and updates the mark to `status: "eval-created"` with `links.eval` set. This is the single
 * entry point `tangent mark to-eval` and its tests both call; all I/O dependencies are injectable
 * so tests never touch the real marks store or usage index.
 */
export async function runToEval(options: ToEvalOptions, deps: ToEvalDependencies = {}): Promise<ToEvalResult> {
  const readMarkFn = deps.readMark || readMark;
  const updateMarkFn = deps.updateMark || updateMark;
  const ensureIndex = deps.ensureIndex || ensureUsageIndex;
  const readMessages = deps.readMessages || readConversationsUserMessages;

  const mark = await readMarkFn(options.markId, options.marksDir);
  const slug = deriveEvalSlug(mark, options.name);
  const repoRoot = options.repo || mark.repo.root;

  const userMessages = await loadAnchorConversationUserMessages({ mark, repoRoot, ensureIndex, readMessages });
  const selection = selectTaskPrompt(mark, userMessages);

  const evalDir = path.join(repoRoot, "evals", slug);
  const promptPath = path.join(evalDir, "prompts", "task.md");
  const specPath = path.join(evalDir, "eval.json");
  const readmePath = path.join(evalDir, "README.md");

  const spec = buildEvalSpec({
    slug,
    mark,
    agent: options.agent || DEFAULT_AGENT,
    phases: options.phases || DEFAULT_PHASES,
    judgeModel: options.judgeModel || DEFAULT_JUDGE_MODEL
  });

  await mkdir(path.dirname(promptPath), { recursive: true });
  await writeFile(promptPath, renderTaskPromptFile(mark, selection), "utf8");
  await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  await writeFile(readmePath, renderReadme({ mark, slug, repoRoot }), "utf8");

  const updated = await updateMarkFn(mark.id, { status: "eval-created", links: { eval: `evals/${slug}` } } satisfies MarkUpdatePatch, options.marksDir);

  return { mark: updated, slug, evalDir, specPath, promptPath, readmePath, spec, promptSource: selection.source };
}

/**
 * Reads the user messages of the mark's anchored conversation, ensuring the Usage index is current
 * first. Returns an empty array (which `selectTaskPrompt` treats as "not indexed", falling back to
 * a stub prompt) whenever the conversation has no indexed user messages or the index lookup fails
 * for any reason, rather than letting an indexing error abort the whole scaffold.
 */
async function loadAnchorConversationUserMessages(args: {
  mark: MarkRecord;
  repoRoot: string;
  ensureIndex: typeof ensureUsageIndex;
  readMessages: typeof readConversationsUserMessages;
}): Promise<ConversationUserMessage[]> {
  try {
    await args.ensureIndex({ repo: args.repoRoot, scope: "all", providers: MARK_ANCHOR_PROVIDERS });
    const conversations: ConversationUserMessages[] = await args.readMessages({
      conversationIds: [args.mark.anchor.conversationId],
      repo: args.repoRoot,
      scope: "all",
      providers: MARK_ANCHOR_PROVIDERS
    });
    return conversations[0]?.userMessages || [];
  } catch {
    return [];
  }
}
